import { validateOrder, computeAmount } from '@/lib/validation';
import { TEST_MODE, BG_COLORS } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A base64 strip at 600px wide sits well under 3 MB. Anything larger is
// either a client bug or someone probing the endpoint.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const ALLOWED_FILTERS = new Set(['original', 'bw', 'sepia']);
const ALLOWED_PAYMENT = new Set(['card', 'apple_pay']);

// Best-effort per-instance throttle. Serverless instances are ephemeral and
// not shared, so replace this with Upstash/Redis before real traffic.
const RATE_LIMIT = { windowMs: 60_000, max: 10 };
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    hits.set(ip, { count: 1, reset: now + RATE_LIMIT.windowMs });
    return false;
  }
  entry.count += 1;
  if (hits.size > 5000) hits.clear();
  return entry.count > RATE_LIMIT.max;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function newOrderId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(36).toUpperCase().padStart(2, '0')).join('').slice(0, 6);
  return `VSC-${suffix}`;
}

export async function POST(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip)) {
    return json({ message: 'Too many requests. Please wait a moment and try again.' }, 429);
  }

  let payload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ message: 'That request was too large.' }, 413);
    }
    payload = JSON.parse(raw);
  } catch {
    return json({ message: 'Malformed request.' }, 400);
  }

  // Never trust the client. Re-run the same validation it ran.
  const { valid, errors } = validateOrder(payload);
  if (!valid) {
    return json({ message: 'Please check the highlighted fields.', errors }, 400);
  }

  if (!ALLOWED_FILTERS.has(payload.filter)) {
    return json({ message: 'Unknown photo style.' }, 400);
  }
  if (!Object.keys(BG_COLORS).includes(payload.background)) {
    return json({ message: 'Unknown strip background.' }, 400);
  }
  if (!ALLOWED_PAYMENT.has(payload.paymentMethod)) {
    return json({ message: 'Unsupported payment method.' }, 400);
  }
  if (typeof payload.stripImage !== 'string' || !payload.stripImage.startsWith('data:image/jpeg;base64,')) {
    return json({ message: 'The strip image was missing or invalid.' }, 400);
  }

  // Price is computed here, never taken from the request body, so a tampered
  // client cannot set its own total.
  const amount = computeAmount(payload.quantity);
  const orderId = newOrderId();

  if (TEST_MODE) {
    // No processor is connected. Acknowledge the submission without implying
    // a charge or a shipment. Do not persist customer data in this mode.
    return json({ orderId, amount, testMode: true }, 200);
  }

  // ─── GOING LIVE ───
  // 1. const intent = await stripe.paymentIntents.create({ amount, currency: 'usd',
  //      automatic_payment_methods: { enabled: true }, metadata: { orderId } });
  // 2. Return intent.client_secret and confirm it on the client with Stripe.js.
  // 3. Persist the order and upload stripImage to object storage only after the
  //    payment_intent.succeeded webhook fires — never on this request alone.
  // 4. Notify fulfilment from that webhook.
  return json({ message: 'Payments are not configured on this deployment.' }, 503);
}

export async function GET() {
  return json({ message: 'Method not allowed.' }, 405);
}
