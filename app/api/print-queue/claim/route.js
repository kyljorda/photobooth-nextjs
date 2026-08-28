import { claimNextOrder } from '@/lib/db';
import { isAgentAuthorized, unauthorized, json } from '@/lib/agent-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Frames are stored with unguessable random paths and served directly.
// When you switch Blob to private storage, replace this with signed
// download URLs — the agent fetches these over HTTPS either way, so
// nothing else in the pipeline changes.
async function resolveFrameUrls(urls) {
  return Array.isArray(urls) ? urls : [];
}

export async function POST(request) {
  if (!isAgentAuthorized(request)) return unauthorized();

  // Lets the whole pipeline be exercised before Stripe is connected.
  // Defaults to off so test orders can never print by accident.
  const allowTestOrders = process.env.PRINT_TEST_ORDERS === 'true';

  try {
    const order = await claimNextOrder({ allowTestOrders });
    if (!order) return json({ order: null });

    const frames = await resolveFrameUrls(order.frame_urls);
    if (frames.length === 0) {
      // Hand back nothing rather than an unrenderable order; the lease
      // lapses and it surfaces as a failure rather than a silent skip.
      return json({ message: 'Order has no frames to print.' }, 500);
    }

    return json({
      order: {
        id: order.id,
        quantity: order.quantity,
        background: order.background,
        filter: order.filter,
        attempts: order.print_attempts,
        frameUrls: frames,
        dateText: new Date(order.created_at).toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        }),
      },
    });
  } catch (err) {
    return json({ message: err?.message || 'Claim failed.' }, 500);
  }
}
