import './globals.css';
import ErrorBoundary from '@/components/ErrorBoundary';

export const metadata = {
  title: 'Vintage Strip Club',
  description: 'A timeless vestige of physicality in a virtual world',
  manifest: '/manifest.json',
  applicationName: 'Vintage Strip Club',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Vintage Strip Club',
  },
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
};

// Next 15 requires themeColor and viewport in their own export; leaving them
// inside `metadata` silently drops them and warns at build time.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#CEFCE9',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500&family=Courier+Prime:wght@400;700&display=swap"
          rel="stylesheet"
        />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="bg-dark text-cream min-h-dvh overflow-x-hidden">
        <div className="grain-overlay" aria-hidden="true" />
        <ErrorBoundary>{children}</ErrorBoundary>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`,
          }}
        />
      </body>
    </html>
  );
}
