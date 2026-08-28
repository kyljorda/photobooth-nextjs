import { handleUpload } from '@vercel/blob/client';
import { json } from '@/lib/agent-auth';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { PHOTO_COUNT } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Photo frames go straight from the browser to Blob storage, never
// through this function. Vercel Functions cap request bodies at 4.5 MB;
// four capture-resolution frames already approach that and would break
// the moment a phone returns a higher-resolution sensor image.
//
// This route only authorizes the upload and hands back a short-lived
// token. The bytes never touch it.

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

// Derived from PHOTO_COUNT so changing the strip length cannot silently
// leave this regex rejecting valid frames.
const PATH_RE = new RegExp(
  `^orders/[A-Za-z0-9_-]{8,64}/(frame-[0-${PHOTO_COUNT - 1}]|strip)\\.jpg$`
);

export async function POST(request) {
  // Uploads are the expensive endpoint: they mint tokens that write to
  // storage. Limit them harder than order submission.
  const { limited } = await rateLimit(clientKey(request, 'blob'), {
    max: 30, windowMs: 60_000,
  });
  if (limited) return json({ message: 'Too many uploads. Please wait a moment.' }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Malformed request.' }, 400);
  }

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        // Only allow the two shapes this app creates. Without this, an
        // authorized token could be used to upload anything anywhere.
        if (!PATH_RE.test(pathname)) throw new Error('Disallowed upload path');

        return {
          // NOTE: 'public' here means "readable with the URL", and the
          // URLs contain a random session id, so they are unguessable
          // rather than secret. Vercel Blob private storage went GA on
          // 30 June 2026 — switch this to 'private' and have the claim
          // route hand the agent signed URLs. Verify the exact private
          // API against your installed @vercel/blob version first.
          access: 'public',
          allowedContentTypes: ['image/jpeg'],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do. The order row is written by /api/orders once
        // the client has all its URLs; doing it here would create rows
        // for abandoned uploads.
      },
    });

    return json(result);
  } catch (err) {
    return json({ message: err?.message || 'Upload could not be authorized.' }, 400);
  }
}
