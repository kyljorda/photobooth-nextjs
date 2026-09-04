import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const run = promisify(execFile);

// Substrings in lpstat output that mean "do not send work right now".
// Sending to a stopped queue silently piles up jobs that never print.
const BLOCKING_STATES = [
  'disabled', 'stopped', 'paused',
  'media-empty', 'media-jam', 'media-needed',
  'offline', 'unplugged', 'door-open', 'marker-supply-empty',
];

/**
 * Reads the queue state. Returns { ready, reason, raw }.
 * The agent refuses to claim work when this is not ready, so retries are
 * not burned against a printer that is simply out of paper.
 */
export async function getPrinterStatus(printer = config.printerName) {
  try {
    const { stdout } = await run('lpstat', ['-p', printer, '-l']);
    const text = stdout.toLowerCase();
    const hit = BLOCKING_STATES.find((s) => text.includes(s));
    if (hit) return { ready: false, reason: hit, raw: stdout.trim() };
    if (text.includes('is idle') || text.includes('now printing')) {
      return { ready: true, reason: 'idle', raw: stdout.trim() };
    }
    // Unrecognised output: treat as not ready rather than assuming good.
    return { ready: false, reason: 'unknown-state', raw: stdout.trim() };
  } catch (err) {
    return {
      ready: false,
      reason: 'lpstat-failed',
      raw: err?.stderr?.toString() || err?.message || 'unknown',
    };
  }
}

/**
 * Submits a job and returns its CUPS job id. Does NOT wait for the print
 * to finish — call waitForJob for that. Splitting the two lets the
 * caller persist the job id before blocking, so a crash mid-print can be
 * reconciled instead of reprinting.
 */
export async function submitJob(filePath, { copies = 1 } = {}) {
  const args = [
    '-d', config.printerName,
    '-n', String(copies),
    // Suppress CUPS scaling. The image is already at exact media
    // geometry; letting CUPS "fit to page" would re-scale and soften it.
    '-o', 'scaling=100',
    '-o', config.mediaOption,
    ...config.extraLpOptions.flatMap((o) => ['-o', o]),
    filePath,
  ];

  const { stdout } = await run('lp', args);
  // lp prints: request id is <printer>-<n> (1 file(s))
  const match = stdout.match(/request id is (\S+)/);
  if (!match) throw new Error(`Could not parse lp output: ${stdout.trim()}`);
  return match[1];
}

/**
 * Waits for a job to leave the queue. A job that disappears from lpstat
 * has either completed or been cancelled; we check completed jobs to
 * tell the difference rather than assuming success.
 */
export async function waitForJob(jobId, { timeoutMs = 180_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const active = await run('lpstat', ['-o']).catch(() => ({ stdout: '' }));
    if (!active.stdout.includes(jobId)) {
      const done = await run('lpstat', ['-W', 'completed', '-o']).catch(() => ({ stdout: '' }));
      if (done.stdout.includes(jobId)) return { ok: true };
      // Left the active queue but never completed — cancelled or failed.
      return { ok: false, reason: 'job-vanished' };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  // Do not leave a stuck job occupying the queue.
  await run('cancel', [jobId]).catch(() => {});
  return { ok: false, reason: 'timeout' };
}

export async function cancelJob(jobId) {
  await run('cancel', [jobId]).catch(() => {});
}
