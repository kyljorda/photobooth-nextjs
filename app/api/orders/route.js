import { validateOrder, computeAmount } from '@/lib/validation';
import { TEST_MODE, BG_COLORS, UNIT_PRICE, SHIPPING } from '@/lib/config';
import { insertOrder, newOrderId } from '@/lib/db';
import { json } from '@/lib/agent-auth';
import { rateLimit, clientKey } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The payload is now URLs, not image bytes — the browser uploads frames
// straight to Blob. This body is a couple of kilobytes regardless of
// photo resolution, so it can never hit Vercel's 4.5 MB function limit.
const MAX_BODY_BYTES = 64 * 1024;
const ALLOWED_FILTERS = new Set(['original', 'bw', 'sepia']);
const ALLOWED_PAYMENT = new Set(['card', 'apple_pay']);
const EXPECTED_FRAMES = 4;

// Only accept URLs we actually issued. Without this an attacker could
// point an order at any URL and have the agent fetch it.
function isOwnBlobUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.vercel-storage.com');
  } catch {
    return false;
  }
}

export async function POST(request) {
  const { limited, resetMs } = await rateLimit(clientKey(request, 'orders'), {
    max: 10, windowMs: 60_000,
  });
  if (limited) {
    return new Response(
      JSON.stringify({ message: 'Too many requests. Please wait a moment and try again.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Retry-After': String(Math.ceil(resetMs / 1000)),
        },
      }
    );
  }

  let payload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ message: 'That request was too large.' }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ message: 'Malformed request.' }, 400);
  }

  // Re-run the client's own validation. The client is never trusted.
  const { valid, errors } = validateOrder(payload);
  if (!valid) return json({ message: 'Please check the highlighted fields.', errors }, 400);

  if (!ALLOWED_FILTERS.has(payload.filter)) return json({ message: 'Unknown photo style.' }, 400);
  if (!Object.keys(BG_COLORS).includes(payload.background)) {
    return json({ message: 'Unknown strip background.' }, 400);
  }
  if (!ALLOWED_PAYMENT.has(payload.paymentMethod)) {
    return json({ message: 'Unsupported payment method.' }, 400);
  }

  const frameUrls = payload.frameUrls;
  if (!Array.isArray(frameUrls) || frameUrls.length !== EXPECTED_FRAMES) {
    return json({ message: 'Your photos did not upload correctly. Please retake.' }, 400);
  }
  if (!frameUrls.every(isOwnBlobUrl)) {
    return json({ message: 'Invalid photo references.' }, 400);
  }
  if (payload.stripUrl && !isOwnBlobUrl(payload.stripUrl)) {
    return json({ message: 'Invalid strip reference.' }, 400);
  }

  // Price is computed here from quantity alone. A tampered client
  // cannot set its own total.
  const amountCents = computeAmount(payload.quantity);
  const id = newOrderId();

  try {
    await insertOrder({
      id,
      email: payload.email,
      billingAddress: payload.billingAddress,
      shippingAddress: payload.shippingAddress,
      isGift: !!payload.isGift,
      background: payload.background,
      filter: payload.filter,
      quantity: Number(payload.quantity),
      unitPriceCents: UNIT_PRICE,
      shippingCents: SHIPPING,
      amountCents,
      frameUrls,
      stripUrl: payload.stripUrl || null,
      // 'test' is a distinct state, not a lie about being paid. The
      // agent only picks these up when PRINT_TEST_ORDERS is enabled.
      paymentStatus: TEST_MODE ? 'test' : 'pending',
    });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'Order insert failed', error: err.message }));
    return json({ message: 'We could not save your order. Please try again.' }, 500);
  }

  if (TEST_MODE) {
    return json({ orderId: id, amount: amountCents, testMode: true });
  }

  // ─── GOING LIVE ───
  // 1. Create a Stripe PaymentIntent for `amountCents` with metadata { orderId: id }.
  // 2. Return client_secret; confirm on the client with Stripe.js.
  // 3. On the payment_intent.succeeded webhook, call markPaid(id, intentId).
  //    Only then does the order become claimable by the print agent.
  // Marking paid here instead would print orders whose payment later fails.
  return json({ message: 'Payments are not configured on this deployment.' }, 503);
}

export async function GET() {
  return json({ message: 'Method not allowed.' }, 405);
}
