import { PHOTO_COUNT } from './config';

// ─────────────────────────────────────────────────────────────
// Photos go from the browser straight to Blob storage. They never pass
// through a Vercel Function, which caps request bodies at 4.5 MB —
// four capture-resolution frames already approach that today and would
// break outright on a higher-resolution sensor.
//
// The upload route authorizes a short-lived token; the bytes travel
// directly to storage.
// ─────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 700;
// Mobile links stall when saturated. Two at a time is measurably more
// reliable than firing all five and hoping.
const CONCURRENCY = 2;

export class UploadError extends Error {
  constructor(message, { retryable = true } = {}) {
    super(message);
    this.name = 'UploadError';
    this.retryable = retryable;
  }
}

function dataUrlToFile(dataUrl, filename) {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new UploadError('Malformed image data', { retryable: false });

  const header = dataUrl.slice(0, comma);
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  const binary = atob(dataUrl.slice(comma + 1));

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return new File([bytes], filename, { type: mime });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadOne({ upload, pathname, file, signal, onProgress }) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new UploadError('Upload cancelled', { retryable: false });

    try {
      const result = await upload(pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload',
        contentType: file.type,
        abortSignal: signal,
        onUploadProgress: onProgress
          ? ({ percentage }) => onProgress(percentage)
          : undefined,
      });
      return result.url;
    } catch (err) {
      // A cancelled upload is a deliberate act, not a failure to retry.
      if (signal?.aborted || err?.name === 'AbortError') {
        throw new UploadError('Upload cancelled', { retryable: false });
      }
      // The server rejected the path or content type. Retrying sends
      // the identical request and gets the identical rejection.
      if (err?.message && /disallowed|not allowed|too large|content type/i.test(err.message)) {
        throw new UploadError(err.message, { retryable: false });
      }

      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        // Exponential backoff with jitter so simultaneous clients do
        // not retry in lockstep.
        const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random());
        await sleep(delay);
      }
    }
  }

  throw new UploadError(lastError?.message || 'Upload failed after retries');
}

/**
 * Uploads the frames and the composed strip, returning their URLs.
 *
 * Results are cached on `cache`, so a failed order submission can be
 * retried without re-uploading megabytes the user already paid for in
 * time and mobile data.
 */
export async function uploadOrderAssets({
  frames,
  stripDataUrl,
  sessionId,
  signal,
  onProgress,
  cache,
}) {
  if (cache?.current) return cache.current;

  if (!Array.isArray(frames) || frames.length !== PHOTO_COUNT) {
    throw new UploadError(`Expected ${PHOTO_COUNT} photos`, { retryable: false });
  }

  // Imported lazily so the SDK is not in the initial bundle — most
  // sessions never reach checkout.
  const { upload } = await import('@vercel/blob/client');

  const jobs = frames.map((dataUrl, i) => ({
    key: `frame-${i}`,
    pathname: `orders/${sessionId}/frame-${i}.jpg`,
    file: dataUrlToFile(dataUrl, `frame-${i}.jpg`),
  }));

  if (stripDataUrl) {
    jobs.push({
      key: 'strip',
      pathname: `orders/${sessionId}/strip.jpg`,
      file: dataUrlToFile(stripDataUrl, 'strip.jpg'),
    });
  }

  const results = {};
  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      results[job.key] = await uploadOne({
        upload,
        pathname: job.pathname,
        file: job.file,
        signal,
      });
      completed += 1;
      onProgress?.({ completed, total: jobs.length });
    }
  }

  // Promise.all rejects on the first failure, which is what we want:
  // a partial upload must not become an order.
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker)
  );

  const payload = {
    frameUrls: frames.map((_, i) => results[`frame-${i}`]),
    stripUrl: results.strip || null,
  };

  if (payload.frameUrls.some((u) => !u)) {
    throw new UploadError('Some photos did not finish uploading');
  }

  if (cache) cache.current = payload;
  return payload;
}
