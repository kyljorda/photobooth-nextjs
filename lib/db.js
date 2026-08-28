import { neon } from '@neondatabase/serverless';

// Vercel's own Postgres product was retired and every store moved to
// Neon; @vercel/postgres is deprecated. @neondatabase/serverless is the
// maintained driver. The Neon Marketplace integration injects
// DATABASE_URL automatically.
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.NEON_DATABASE_URL;

if (!connectionString && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is not set. Add the Neon integration in Vercel.');
}

export const sql = neon(connectionString || '');

// How long an agent may hold an order before the lease lapses and the
// order becomes claimable again. Long enough for a slow multi-copy
// print, short enough that a dead Mac Mini does not strand an order.
const LEASE_MINUTES = 10;

export async function insertOrder(o) {
  const ship = o.isGift ? o.shippingAddress : null;

  const [row] = await sql`
    INSERT INTO orders (
      id, email,
      billing_name, billing_line1, billing_line2, billing_city,
      billing_state, billing_zip, billing_country,
      is_gift, ship_name, ship_line1, ship_line2, ship_city,
      ship_state, ship_zip, ship_country,
      background, filter, quantity,
      unit_price_cents, shipping_cents, amount_cents,
      frame_urls, strip_url,
      payment_status, print_status
    ) VALUES (
      ${o.id}, ${o.email},
      ${o.billingAddress.name}, ${o.billingAddress.line1}, ${o.billingAddress.line2 || null},
      ${o.billingAddress.city}, ${o.billingAddress.state}, ${o.billingAddress.zip},
      ${o.billingAddress.country || 'US'},
      ${!!o.isGift}, ${ship?.name || null}, ${ship?.line1 || null}, ${ship?.line2 || null},
      ${ship?.city || null}, ${ship?.state || null}, ${ship?.zip || null}, ${ship?.country || null},
      ${o.background}, ${o.filter}, ${o.quantity},
      ${o.unitPriceCents}, ${o.shippingCents}, ${o.amountCents},
      ${JSON.stringify(o.frameUrls || [])}, ${o.stripUrl || null},
      ${o.paymentStatus}, 'queued'
    )
    RETURNING id, created_at, payment_status, print_status
  `;
  return row;
}

/**
 * Atomically claims the oldest printable order.
 *
 * FOR UPDATE SKIP LOCKED is what makes this safe: two agents polling at
 * the same instant take different rows instead of both taking the same
 * one. The claim_expires_at clause reclaims orders whose agent died
 * mid-job, so nothing is stranded by a crash or a power cut.
 */
export async function claimNextOrder({ allowTestOrders = false, maxAttempts = 3 } = {}) {
  const statuses = allowTestOrders ? ['paid', 'test'] : ['paid'];

  const [row] = await sql`
    UPDATE orders SET
      print_status     = 'claimed',
      claimed_at       = now(),
      claim_expires_at = now() + (${LEASE_MINUTES} || ' minutes')::interval
    WHERE id = (
      SELECT id FROM orders
      WHERE payment_status = ANY(${statuses})
        AND print_attempts < ${maxAttempts}
        AND (
          print_status = 'queued'
          OR (print_status = 'failed')
          -- Lease lapsed: the previous agent never reported back.
          OR (print_status IN ('claimed', 'printing') AND claim_expires_at < now())
        )
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING
      id, email, background, filter, quantity,
      frame_urls, strip_url, print_attempts, created_at
  `;

  return row || null;
}

export async function markPrinting(id, jobId) {
  await sql`
    UPDATE orders
    SET print_status = 'printing', print_job_id = ${jobId}
    WHERE id = ${id}
  `;
}

export async function markPrinted(id, jobId) {
  await sql`
    UPDATE orders SET
      print_status = 'printed',
      printed_at   = now(),
      print_job_id = COALESCE(${jobId || null}, print_job_id),
      last_error   = NULL,
      claim_expires_at = NULL
    WHERE id = ${id}
  `;
}

export async function markFailed(id, { dead = false, error = '' } = {}) {
  await sql`
    UPDATE orders SET
      print_status   = ${dead ? 'dead_letter' : 'failed'},
      print_attempts = print_attempts + 1,
      last_error     = ${error.slice(0, 500)},
      claim_expires_at = NULL
    WHERE id = ${id}
  `;
}

export async function markPaid(id, paymentIntentId) {
  await sql`
    UPDATE orders SET
      payment_status    = 'paid',
      payment_intent_id = ${paymentIntentId},
      paid_at           = now()
    WHERE id = ${id}
  `;
}

export async function getOrder(id) {
  const [row] = await sql`SELECT * FROM orders WHERE id = ${id}`;
  return row || null;
}

/** Orders needing a human: paid, but repeatedly failed to print. */
export async function getDeadLetters() {
  return sql`
    SELECT id, email, quantity, print_attempts, last_error, created_at
    FROM orders
    WHERE print_status = 'dead_letter'
    ORDER BY created_at ASC
  `;
}

export function newOrderId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  return `VSC-${suffix.slice(0, 6)}`;
}
