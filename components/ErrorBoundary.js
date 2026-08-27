'use client';

import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Wire this to Sentry or your logger before launch. Never log the strip
    // image or address fields — they are customer data.
    if (process.env.NODE_ENV !== 'production') {
      console.error('PhotoBooth crashed:', error, info);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-8 text-center" style={{ background: '#CEFCE9' }}>
        <h1 className="font-[Playfair_Display,serif] font-black text-2xl tracking-wider mb-3" style={{ color: '#3A3A3A' }}>
          Something Broke
        </h1>
        <p className="text-[0.7rem] leading-relaxed max-w-[280px] mb-8" style={{ color: '#3A3A3A' }}>
          The booth hit an unexpected error. Reloading usually clears it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="py-3.5 px-8 rounded-md bg-white text-[0.65rem] font-medium tracking-[0.1em] uppercase active:scale-[0.96] transition-all"
          style={{ color: '#3A3A3A', border: '1.5px solid rgba(58,58,58,0.15)' }}
        >
          Reload
        </button>
      </div>
    );
  }
}
