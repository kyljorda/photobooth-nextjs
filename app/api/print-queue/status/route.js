import { markPrinting, markPrinted, markFailed } from '@/lib/db';
import { isAgentAuthorized, unauthorized, json } from '@/lib/agent-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ATTEMPTS = Number(process.env.PRINT_MAX_ATTEMPTS || 3);

export async function POST(request) {
  if (!isAgentAuthorized(request)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Malformed request.' }, 400);
  }

  const { orderId, status, jobId, error } = body || {};
  if (!orderId || typeof orderId !== 'string') {
    return json({ message: 'orderId is required.' }, 400);
  }

  try {
    switch (status) {
      case 'printing':
        await markPrinting(orderId, jobId || null);
        break;

      case 'printed':
        await markPrinted(orderId, jobId || null);
        break;

      case 'failed':
        await markFailed(orderId, { dead: false, error: String(error || '') });
        break;

      case 'dead_letter':
        await markFailed(orderId, { dead: true, error: String(error || '') });
        // The customer has paid and the strip will not print without a
        // human. Silence here is the expensive failure mode.
        console.error(
          JSON.stringify({
            level: 'alert',
            msg: 'ORDER IN DEAD LETTER — needs manual fulfilment',
            orderId,
            error: String(error || '').slice(0, 300),
          })
        );
        break;

      default:
        return json({ message: `Unknown status: ${status}` }, 400);
    }

    return json({ ok: true, orderId, status, maxAttempts: MAX_ATTEMPTS });
  } catch (err) {
    return json({ message: err?.message || 'Status update failed.' }, 500);
  }
}
