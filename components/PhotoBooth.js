'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  PHOTO_COUNT, FRAME_ASPECT, CAPTURE_WIDTH, CAPTURE_HEIGHT,
  IDEAL_VIDEO_WIDTH, IDEAL_VIDEO_HEIGHT, COUNTDOWN_SECONDS, DEVELOPING_MS,
  UNIT_PRICE, SHIPPING, MAX_QTY, TEST_MODE, BG_COLORS, BG_TEXT_COLORS, US_STATES,
} from '@/lib/config';
import { validateOrder, LIMITS } from '@/lib/validation';

const EMPTY_DOTS = Array(PHOTO_COUNT).fill(false);
const STRIP_LETTERS = ['S', 'T', 'R', 'I', 'P'];

function formatCents(c) { return '$' + (c / 100).toFixed(2); }

function getDateString() {
  return new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function getFilterCSS(f) {
  if (f === 'bw') return 'grayscale(1) contrast(1.06)';
  if (f === 'sepia') return 'sepia(0.72) contrast(1.04) saturate(0.9)';
  return 'contrast(1.03) saturate(0.96)';
}

const EMPTY_FORM = { shipName: '', shipEmail: '', shipAddr1: '', shipAddr2: '', shipCity: '', shipState: '', shipZip: '' };
const EMPTY_GIFT = { giftName: '', giftAddr1: '', giftAddr2: '', giftCity: '', giftState: '', giftZip: '' };

export default function PhotoBooth() {
  const [screen, setScreen] = useState('landing');
  const [photos, setPhotos] = useState([]);
  const [selectedBg, setSelectedBg] = useState('white');
  const [selectedFilter, setSelectedFilter] = useState('original');
  const [facingMode, setFacingMode] = useState('user');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [countdownNum, setCountdownNum] = useState(null);
  const [flashActive, setFlashActive] = useState(false);
  const [capturedDots, setCapturedDots] = useState(EMPTY_DOTS);
  const [photoCount, setPhotoCount] = useState(0);
  const [orderQty, setOrderQty] = useState(1);
  const [giftMode, setGiftMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [giftForm, setGiftForm] = useState(EMPTY_GIFT);
  const [errors, setErrors] = useState({});

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const stripCanvasRef = useRef(null);
  const photosRef = useRef([]);
  // Every pending timer is registered here so navigating away or unmounting
  // mid-capture cannot fire a state update on a dead component.
  const timersRef = useRef(new Set());
  const abortRef = useRef(false);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  const wait = useCallback((ms) => new Promise((resolve) => {
    const id = setTimeout(() => { timersRef.current.delete(id); resolve(); }, ms);
    timersRef.current.add(id);
  }), []);

  // ── CAMERA ──
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async (facing) => {
    stopCamera();
    setCameraError('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support camera access. Try Safari or Chrome.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: IDEAL_VIDEO_WIDTH },
          height: { ideal: IDEAL_VIDEO_HEIGHT },
          aspectRatio: { ideal: FRAME_ASPECT },
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }

      video.srcObject = stream;
      // Wait for real dimensions before allowing capture, otherwise the first
      // frame can be drawn from a 0x0 video.
      await new Promise((resolve) => {
        if (video.readyState >= 2 && video.videoWidth) return resolve();
        video.onloadedmetadata = () => resolve();
      });
      try { await video.play(); } catch { /* muted + playsInline satisfies autoplay */ }
      setCameraReady(true);
    } catch (err) {
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setCameraError('Camera permission was denied. Enable it in your browser settings, then reload.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setCameraError('No camera was found on this device.');
      } else if (name === 'NotReadableError') {
        setCameraError('The camera is in use by another app. Close it and try again.');
      } else {
        setCameraError('The camera could not be started. Please reload and try again.');
      }
    }
  }, [stopCamera]);

  const handleStart = useCallback(async () => {
    abortRef.current = false;
    setScreen('camera');
    await startCamera('user');
  }, [startCamera]);

  const flipCamera = useCallback(async () => {
    if (capturing) return;
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    await startCamera(next);
  }, [capturing, facingMode, startCamera]);

  // ── CAPTURE ──
  // Centre-crops the live frame to exactly FRAME_ASPECT before scaling, so a
  // photo is never squeezed to fit the strip. This is the fix for distortion:
  // excess edges are discarded rather than compressed.
  const capturePhoto = useCallback((fm) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    let sw = vw;
    let sh = vw / FRAME_ASPECT;
    if (sh > vh) { sh = vh; sw = vh * FRAME_ASPECT; }
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;

    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    if (fm === 'user') { ctx.translate(CAPTURE_WIDTH, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    ctx.restore();

    // Gentle film grade: a soft contrast curve plus a slight warm shift.
    // Deliberately mild — the earlier per-channel multiply clipped highlights
    // and pushed skin tones orange.
    const img = ctx.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    const d = img.data;
    const curve = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const n = i / 255;
      const s = n + (n - 0.5) * 0.08 - 0.055 * Math.sin(Math.PI * 2 * n);
      curve[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
    }
    for (let p = 0; p < d.length; p += 4) {
      d[p] = Math.min(255, curve[d[p]] + 3);
      d[p + 1] = curve[d[p + 1]];
      d[p + 2] = Math.max(0, curve[d[p + 2]] - 3);
    }
    ctx.putImageData(img, 0, 0);

    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  const doCountdown = useCallback(async (seconds) => {
    for (let n = seconds; n > 0; n--) {
      if (abortRef.current) return;
      setCountdownNum(n);
      await wait(1000);
    }
    setCountdownNum(null);
  }, [wait]);

  const triggerFlash = useCallback(() => {
    setFlashActive(true);
    const id = setTimeout(() => { timersRef.current.delete(id); setFlashActive(false); }, 350);
    timersRef.current.add(id);
  }, []);

  const startCapture = useCallback(async () => {
    if (capturing || !cameraReady) return;
    abortRef.current = false;
    setCapturing(true);
    setCapturedDots(EMPTY_DOTS);
    setPhotoCount(0);

    const captured = [];
    await doCountdown(COUNTDOWN_SECONDS);

    for (let i = 0; i < PHOTO_COUNT; i++) {
      if (abortRef.current) { setCapturing(false); return; }
      const dataUrl = capturePhoto(facingMode);
      if (dataUrl) captured.push(dataUrl);
      triggerFlash();
      setCapturedDots((prev) => { const n = [...prev]; n[i] = true; return n; });
      setPhotoCount(i + 1);
      if (i < PHOTO_COUNT - 1) await doCountdown(COUNTDOWN_SECONDS);
    }

    if (abortRef.current) { setCapturing(false); return; }

    // A camera glitch mid-sequence should not strand the user on a blank strip.
    if (captured.length < PHOTO_COUNT) {
      setCapturing(false);
      setCameraError('Some frames could not be captured. Please try again.');
      return;
    }

    photosRef.current = captured;
    setPhotos(captured);
    setCapturing(false);
    stopCamera();

    setScreen('processing');
    await wait(DEVELOPING_MS);
    if (!abortRef.current) setScreen('result');
  }, [capturing, cameraReady, facingMode, capturePhoto, doCountdown, triggerFlash, stopCamera, wait]);

  // ── STRIP RENDER ──
  // Always settles: a failed or missing image rejects rather than leaving the
  // promise — and the submit spinner — pending forever.
  const generateStripCanvas = useCallback(() => {
    return new Promise((resolve, reject) => {
      const canvas = stripCanvasRef.current;
      const sources = photosRef.current;
      if (!canvas) return reject(new Error('Canvas unavailable'));
      if (sources.length !== PHOTO_COUNT) return reject(new Error('Strip is incomplete'));

      const ctx = canvas.getContext('2d');
      const imgW = 600;
      const imgH = Math.round(imgW / FRAME_ASPECT);
      const pad = 40;
      const gap = 20;
      const botPad = 70;

      canvas.width = imgW + pad * 2;
      canvas.height = pad + (imgH + gap) * PHOTO_COUNT - gap + botPad;
      const W = canvas.width;
      const H = canvas.height;

      ctx.fillStyle = BG_COLORS[selectedBg] || BG_COLORS.white;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = BG_TEXT_COLORS[selectedBg] || BG_TEXT_COLORS.white;
      ctx.font = '700 14px "Courier Prime", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(getDateString(), W / 2, H - 24);

      let loaded = 0;
      let failed = false;

      sources.forEach((src, i) => {
        const img = new Image();
        img.onerror = () => {
          if (failed) return;
          failed = true;
          reject(new Error('A photo could not be rendered'));
        };
        img.onload = () => {
          if (failed) return;
          const y = pad + i * (imgH + gap);
          ctx.drawImage(img, pad, y, imgW, imgH);

          if (selectedFilter !== 'original') {
            const region = ctx.getImageData(pad, y, imgW, imgH);
            const px = region.data;
            for (let pi = 0; pi < px.length; pi += 4) {
              const lum = 0.299 * px[pi] + 0.587 * px[pi + 1] + 0.114 * px[pi + 2];
              if (selectedFilter === 'bw') {
                const v = Math.min(255, Math.max(0, (lum - 128) * 1.06 + 128));
                px[pi] = px[pi + 1] = px[pi + 2] = v;
              } else {
                px[pi] = Math.min(255, lum * 1.10 + 18);
                px[pi + 1] = Math.min(255, lum * 0.94 + 7);
                px[pi + 2] = Math.min(255, lum * 0.72);
              }
            }
            ctx.putImageData(region, pad, y);
          }

          if (++loaded === PHOTO_COUNT) resolve(canvas.toDataURL('image/jpeg', 0.95));
        };
        img.src = src;
      });
    });
  }, [selectedBg, selectedFilter]);

  const saveStrip = useCallback(async () => {
    try {
      const url = await generateStripCanvas();
      const a = document.createElement('a');
      a.download = `vintage-strip-club-${Date.now()}.jpg`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setSubmitError('Could not build your strip image. Please try again.');
    }
  }, [generateStripCanvas]);

  // ── ORDER ──
  const buildOrder = useCallback(() => ({
    email: form.shipEmail.trim(),
    billingAddress: {
      name: form.shipName.trim(),
      line1: form.shipAddr1.trim(),
      line2: form.shipAddr2.trim(),
      city: form.shipCity.trim(),
      state: form.shipState,
      zip: form.shipZip.trim(),
      country: 'US',
    },
    shippingAddress: giftMode
      ? {
        name: giftForm.giftName.trim(),
        line1: giftForm.giftAddr1.trim(),
        line2: giftForm.giftAddr2.trim(),
        city: giftForm.giftCity.trim(),
        state: giftForm.giftState,
        zip: giftForm.giftZip.trim(),
        country: 'US',
      }
      : null,
    isGift: giftMode,
    background: selectedBg,
    filter: selectedFilter,
    quantity: orderQty,
  }), [form, giftForm, giftMode, selectedBg, selectedFilter, orderQty]);

  const submitOrder = useCallback(async (paymentMethod) => {
    if (submitting) return;
    setSubmitError('');

    const order = buildOrder();
    const { valid, errors: found } = validateOrder(order);
    setErrors(found);
    if (!valid) {
      setSubmitError('Please check the highlighted fields.');
      return;
    }

    setSubmitting(true);
    try {
      const stripImage = await generateStripCanvas();
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...order, stripImage, paymentMethod }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.errors) setErrors(body.errors);
        throw new Error(body?.message || 'We could not place your order.');
      }

      setOrderId(body.orderId || '');
      setScreen('confirmation');
    } catch (err) {
      setSubmitError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, buildOrder, generateStripCanvas]);

  // ── NAVIGATION ──
  const leaveCapture = useCallback(() => {
    abortRef.current = true;
    clearTimers();
    setCountdownNum(null);
    setCapturing(false);
    stopCamera();
  }, [clearTimers, stopCamera]);

  const retake = useCallback(async () => {
    setPhotos([]); photosRef.current = [];
    setCapturedDots(EMPTY_DOTS); setPhotoCount(0);
    setSubmitError('');
    abortRef.current = false;
    setScreen('camera');
    await startCamera(facingMode);
  }, [facingMode, startCamera]);

  const startOver = useCallback(() => {
    leaveCapture();
    setPhotos([]); photosRef.current = [];
    setSelectedBg('white'); setSelectedFilter('original');
    setOrderQty(1); setGiftMode(false);
    setForm(EMPTY_FORM); setGiftForm(EMPTY_GIFT);
    setErrors({}); setSubmitError(''); setOrderId('');
    setScreen('landing');
  }, [leaveCapture]);

  const goToOrder = useCallback(() => {
    setOrderQty(1); setGiftMode(false); setErrors({}); setSubmitError('');
    setScreen('order');
  }, []);

  // Release camera and timers on unmount.
  useEffect(() => () => {
    abortRef.current = true;
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
  }, []);

  // Release the camera whenever the app is backgrounded outside capture.
  useEffect(() => {
    const onHide = () => { if (document.hidden && screen !== 'camera') stopCamera(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [screen, stopCamera]);

  const total = orderQty * UNIT_PRICE + SHIPPING;
  const stripDate = getDateString();

  return (
    <>
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      <canvas ref={stripCanvasRef} className="hidden" aria-hidden="true" />

      {/* ═══ LANDING ═══ */}
      {screen === 'landing' && (
        <div className="min-h-dvh flex flex-col items-center justify-center relative overflow-hidden" style={{ background: '#CEFCE9' }}>
          <div className="relative z-10 text-center p-8">
            <div className="fade-in mx-auto mb-8">
              <div className="font-[Playfair_Display,serif] font-black text-[1.4rem] tracking-[0.18em] uppercase mb-2" style={{ color: '#3A3A3A' }}>Vintage</div>
              <div className="mx-auto w-[72px] rounded-[4px] flex flex-col gap-[5px] py-[8px] px-[7px]" style={{ background: '#3A3A3A', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
                {STRIP_LETTERS.map((letter) => (
                  <div key={letter} className="w-full aspect-[4/3] rounded-[2px] flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
                    <span className="font-[Playfair_Display,serif] font-black text-[1rem] tracking-wide" style={{ color: '#CEFCE9' }}>{letter}</span>
                  </div>
                ))}
              </div>
              <div className="font-[Playfair_Display,serif] font-black text-[1.4rem] tracking-[0.18em] uppercase mt-2" style={{ color: '#3A3A3A' }}>Club</div>
            </div>

            <p className="fade-in fade-in-delay font-[DM_Mono,monospace] text-[0.6rem] tracking-[0.4em] uppercase mb-10" style={{ color: '#3A3A3A' }}>A timeless vestige of physicality in a virtual world</p>

            <button onClick={handleStart} className="fade-in fade-in-delay-2 inline-flex items-center justify-center w-[140px] h-[140px] rounded-full bg-white font-[Courier_Prime,monospace] font-bold text-lg tracking-[0.2em] uppercase cursor-pointer transition-all active:scale-[0.92]" style={{ color: '#3A3A3A', border: '4px solid rgba(58,58,58,0.1)', boxShadow: '0 0 0 8px rgba(58,58,58,0.06), 0 8px 32px rgba(0,0,0,0.1)' }}>Start</button>
          </div>
        </div>
      )}

      {/* ═══ CAMERA ═══ */}
      {screen === 'camera' && (
        <div className="min-h-dvh flex flex-col bg-black relative">
          <button onClick={() => { leaveCapture(); setScreen('landing'); }} aria-label="Back to start" className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-40 w-9 h-9 rounded-full bg-white/10 border border-white/25 text-cream flex items-center justify-center backdrop-blur-lg active:scale-90">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>

          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            {/* The preview is constrained to the same 4:3 box we capture, so what
                is framed on screen is exactly what lands on the strip. */}
            <div className="relative w-full aspect-[4/3] overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
              />

              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-6">
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cream/40" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cream/40" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cream/40" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cream/40" />
                </div>
              </div>

              {capturing && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 bg-black/50 rounded-full backdrop-blur-lg">
                  <div className="w-2 h-2 rounded-full bg-red blink" />
                  <span className="text-[0.65rem] tracking-[0.15em] uppercase text-cream">Capturing</span>
                </div>
              )}

              <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1.5">
                {capturedDots.map((done, i) => (
                  <div key={i} className={`w-2.5 h-2.5 rounded-sm border-[1.5px] transition-all ${done ? 'bg-gold border-gold shadow-[0_0_8px_rgba(212,168,83,0.4)]' : 'border-cream/30'}`} />
                ))}
              </div>

              {countdownNum !== null && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none" aria-live="polite">
                  <span key={countdownNum} className="countdown-anim font-[Playfair_Display,serif] font-black text-[8rem] text-cream leading-none" style={{ textShadow: '0 0 60px rgba(0,0,0,0.6)' }}>{countdownNum}</span>
                </div>
              )}

              <div className={`absolute inset-0 z-30 bg-white pointer-events-none ${flashActive ? 'flash' : 'opacity-0'}`} />
            </div>

            {cameraError && (
              <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-dark/95 px-8 text-center">
                <p className="text-[0.75rem] text-cream/80 leading-relaxed max-w-[300px] mb-6">{cameraError}</p>
                <button onClick={() => startCamera(facingMode)} className="py-3 px-6 rounded-md border border-cream/20 text-cream text-[0.65rem] tracking-[0.1em] uppercase active:scale-95">Try again</button>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 z-20 px-6 py-6 flex items-center justify-center gap-8" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
              <button onClick={flipCamera} disabled={capturing} aria-label="Switch camera" className="w-12 h-12 rounded-full bg-white/10 border border-white/25 text-cream flex items-center justify-center backdrop-blur-lg active:scale-90 transition-all disabled:opacity-30 disabled:pointer-events-none">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 4v6h6" /><path d="M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
              </button>
              <button onClick={startCapture} disabled={capturing || !cameraReady} className="w-[76px] h-[76px] rounded-full bg-red border-[3px] border-white/30 text-cream font-[Courier_Prime,monospace] font-bold text-sm tracking-[0.15em] uppercase transition-all active:scale-[0.92] disabled:opacity-40 disabled:pointer-events-none" style={{ boxShadow: '0 0 0 5px rgba(196,58,43,0.2), 0 4px 20px rgba(0,0,0,0.4)' }}>Go</button>
              <div className="w-12 h-12 flex items-center justify-center font-medium text-[0.7rem] text-cream/50 tracking-wider" aria-live="polite">{photoCount} / {PHOTO_COUNT}</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PROCESSING ═══ */}
      {screen === 'processing' && (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-dark">
          <div className="text-center">
            <div className="w-10 h-[100px] bg-cream rounded-sm mx-auto mb-8 process-bob" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }} />
            <div className="text-[0.65rem] tracking-[0.3em] uppercase text-gold">Developing your strip…</div>
          </div>
        </div>
      )}

      {/* ═══ RESULT ═══ */}
      {screen === 'result' && (
        <div className="min-h-dvh flex flex-col items-center bg-dark px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="text-center mb-3">
            <h2 className="font-[Playfair_Display,serif] font-black text-xl tracking-[0.1em] uppercase">Your Strip</h2>
          </div>

          <div className="flex-1 flex items-center justify-center w-full overflow-hidden py-2">
            <div
              className="photo-strip flex flex-col gap-[5px] rounded-sm relative -rotate-1"
              data-date={stripDate}
              style={{ background: BG_COLORS[selectedBg], padding: '10px 10px 26px 10px', boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)', '--strip-text-color': BG_TEXT_COLORS[selectedBg] }}
            >
              {photos.map((src, i) => (
                <img key={i} src={src} alt={`Frame ${i + 1} of ${PHOTO_COUNT}`} className="w-[170px] aspect-[4/3] object-cover block rounded-[1px]" style={{ filter: getFilterCSS(selectedFilter), animation: `fadeIn 0.4s ease-out ${i * 0.1}s forwards`, opacity: 0 }} />
              ))}
            </div>
          </div>

          {submitError && <p className="text-[0.6rem] text-red mb-2" role="alert">{submitError}</p>}

          <div className="flex gap-2.5 mt-3 w-full max-w-[360px]">
            <button onClick={retake} className="flex-1 py-3.5 px-2 rounded-md font-[DM_Mono,monospace] text-[0.6rem] font-medium tracking-[0.08em] uppercase text-cream border border-cream/15 bg-transparent active:scale-[0.96] transition-all">Retake</button>
            <button onClick={saveStrip} className="flex-1 py-3.5 px-2 rounded-md font-[DM_Mono,monospace] text-[0.6rem] font-medium tracking-[0.08em] uppercase text-gold border border-gold/30 bg-transparent active:scale-[0.96] transition-all">Save</button>
            <button onClick={goToOrder} className="flex-1 py-3.5 px-2 rounded-md font-[DM_Mono,monospace] text-[0.6rem] font-medium tracking-[0.08em] uppercase text-cream bg-red border-none active:scale-[0.96] transition-all">Ship It</button>
          </div>

          <div className="w-full max-w-[360px] mt-3">
            <div className="text-[0.55rem] tracking-[0.15em] uppercase text-cream/40 mb-2 text-center">Photo Style</div>
            <div className="flex gap-2 justify-center">
              {['original', 'bw', 'sepia'].map((f) => (
                <button key={f} onClick={() => setSelectedFilter(f)} aria-pressed={selectedFilter === f} className={`px-3 py-1.5 rounded-full text-[0.55rem] tracking-[0.1em] uppercase transition-all active:scale-[0.94] border ${selectedFilter === f ? 'border-gold text-gold bg-gold/[0.08]' : 'border-cream/10 text-cream/50 bg-transparent'}`}>
                  {f === 'bw' ? 'B&W' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="w-full max-w-[360px] mt-3">
            <div className="text-[0.55rem] tracking-[0.15em] uppercase text-cream/40 mb-2 text-center">Strip Background</div>
            <div className="flex gap-2 justify-center">
              {Object.entries(BG_COLORS).map(([key, color]) => (
                <button key={key} onClick={() => setSelectedBg(key)} aria-label={`${key} background`} aria-pressed={selectedBg === key} className={`w-12 h-12 rounded-lg transition-all active:scale-[0.92] border-2 ${selectedBg === key ? 'border-gold shadow-[0_0_0_2px_rgba(212,168,83,0.3),0_2px_8px_rgba(0,0,0,0.3)]' : 'border-cream/10'}`} style={{ background: color }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ ORDER ═══ */}
      {screen === 'order' && (
        <div className="min-h-dvh flex flex-col bg-dark px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto">
          <div className="flex items-center gap-4 mb-6">
            <button onClick={() => setScreen('result')} aria-label="Back to strip" className="w-9 h-9 rounded-full bg-cream/[0.06] border border-cream/15 text-cream flex items-center justify-center active:scale-90 shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <h2 className="font-[Playfair_Display,serif] font-black text-xl tracking-wider">Ship Your Strip</h2>
          </div>

          {TEST_MODE && (
            <div className="mb-5 px-4 py-3 rounded-lg border border-gold/30 bg-gold/[0.07]">
              <p className="text-[0.62rem] text-gold leading-relaxed">
                Preview mode — payments are not live yet. Submitting this form does not charge you, and no strip will be printed or shipped.
              </p>
            </div>
          )}

          <div className="flex gap-4 p-4 bg-cream/[0.06] border border-cream/15 rounded-xl mb-6">
            <div className="w-14 shrink-0">
              <div className="w-14 rounded-sm p-1 flex flex-col gap-0.5" style={{ background: BG_COLORS[selectedBg] }}>
                {photos.map((src, i) => (
                  <div key={i} className="w-full aspect-[4/3] rounded-[1px] overflow-hidden bg-film-border">
                    <img src={src} className="w-full h-full object-cover" style={{ filter: getFilterCSS(selectedFilter) }} alt="" />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <div className="font-[Courier_Prime,monospace] font-bold text-sm tracking-wider mb-1">Printed Photo Strip</div>
              <div className="text-[0.6rem] text-cream/50 leading-relaxed mb-2">Glossy {PHOTO_COUNT}-frame strip on premium cardstock. Mailed in a rigid mailer.</div>
              <div className="font-[Playfair_Display,serif] font-bold text-lg text-gold">{formatCents(UNIT_PRICE)} <span className="font-[DM_Mono,monospace] text-[0.55rem] font-normal text-cream/40">each</span></div>
              <div className="flex items-center gap-2.5 mt-2.5">
                <button onClick={() => setOrderQty((q) => Math.max(1, q - 1))} disabled={orderQty <= 1} aria-label="Decrease quantity" className="w-[30px] h-[30px] rounded-full bg-cream/[0.06] border border-cream/15 text-cream text-base flex items-center justify-center active:scale-90 disabled:opacity-25 disabled:pointer-events-none transition-all">−</button>
                <span className="font-[Courier_Prime,monospace] font-bold text-sm min-w-[1.5rem] text-center" aria-live="polite">{orderQty}</span>
                <button onClick={() => setOrderQty((q) => Math.min(MAX_QTY, q + 1))} disabled={orderQty >= MAX_QTY} aria-label="Increase quantity" className="w-[30px] h-[30px] rounded-full bg-cream/[0.06] border border-cream/15 text-cream text-base flex items-center justify-center active:scale-90 disabled:opacity-25 disabled:pointer-events-none transition-all">+</button>
              </div>
            </div>
          </div>

          <FormSection label="Your Details">
            <FormRow><FormField label="Full Name" htmlFor="shipName"><Input id="shipName" value={form.shipName} error={errors.shipName} onChange={(v) => setForm((f) => ({ ...f, shipName: v }))} placeholder="Jane Doe" autoComplete="name" maxLength={LIMITS.name} /></FormField></FormRow>
            <FormRow><FormField label="Email" htmlFor="shipEmail"><Input id="shipEmail" type="email" value={form.shipEmail} error={errors.shipEmail} onChange={(v) => setForm((f) => ({ ...f, shipEmail: v }))} placeholder="jane@example.com" autoComplete="email" maxLength={LIMITS.email} /></FormField></FormRow>
            <FormRow><FormField label="Address Line 1" htmlFor="shipAddr1"><Input id="shipAddr1" value={form.shipAddr1} error={errors.shipAddr1} onChange={(v) => setForm((f) => ({ ...f, shipAddr1: v }))} placeholder="123 Main St" autoComplete="address-line1" maxLength={LIMITS.line} /></FormField></FormRow>
            <FormRow><FormField label="Address Line 2" htmlFor="shipAddr2"><Input id="shipAddr2" value={form.shipAddr2} onChange={(v) => setForm((f) => ({ ...f, shipAddr2: v }))} placeholder="Apt 4B" autoComplete="address-line2" maxLength={LIMITS.line} /></FormField></FormRow>
            <FormRow>
              <FormField label="City" htmlFor="shipCity"><Input id="shipCity" value={form.shipCity} error={errors.shipCity} onChange={(v) => setForm((f) => ({ ...f, shipCity: v }))} placeholder="Brooklyn" autoComplete="address-level2" maxLength={LIMITS.city} /></FormField>
              <FormField label="State" htmlFor="shipState" half><StateSelect id="shipState" value={form.shipState} error={errors.shipState} onChange={(v) => setForm((f) => ({ ...f, shipState: v }))} /></FormField>
            </FormRow>
            <FormRow>
              <FormField label="ZIP" htmlFor="shipZip" half><Input id="shipZip" value={form.shipZip} error={errors.shipZip} onChange={(v) => setForm((f) => ({ ...f, shipZip: v }))} placeholder="11231" inputMode="numeric" maxLength={LIMITS.zip} autoComplete="postal-code" /></FormField>
              <FormField label="Country" htmlFor="shipCountry"><select id="shipCountry" className="field-input w-full py-2.5 px-3 bg-cream/[0.06] border-[1.5px] border-cream/15 rounded-md text-cream font-[DM_Mono,monospace] text-xs outline-none" defaultValue="US"><option value="US">United States</option></select></FormField>
            </FormRow>
          </FormSection>

          <label className="flex items-center gap-2.5 mt-1 mb-1 cursor-pointer select-none">
            <input type="checkbox" className="sr-only" checked={giftMode} onChange={(e) => setGiftMode(e.target.checked)} />
            <span className={`w-5 h-5 rounded flex items-center justify-center transition-all border-[1.5px] ${giftMode ? 'bg-gold border-gold' : 'bg-cream/[0.06] border-cream/15'}`}>
              {giftMode && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1A1714" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>}
            </span>
            <span className="text-[0.65rem] tracking-wider text-cream/60">For someone else?</span>
          </label>

          {giftMode && (
            <div className="mt-4 pt-4 border-t border-cream/15">
              <FormSection label="Ship To">
                <FormRow><FormField label="Recipient Name" htmlFor="giftName"><Input id="giftName" value={giftForm.giftName} error={errors.giftName} onChange={(v) => setGiftForm((f) => ({ ...f, giftName: v }))} placeholder="Recipient's full name" maxLength={LIMITS.name} /></FormField></FormRow>
                <FormRow><FormField label="Address Line 1" htmlFor="giftAddr1"><Input id="giftAddr1" value={giftForm.giftAddr1} error={errors.giftAddr1} onChange={(v) => setGiftForm((f) => ({ ...f, giftAddr1: v }))} placeholder="123 Main St" maxLength={LIMITS.line} /></FormField></FormRow>
                <FormRow><FormField label="Address Line 2" htmlFor="giftAddr2"><Input id="giftAddr2" value={giftForm.giftAddr2} onChange={(v) => setGiftForm((f) => ({ ...f, giftAddr2: v }))} placeholder="Apt 4B" maxLength={LIMITS.line} /></FormField></FormRow>
                <FormRow>
                  <FormField label="City" htmlFor="giftCity"><Input id="giftCity" value={giftForm.giftCity} error={errors.giftCity} onChange={(v) => setGiftForm((f) => ({ ...f, giftCity: v }))} placeholder="Brooklyn" maxLength={LIMITS.city} /></FormField>
                  <FormField label="State" htmlFor="giftState" half><StateSelect id="giftState" value={giftForm.giftState} error={errors.giftState} onChange={(v) => setGiftForm((f) => ({ ...f, giftState: v }))} /></FormField>
                </FormRow>
                <FormRow>
                  <FormField label="ZIP" htmlFor="giftZip" half><Input id="giftZip" value={giftForm.giftZip} error={errors.giftZip} onChange={(v) => setGiftForm((f) => ({ ...f, giftZip: v }))} placeholder="11231" inputMode="numeric" maxLength={LIMITS.zip} /></FormField>
                  <FormField label="Country" htmlFor="giftCountry"><select id="giftCountry" className="field-input w-full py-2.5 px-3 bg-cream/[0.06] border-[1.5px] border-cream/15 rounded-md text-cream font-[DM_Mono,monospace] text-xs outline-none" defaultValue="US"><option value="US">United States</option></select></FormField>
                </FormRow>
              </FormSection>
            </div>
          )}

          <FormSection label="Payment">
            <button onClick={() => submitOrder('apple_pay')} disabled={submitting} className="w-full py-3.5 rounded-md bg-white text-black font-semibold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] active:opacity-85 disabled:opacity-50 disabled:pointer-events-none transition-all">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" /></svg>
              <span>Pay</span>
            </button>
            <div className="flex items-center gap-3 my-4">
              <span className="flex-1 h-px bg-cream/15" />
              <span className="text-[0.55rem] tracking-[0.1em] uppercase text-cream/30 whitespace-nowrap">or pay with card</span>
              <span className="flex-1 h-px bg-cream/15" />
            </div>
            <div className="py-3 px-3 bg-cream/[0.06] border-[1.5px] border-cream/15 rounded-md min-h-[44px] flex items-center">
              <span className="text-[0.65rem] text-cream/30 tracking-wider">Card entry appears here once Stripe is connected</span>
            </div>
          </FormSection>

          <div className="h-px bg-cream/15 my-5" />

          <div className="mb-5">
            <div className="flex justify-between items-center mb-2"><span className="text-[0.65rem] text-cream/50">Photo strip × {orderQty}</span><span className="text-[0.65rem]">{formatCents(orderQty * UNIT_PRICE)}</span></div>
            <div className="flex justify-between items-center mb-2"><span className="text-[0.65rem] text-cream/50">Shipping</span><span className="text-[0.65rem]">{SHIPPING === 0 ? 'Free' : formatCents(SHIPPING)}</span></div>
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-cream/15"><span className="text-[0.7rem] font-medium text-cream">Total</span><span className="font-[Playfair_Display,serif] font-bold text-base text-gold">{formatCents(total)}</span></div>
          </div>

          {submitError && <p className="text-[0.6rem] text-red mb-3" role="alert">{submitError}</p>}

          <button onClick={() => submitOrder('card')} disabled={submitting} className="w-full py-4 rounded-lg bg-red text-cream font-[Courier_Prime,monospace] font-bold text-sm tracking-[0.15em] uppercase active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all" style={{ boxShadow: '0 4px 16px rgba(196,58,43,0.25)' }}>
            {submitting
              ? <span className="block w-[18px] h-[18px] border-2 border-white/30 border-t-cream rounded-full mx-auto" style={{ animation: 'spin 0.6s linear infinite' }} />
              : <span>{TEST_MODE ? 'Submit Preview Order' : `Place Order — ${formatCents(total)}`}</span>}
          </button>

          <div className="flex items-center justify-center gap-1.5 mt-3 text-[0.55rem] text-cream/25 tracking-wider">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Submitted over an encrypted connection
          </div>
        </div>
      )}

      {/* ═══ CONFIRMATION ═══ */}
      {screen === 'confirmation' && (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-dark p-8 text-center">
          <div className="scale-in w-[72px] h-[72px] rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4A9B6E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h2 className="font-[Playfair_Display,serif] font-black text-2xl tracking-wider mb-3">{TEST_MODE ? 'Preview Received' : 'Order Placed'}</h2>
          <p className="text-[0.7rem] text-cream/55 leading-relaxed max-w-[290px] mx-auto mb-2">
            {TEST_MODE
              ? 'This was a preview submission. You have not been charged and nothing will be shipped. Payments go live once Stripe is connected.'
              : 'Your photo strip is being printed and will ship within 2–3 business days. A confirmation email is on its way.'}
          </p>
          {orderId && <div className="font-[Courier_Prime,monospace] text-[0.65rem] text-gold tracking-[0.15em] mb-8">Reference {orderId}</div>}
          <button onClick={startOver} className="py-3.5 px-8 rounded-md bg-transparent border border-cream/15 text-cream font-[DM_Mono,monospace] text-[0.65rem] font-medium tracking-[0.1em] uppercase active:scale-[0.96] transition-all">Take Another Strip</button>
        </div>
      )}
    </>
  );
}

// ── FORM PRIMITIVES ──
function FormSection({ label, children }) {
  return (
    <div className="mb-5">
      <div className="text-[0.6rem] tracking-[0.2em] uppercase text-gold mb-3 pb-1.5 border-b border-gold/15">{label}</div>
      {children}
    </div>
  );
}

function FormRow({ children }) {
  return <div className="flex gap-3 mb-3">{children}</div>;
}

function FormField({ label, half, htmlFor, children }) {
  return (
    <div className={`flex flex-col ${half ? 'flex-[0.5]' : 'flex-1'}`}>
      <label htmlFor={htmlFor} className="text-[0.55rem] tracking-[0.1em] uppercase text-cream/45 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, error, id, ...props }) {
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? 'true' : undefined}
      className={`field-input w-full py-2.5 px-3 bg-cream/[0.06] border-[1.5px] rounded-md text-cream font-[DM_Mono,monospace] text-xs outline-none transition-colors ${error ? 'border-red' : 'border-cream/15'} focus:border-gold/40 placeholder:text-cream/20`}
      style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
      {...props}
    />
  );
}

function StateSelect({ value, onChange, error, id }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? 'true' : undefined}
      className={`field-input w-full py-2.5 px-3 bg-cream/[0.06] border-[1.5px] rounded-md text-cream font-[DM_Mono,monospace] text-xs outline-none transition-colors ${error ? 'border-red' : 'border-cream/15'} focus:border-gold/40`}
    >
      <option value="">—</option>
      {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}
