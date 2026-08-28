// Shared bearer-token check for the endpoints the print agent calls.
// Uses a timing-safe comparison so the token cannot be recovered by
// measuring how long a rejection takes.
import { timingSafeEqual } from 'node:crypto';

export function isAgentAuthorized(request) {
  const expected = process.env.PRINT_AGENT_TOKEN;
  if (!expected) return false;

  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return false;

  const provided = header.slice(7);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function unauthorized() {
  return new Response(JSON.stringify({ message: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
