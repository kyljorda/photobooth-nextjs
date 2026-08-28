// ─────────────────────────────────────────────────────────────
// Rate limiting.
//
// The in-memory path is a real limitation, not a placeholder to ignore:
// each serverless instance keeps its own counter and loses it on cold
// start, so an attacker spread across instances gets N times the limit.
// It stops casual hammering and nothing more.
//
// Set KV_REST_API_URL and KV_REST_API_TOKEN (Vercel KV or Upstash Redis)
// and the durable path activates automatically — no code change.
// ─────────────────────────────────────────────────────────────

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const isDurable = Boolean(KV_URL && KV_TOKEN);

const memory = new Map();

function memoryLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = memory.get(key);

  if (!entry || now > entry.reset) {
    memory.set(key, { count: 1, reset: now + windowMs });
    // Bound the map so a flood of unique keys cannot exhaust instance
    // memory. Dropping counters is acceptable; crashing is not.
    if (memory.size > 10_000) {
      for (const [k, v] of memory) {
        if (now > v.reset) memory.delete(k);
        if (memory.size <= 5_000) break;
      }
    }
    return { limited: false, remaining: max - 1, resetMs: windowMs };
  }

  entry.count += 1;
  return {
    limited: entry.count > max,
    remaining: Math.max(0, max - entry.count),
    resetMs: entry.reset - now,
  };
}

async function kvLimit(key, max, windowMs) {
  const windowSec = Math.ceil(windowMs / 1000);

  // INCR then EXPIRE only on first hit — a fixed window. Cheaper than a
  // sliding window and sufficient here; swap to a sorted-set sliding
  // window if burst precision at the boundary ever matters.
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(windowSec), 'NX'],
      ['PTTL', key],
    ]),
  });

  if (!res.ok) throw new Error(`KV responded ${res.status}`);

  const results = await res.json();
  const count = Number(results?.[0]?.result ?? 0);
  const ttl = Number(results?.[2]?.result ?? windowMs);

  return {
    limited: count > max,
    remaining: Math.max(0, max - count),
    resetMs: ttl > 0 ? ttl : windowMs,
  };
}

/**
 * Returns { limited, remaining, resetMs }.
 *
 * Fails OPEN if the KV store is unreachable. A rate limiter outage
 * should degrade protection, not take down checkout — the downstream
 * validation and price computation still hold.
 */
export async function rateLimit(key, { max = 10, windowMs = 60_000 } = {}) {
  if (!isDurable) return memoryLimit(key, max, windowMs);

  try {
    return await kvLimit(key, max, windowMs);
  } catch {
    return memoryLimit(key, max, windowMs);
  }
}

/**
 * Client identity for limiting. Vercel sets x-forwarded-for; the first
 * entry is the client, later entries are proxies and are trivially
 * spoofable, so only the first is used.
 */
export function clientKey(request, scope = 'default') {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  return `rl:${scope}:${ip}`;
}
