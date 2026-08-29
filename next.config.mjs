const csp = [
  "default-src 'self'",
  // Next injects small inline bootstrap scripts; unsafe-inline is required
  // until you adopt a nonce-based CSP.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // blob:/data: cover the canvas-generated strip previews.
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  // 'self' covers this app's own API routes (order submission, upload
  // authorization). Blob storage is separate: photo frames upload
  // directly from the browser to Vercel's storage API, bypassing this
  // app's functions entirely. blob.vercel-storage.com issues the actual
  // PUT; *.public.blob.vercel-storage.com is where uploaded files are
  // later read back from. Both must be allowed or the browser silently
  // blocks the request — confirmed against the exact host in a live
  // CSP violation, not guessed from documentation.
  "connect-src 'self' https://blob.vercel-storage.com https://*.public.blob.vercel-storage.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // Camera stays enabled for this origin only; everything else is off.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self), interest-cohort=()' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/api/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;
