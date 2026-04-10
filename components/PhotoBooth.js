'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ── CONSTANTS ──
const UNIT_PRICE = 1000;
const SHIPPING = 0;
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
const BG_TEXT_COLORS = { white: '#2A2520', black: '#F5F0E8', pink: '#2A2520' };
const BG_COLORS = { white: '#F5F0E8', black: '#1A1714', pink: '#FFCCFF' };

function formatCents(c) { return '$' + (c / 100).toFixed(2); }
function getDateString() {
  const d = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function getFilterCSS(f) {
  if (f === 'bw') return 'grayscale(1) contrast(1.1) brightness(1.02)';
  if (f === 'sepia') return 'sepia(0.8) contrast(1.05) saturate(0.85) brightness(1.02)';
  return 'contrast(1.05) saturate(0.9) brightness(1.02)';
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── MAIN COMPONENT ──
export default function PhotoBooth() {
  const [screen, setScreen] = useState('landing');
  const [photos, setPhotos] = useState([]);
  const [selectedBg, setSelectedBg] = useState('white');
  const [selectedFilter, setSelectedFilter] = useState('original');
  const [facingMode, setFacingMode] = useState('user');
  const [capturing, setCapturing] = useState(false);
  const [countdownNum, setCountdownNum] = useState(null);
  const [flashActive, setFlashActive] = useState(false);
  const [capturedDots, setCapturedDots] = useState([false,false,false,false,false]);
  const [photoCount, setPhotoCount] = useState(0);
  const [showIndicator, setShowIndicator] = useState(false);
  const [orderQty, setOrderQty] = useState(1);
  const [giftMode, setGiftMode] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form refs
  const [form, setForm] = useState({ shipName:'',shipEmail:'',shipAddr1:'',shipAddr2:'',shipCity:'',shipState:'',shipZip:'' });
  const [giftForm, setGiftForm] = useState({ giftName:'',giftAddr1:'',giftAddr2:'',giftCity:'',giftState:'',giftZip:'' });
  const [errors, setErrors] = useState({});

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const stripCanvasRef = useRef(null);
  const photosRef = useRef([]);

  // ── CAMERA ──
  const startCamera = useCallback(async (facing) => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing || facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.style.transform = (facing || facingMode) === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
      }
    } catch {
      alert('Camera access is required. Please allow camera permissions and try again.');
      setScreen('landing');
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  }, []);

  const handleStart = useCallback(async () => {
    setScreen('camera');
    await sleep(100);
    await startCamera('user');
  }, [startCamera]);

  const flipCamera = useCallback(async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    await startCamera(next);
  }, [facingMode, startCamera]);

  // ── CAPTURE ──
  const capturePhoto = useCallback((fm) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (fm === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Warm film tone
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let p = 0; p < d.length; p += 4) {
      d[p] = Math.min(255, d[p] * 1.03 + 4);
      d[p+1] = Math.min(255, d[p+1] * 1.0 + 1);
      d[p+2] = Math.max(0, d[p+2] * 0.95 - 2);
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  const doCountdown = useCallback((seconds) => {
    return new Promise(resolve => {
      let count = seconds;
      const tick = () => {
        if (count <= 0) { setCountdownNum(null); resolve(); return; }
        setCountdownNum(count);
        count--;
        setTimeout(tick, 1000);
      };
      tick();
    });
  }, []);

  const triggerFlash = useCallback(() => {
    setFlashActive(false);
    requestAnimationFrame(() => setFlashActive(true));
    setTimeout(() => setFlashActive(false), 350);
  }, []);

  const startCapture = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    const captured = [];
    setCapturedDots([false,false,false,false,false]);
    setPhotoCount(0);

    await doCountdown(3);

    for (let i = 0; i < 5; i++) {
      const dataUrl = capturePhoto(facingMode);
      if (dataUrl) captured.push(dataUrl);
      triggerFlash();
      setCapturedDots(prev => { const n = [...prev]; n[i] = true; return n; });
      setPhotoCount(i + 1);
      setShowIndicator(true);
      if (i < 4) await doCountdown(3);
    }

    photosRef.current = captured;
    setPhotos(captured);
    setCapturing(false);
    setShowIndicator(false);
    stopCamera();

    setScreen('processing');
    await sleep(1200);
    setScreen('result');
  }, [capturing, facingMode, capturePhoto, doCountdown, triggerFlash, stopCamera]);

  // ── STRIP CANVAS GENERATION ──
  const generateStripCanvas = useCallback(() => {
    return new Promise(resolve => {
      const canvas = stripCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const imgW = 600, imgH = imgW * 3 / 4, pad = 40, gap = 20, botPad = 70;
      canvas.width = imgW + pad * 2;
      canvas.height = pad + (imgH + gap) * 5 - gap + botPad;
      const W = canvas.width, H = canvas.height;

      ctx.fillStyle = BG_COLORS[selectedBg] || '#F5F0E8';
      ctx.fillRect(0, 0, W, H);

      const textColor = BG_TEXT_COLORS[selectedBg] || '#2A2520';
      ctx.fillStyle = textColor;
      ctx.font = '700 14px "Courier Prime", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(getDateString(), W / 2, H - 24);

      let loaded = 0;
      const p = photosRef.current;
      p.forEach((src, i) => {
        const img = new Image();
        img.onload = () => {
          const y = pad + i * (imgH + gap);
          ctx.drawImage(img, pad, y, imgW, imgH);
          if (selectedFilter !== 'original') {
            const photoData = ctx.getImageData(pad, y, imgW, imgH);
            const px = photoData.data;
            for (let pi = 0; pi < px.length; pi += 4) {
              const r = px[pi], g = px[pi+1], b = px[pi+2];
              if (selectedFilter === 'bw') {
                const lum = 0.299*r + 0.587*g + 0.114*b;
                const v = Math.min(255, Math.max(0, (lum - 128) * 1.1 + 128));
                px[pi] = px[pi+1] = px[pi+2] = v;
              } else if (selectedFilter === 'sepia') {
                const lum = 0.299*r + 0.587*g + 0.114*b;
                px[pi] = Math.min(255, lum * 1.12 + 20);
                px[pi+1] = Math.min(255, lum * 0.95 + 8);
                px[pi+2] = Math.min(255, lum * 0.7);
              }
            }
            ctx.putImageData(photoData, pad, y);
          }
          if (++loaded === 5) resolve(canvas.toDataURL('image/jpeg', 0.95));
        };
        img.src = src;
      });
    });
  }, [selectedBg, selectedFilter]);

  const saveStrip = useCallback(async () => {
    const url = await generateStripCanvas();
    const a = document.createElement('a');
    a.download = `photobooth-strip-${Date.now()}.jpg`;
    a.href = url;
    a.click();
  }, [generateStripCanvas]);

  // ── VALIDATION ──
  const validate = useCallback(() => {
    const errs = {};
    const req = ['shipName','shipEmail','shipAddr1','shipCity','shipState','shipZip'];
    req.forEach(k => { if (!form[k]?.trim()) errs[k] = true; });
    if (form.shipEmail && !form.shipEmail.includes('@')) errs.shipEmail = true;
    if (giftMode) {
      ['giftName','giftAddr1','giftCity','giftState','giftZip'].forEach(k => {
        if (!giftForm[k]?.trim()) errs[k] = true;
      });
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form, giftForm, giftMode]);

  const getShippingAddress = useCallback(() => {
    if (giftMode) return { name: giftForm.giftName, line1: giftForm.giftAddr1, line2: giftForm.giftAddr2, city: giftForm.giftCity, state: giftForm.giftState, zip: giftForm.giftZip, country: 'US' };
    return { name: form.shipName, line1: form.shipAddr1, line2: form.shipAddr2, city: form.shipCity, state: form.shipState, zip: form.shipZip, country: 'US' };
  }, [form, giftForm, giftMode]);

  // ── ORDER ──
  const buildOrderData = useCallback(async (paymentMethod) => {
    const stripDataUrl = await generateStripCanvas();
    return {
      name: form.shipName, email: form.shipEmail,
      billingAddress: { line1: form.shipAddr1, line2: form.shipAddr2, city: form.shipCity, state: form.shipState, zip: form.shipZip, country: 'US' },
      shippingAddress: getShippingAddress(),
      isGift: giftMode, stripImage: stripDataUrl, background: selectedBg, filter: selectedFilter,
      quantity: orderQty, unitPrice: UNIT_PRICE, shipping: SHIPPING,
      amount: orderQty * UNIT_PRICE + SHIPPING, paymentMethod,
    };
  }, [form, giftMode, selectedBg, selectedFilter, orderQty, getShippingAddress, generateStripCanvas]);

  const [orderId, setOrderId] = useState('');

  const processOrder = useCallback(async () => {
    if (!validate()) return;
    setLoading(true);
    const data = await buildOrderData('card');
    console.log('Order payload:', { ...data, stripImage: '[base64]' });
    await sleep(2000);
    setLoading(false);
    const id = 'PB-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    setOrderId(id);
    setScreen('confirmation');
  }, [validate, buildOrderData]);

  const handleApplePay = useCallback(async () => {
    if (!validate()) return;
    setLoading(true);
    const data = await buildOrderData('apple_pay');
    console.log('Apple Pay order:', { ...data, stripImage: '[base64]' });
    await sleep(1500);
    setLoading(false);
    const id = 'PB-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    setOrderId(id);
    setScreen('confirmation');
  }, [validate, buildOrderData]);

  // ── RESET ──
  const retake = useCallback(async () => {
    setPhotos([]); photosRef.current = [];
    setCapturedDots([false,false,false,false,false]); setPhotoCount(0);
    setScreen('camera');
    await sleep(100);
    await startCamera(facingMode);
  }, [facingMode, startCamera]);

  const startOver = useCallback(() => {
    setPhotos([]); photosRef.current = [];
    setSelectedBg('white'); setSelectedFilter('original');
    setOrderQty(1); setGiftMode(false);
    setForm({ shipName:'',shipEmail:'',shipAddr1:'',shipAddr2:'',shipCity:'',shipState:'',shipZip:'' });
    setGiftForm({ giftName:'',giftAddr1:'',giftAddr2:'',giftCity:'',giftState:'',giftZip:'' });
    setErrors({});
    setScreen('landing');
  }, []);

  // Clean up camera on unmount
  useEffect(() => { return () => { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); }; }, []);

  // Stop camera when leaving camera screen
  useEffect(() => { if (screen !== 'camera') stopCamera(); }, [screen, stopCamera]);

  const total = orderQty * UNIT_PRICE + SHIPPING;

  // ══════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════

  return (
    <>
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={stripCanvasRef} className="hidden" />

      {/* ═══ LANDING ═══ */}
      {screen === 'landing' && (
        <div className="min-h-dvh flex flex-col items-center justify-center relative overflow-hidden" style={{ background: '#CEFCE9' }}>
          <div className="relative z-10 text-center p-8">
            <div className="w-20 h-[100px] mx-auto mb-8 fade-in">
              <div className="booth-icon"><div className="strip w-9 h-[90px] rounded-sm mx-auto relative" style={{ background: '#3A3A3A', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }} /></div>
            </div>
            <h1 className="fade-in fade-in-delay font-[Playfair_Display,serif] font-black text-5xl tracking-[0.15em] uppercase leading-none mb-6" style={{ color: '#3A3A3A' }}>Photo<br/>Booth</h1>
            <p className="fade-in fade-in-delay font-[DM_Mono,monospace] text-[0.6rem] tracking-[0.4em] uppercase mb-10" style={{ color: '#3A3A3A' }}>A timeless vestige of physicality in a virtual world</p>
            <button onClick={handleStart} className="fade-in fade-in-delay-2 inline-flex items-center justify-center w-[140px] h-[140px] rounded-full bg-white font-[Courier_Prime,monospace] font-bold text-lg tracking-[0.2em] uppercase cursor-pointer transition-all active:scale-[0.92]" style={{ color: '#3A3A3A', border: '4px solid rgba(58,58,58,0.1)', boxShadow: '0 0 0 8px rgba(58,58,58,0.06), 0 8px 32px rgba(0,0,0,0.1)' }}>Start</button>
          </div>
        </div>
      )}

      {/* ═══ CAMERA ═══ */}
      {screen === 'camera' && (
        <div className="min-h-dvh flex flex-col bg-black relative">
          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

            {/* HUD Corners */}
            <div className="absolute inset-0 pointer-events-none z-5">
              <div className="absolute inset-6">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cream/40" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cream/40" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cream/40" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cream/40" />
              </div>
            </div>

            {/* Capture Indicator */}
            {showIndicator && (
              <div className="absolute top-[max(1rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-15 flex items-center gap-2 px-4 py-2 bg-black/50 rounded-full backdrop-blur-lg">
                <div className="w-2 h-2 rounded-full bg-red blink" />
                <span className="text-[0.65rem] tracking-[0.15em] uppercase text-cream">Capturing</span>
              </div>
            )}

            {/* Strip Progress */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 z-15 flex flex-col gap-1.5">
              {capturedDots.map((done, i) => (
                <div key={i} className={`w-2.5 h-2.5 rounded-sm border-[1.5px] transition-all ${done ? 'bg-gold border-gold shadow-[0_0_8px_rgba(212,168,83,0.4)]' : 'border-cream/30'}`} />
              ))}
            </div>

            {/* Countdown */}
            {countdownNum !== null && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                <span key={countdownNum} className="countdown-anim font-[Playfair_Display,serif] font-black text-[8rem] text-cream leading-none" style={{ textShadow: '0 0 60px rgba(0,0,0,0.6)' }}>{countdownNum}</span>
              </div>
            )}

            {/* Flash */}
            <div className={`absolute inset-0 z-25 bg-white/95 pointer-events-none ${flashActive ? 'flash' : 'opacity-0'}`} />

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 z-10 px-6 py-6 flex items-center justify-center gap-8" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
              <button onClick={flipCamera} className="w-12 h-12 rounded-full bg-white/10 border border-white/25 text-cream flex items-center justify-center backdrop-blur-lg active:scale-90 transition-all">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
              </button>
              <button onClick={startCapture} disabled={capturing} className="w-[76px] h-[76px] rounded-full bg-red border-[3px] border-white/30 text-cream font-[Courier_Prime,monospace] font-bold text-sm tracking-[0.15em] uppercase cursor-pointer transition-all active:scale-[0.92] disabled:opacity-40 disabled:pointer-events-none" style={{ boxShadow: '0 0 0 5px rgba(196,58,43,0.2), 0 4px 20px rgba(0,0,0,0.4)' }}>Go</button>
              <div className="w-12 h-12 flex items-center justify-center font-medium text-[0.7rem] text-cream/50 tracking-wider">{photoCount} / 5</div>
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
            <div className="photo-strip flex flex-col gap-[5px] rounded-sm relative -rotate-1" data-date={getDateString()} style={{ background: BG_COLORS[selectedBg], padding: '10px 10px 26px 10px', boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)', '--strip-text-color': BG_TEXT_COLORS[selectedBg] }}>
              {photos.map((src, i) => (
                <img key={i} src={src} alt={`Frame ${i+1}`} className="w-[160px] aspect-[4/3] object-cover block rounded-[1px]" style={{ filter: getFilterCSS(selectedFilter), animation: `fadeIn 0.4s ease-out ${i * 0.1}s forwards`, opacity: 0 }} />
              ))}
            </div>
          </div>

          <div className="flex gap-2.5 mt-3 w-full max-w-[360px]">
            <button onClick={retake} className="flex-1 py-3.5 px-2 rounded-md font-[DM_Mono,monospace] text-[0.6rem] font-medium tracking-[0.08em] uppercase text-cream border border-cream/15 bg-transparent active:scale-[0.96] transition-all">Retake</button>
            <button onClick={saveStrip} className="flex-1 py-3.5 px-2 rounded-md font-[DM_Mono,monospace] text-[0.6rem] font-medium tracking-[0.08em] uppercase text-gold border border-gold/30 bg-transparent active:scale-[0.96] transition-all">Save</button>
            <button onClick={() => { setScreen('order'); setOrderQty(1); setGiftMode(false); }} className="flex-1 py-3.5 px-2 rounded-md font-[DM_Mono,monospace] text-[0.6rem] font-medium tracking-[0.08em] uppercase text-cream bg-red border-none active:scale-[0.96] transition-all">Ship It</button>
          </div>

          {/* Photo Style Picker */}
          <div className="w-full max-w-[360px] mt-3">
            <div className="text-[0.55rem] tracking-[0.15em] uppercase text-cream/40 mb-2 text-center">Photo Style</div>
            <div className="flex gap-2 justify-center">
              {['original','bw','sepia'].map(f => (
                <button key={f} onClick={() => setSelectedFilter(f)} className={`px-3 py-1.5 rounded-full text-[0.55rem] tracking-[0.1em] uppercase transition-all active:scale-[0.94] border ${selectedFilter === f ? 'border-gold text-gold bg-gold/[0.08]' : 'border-cream/10 text-cream/50 bg-transparent'}`}>
                  {f === 'bw' ? 'B&W' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Background Picker */}
          <div className="w-full max-w-[360px] mt-3">
            <div className="text-[0.55rem] tracking-[0.15em] uppercase text-cream/40 mb-2 text-center">Strip Background</div>
            <div className="flex gap-2 justify-center">
              {Object.entries(BG_COLORS).map(([key, color]) => (
                <button key={key} onClick={() => setSelectedBg(key)} className={`w-12 h-12 rounded-lg cursor-pointer transition-all active:scale-[0.92] border-2 ${selectedBg === key ? 'border-gold shadow-[0_0_0_2px_rgba(212,168,83,0.3),0_2px_8px_rgba(0,0,0,0.3)]' : 'border-cream/10'}`} style={{ background: color }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ ORDER ═══ */}
      {screen === 'order' && (
        <div className="min-h-dvh flex flex-col bg-dark px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto">
          <div className="flex items-center gap-4 mb-6">
            <button onClick={() => setScreen('result')} className="w-9 h-9 rounded-full bg-input-bg border border-input-border text-cream flex items-center justify-center active:scale-90 shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <h2 className="font-[Playfair_Display,serif] font-black text-xl tracking-wider">Ship Your Strip</h2>
          </div>

          {/* Product Card */}
          <div className="flex gap-4 p-4 bg-cream/[0.06] border border-cream/15 rounded-xl mb-6">
            <div className="w-14 shrink-0">
              <div className="w-14 rounded-sm p-1 flex flex-col gap-0.5" style={{ background: BG_COLORS[selectedBg] }}>
                {photos.slice(0, 5).map((src, i) => (
                  <div key={i} className="w-full aspect-[4/3] rounded-[1px] overflow-hidden bg-film-border">
                    <img src={src} className="w-full h-full object-cover" style={{ filter: getFilterCSS(selectedFilter) }} alt="" />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <div className="font-[Courier_Prime,monospace] font-bold text-sm tracking-wider mb-1">Printed Photo Strip</div>
              <div className="text-[0.6rem] text-cream/50 leading-relaxed mb-2">Glossy 2×8″ strip on premium cardstock. Mailed in a rigid mailer.</div>
              <div className="font-[Playfair_Display,serif] font-bold text-lg text-gold">$10.00 <span className="font-[DM_Mono,monospace] text-[0.55rem] font-normal text-cream/40">each</span></div>
              <div className="flex items-center gap-2.5 mt-2.5">
                <button onClick={() => setOrderQty(Math.max(1, orderQty - 1))} disabled={orderQty <= 1} className="w-[30px] h-[30px] rounded-full bg-cream/[0.06] border border-cream/15 text-cream text-base flex items-center justify-center cursor-pointer active:scale-90 disabled:opacity-25 disabled:pointer-events-none transition-all">−</button>
                <span className="font-[Courier_Prime,monospace] font-bold text-sm min-w-[1.5rem] text-center">{orderQty}</span>
                <button onClick={() => setOrderQty(Math.min(99, orderQty + 1))} className="w-[30px] h-[30px] rounded-full bg-cream/[0.06] border border-cream/15 text-cream text-base flex items-center justify-center cursor-pointer active:scale-90 transition-all">+</button>
              </div>
            </div>
          </div>

          {/* Your Details */}
          <FormSection label="Your Details">
            <FormRow><FormField label="Full Name"><Input name="shipName" value={form.shipName} error={errors.shipName} onChange={v => setForm(f => ({ ...f, shipName: v }))} placeholder="Jane Doe" autoComplete="name" /></FormField></FormRow>
            <FormRow><FormField label="Email"><Input name="shipEmail" value={form.shipEmail} error={errors.shipEmail} onChange={v => setForm(f => ({ ...f, shipEmail: v }))} placeholder="jane@example.com" type="email" autoComplete="email" /></FormField></FormRow>
            <FormRow><FormField label="Address Line 1"><Input name="shipAddr1" value={form.shipAddr1} error={errors.shipAddr1} onChange={v => setForm(f => ({ ...f, shipAddr1: v }))} placeholder="123 Main St" autoComplete="address-line1" /></FormField></FormRow>
            <FormRow><FormField label="Address Line 2"><Input name="shipAddr2" value={form.shipAddr2} onChange={v => setForm(f => ({ ...f, shipAddr2: v }))} placeholder="Apt 4B" autoComplete="address-line2" /></FormField></FormRow>
            <FormRow>
              <FormField label="City"><Input name="shipCity" value={form.shipCity} error={errors.shipCity} onChange={v => setForm(f => ({ ...f, shipCity: v }))} placeholder="Brooklyn" autoComplete="address-level2" /></FormField>
              <FormField label="State" half><StateSelect value={form.shipState} error={errors.shipState} onChange={v => setForm(f => ({ ...f, shipState: v }))} /></FormField>
            </FormRow>
            <FormRow>
              <FormField label="ZIP" half><Input name="shipZip" value={form.shipZip} error={errors.shipZip} onChange={v => setForm(f => ({ ...f, shipZip: v }))} placeholder="11231" inputMode="numeric" maxLength={10} autoComplete="postal-code" /></FormField>
              <FormField label="Country"><select className="field-input w-full py-2.5 px-3 bg-cream/[0.06] border-[1.5px] border-cream/15 rounded-md text-cream font-[DM_Mono,monospace] text-xs outline-none" defaultValue="US"><option value="US">United States</option></select></FormField>
            </FormRow>
          </FormSection>

          {/* Gift Toggle */}
          <div className="flex items-center gap-2.5 mt-1 mb-1 cursor-pointer select-none" onClick={() => setGiftMode(!giftMode)}>
            <div className={`w-5 h-5 rounded flex items-center justify-center transition-all ${giftMode ? 'bg-gold border-gold' : 'bg-cream/[0.06] border-cream/15'}`} style={{ border: '1.5px solid' }}>
              {giftMode && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1A1714" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
            <span className="text-[0.65rem] tracking-wider text-cream/60">For someone else?</span>
          </div>

          {/* Gift Address */}
          {giftMode && (
            <div className="mt-4 pt-4 border-t border-cream/15">
              <FormSection label="Ship To">
                <FormRow><FormField label="Recipient Name"><Input name="giftName" value={giftForm.giftName} error={errors.giftName} onChange={v => setGiftForm(f => ({ ...f, giftName: v }))} placeholder="Recipient's full name" /></FormField></FormRow>
                <FormRow><FormField label="Address Line 1"><Input name="giftAddr1" value={giftForm.giftAddr1} error={errors.giftAddr1} onChange={v => setGiftForm(f => ({ ...f, giftAddr1: v }))} placeholder="123 Main St" /></FormField></FormRow>
                <FormRow><FormField label="Address Line 2"><Input name="giftAddr2" value={giftForm.giftAddr2} onChange={v => setGiftForm(f => ({ ...f, giftAddr2: v }))} placeholder="Apt 4B" /></FormField></FormRow>
                <FormRow>
                  <FormField label="City"><Input name="giftCity" value={giftForm.giftCity} error={errors.giftCity} onChange={v => setGiftForm(f => ({ ...f, giftCity: v }))} placeholder="Brooklyn" /></FormField>
                  <FormField label="State" half><StateSelect value={giftForm.giftState} error={errors.giftState} onChange={v => setGiftForm(f => ({ ...f, giftState: v }))} /></FormField>
                </FormRow>
                <FormRow>
                  <FormField label="ZIP" half><Input name="giftZip" value={giftForm.giftZip} error={errors.giftZip} onChange={v => setGiftForm(f => ({ ...f, giftZip: v }))} placeholder="11231" inputMode="numeric" maxLength={10} /></FormField>
                  <FormField label="Country"><select className="field-input w-full py-2.5 px-3 bg-cream/[0.06] border-[1.5px] border-cream/15 rounded-md text-cream font-[DM_Mono,monospace] text-xs outline-none" defaultValue="US"><option value="US">United States</option></select></FormField>
                </FormRow>
              </FormSection>
            </div>
          )}

          {/* Payment */}
          <FormSection label="Payment">
            <button onClick={handleApplePay} disabled={loading} className="w-full py-3.5 rounded-md bg-white text-black font-[-apple-system,BlinkMacSystemFont,'SF_Pro','Helvetica_Neue',sans-serif] font-semibold text-sm flex items-center justify-center gap-1.5 tracking-tight cursor-pointer active:scale-[0.98] active:opacity-85 disabled:opacity-50 transition-all">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
              <span>Pay</span>
            </button>
            <div className="flex items-center gap-3 my-4">
              <span className="flex-1 h-px bg-cream/15" />
              <span className="text-[0.55rem] tracking-[0.1em] uppercase text-cream/30 whitespace-nowrap">or pay with card</span>
              <span className="flex-1 h-px bg-cream/15" />
            </div>
            <div className="py-3 px-3 bg-cream/[0.06] border-[1.5px] border-cream/15 rounded-md min-h-[44px] flex items-center">
              <span className="text-[0.65rem] text-cream/30 tracking-wider">Card number · MM/YY · CVC</span>
            </div>
          </FormSection>

          <div className="h-px bg-cream/15 my-5" />

          {/* Summary */}
          <div className="mb-5">
            <div className="flex justify-between items-center mb-2"><span className="text-[0.65rem] text-cream/50">Photo strip × {orderQty}</span><span className="text-[0.65rem]">{formatCents(orderQty * UNIT_PRICE)}</span></div>
            <div className="flex justify-between items-center mb-2"><span className="text-[0.65rem] text-cream/50">Shipping</span><span className="text-[0.65rem]">{SHIPPING === 0 ? 'Free' : formatCents(SHIPPING)}</span></div>
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-cream/15"><span className="text-[0.7rem] font-medium text-cream">Total</span><span className="font-[Playfair_Display,serif] font-bold text-base text-gold">{formatCents(total)}</span></div>
          </div>

          <button onClick={processOrder} disabled={loading} className="w-full py-4 rounded-lg bg-red text-cream font-[Courier_Prime,monospace] font-bold text-sm tracking-[0.15em] uppercase cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all" style={{ boxShadow: '0 4px 16px rgba(196,58,43,0.25)' }}>
            {loading ? <div className="w-[18px] h-[18px] border-2 border-white/30 border-t-cream rounded-full mx-auto" style={{ animation: 'spin 0.6s linear infinite' }} /> : <span>Place Order — {formatCents(total)}</span>}
          </button>

          <div className="flex items-center justify-center gap-1.5 mt-3 text-[0.55rem] text-cream/25 tracking-wider">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Secured with Stripe
          </div>
        </div>
      )}

      {/* ═══ CONFIRMATION ═══ */}
      {screen === 'confirmation' && (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-dark p-8 text-center">
          <div className="scale-in w-[72px] h-[72px] rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center mx-auto mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4A9B6E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 className="font-[Playfair_Display,serif] font-black text-2xl tracking-wider mb-3">Order Placed</h2>
          <p className="text-[0.7rem] text-cream/55 leading-relaxed max-w-[280px] mx-auto mb-2">Your photo strip is being printed and will ship within 2–3 business days. A confirmation email is on its way.</p>
          <div className="font-[Courier_Prime,monospace] text-[0.65rem] text-gold tracking-[0.15em] mb-8">Order #{orderId}</div>
          <button onClick={startOver} className="py-3.5 px-8 rounded-md bg-transparent border border-cream/15 text-cream font-[DM_Mono,monospace] text-[0.65rem] font-medium tracking-[0.1em] uppercase cursor-pointer active:scale-[0.96] transition-all">Take Another Strip</button>
        </div>
      )}
    </>
  );
}

// ── FORM HELPERS ──
function FormSection({ label, children }) {
  return (
    <div className="mb-5">
      <div className="text-[0.6rem] tracking-[0.2em] uppercase text-gold mb-3 pb-1.5 border-b border-gold/15">{label}</div>
      {children}
    </div>
  );
}
function FormRow({ children }) { return <div className="flex gap-3 mb-3">{children}</div>; }
function FormField({ label, half, children }) {
  return (
    <div className={`flex flex-col ${half ? 'flex-[0.5]' : 'flex-1'}`}>
      <label className="text-[0.55rem] tracking-[0.1em] uppercase text-cream/45 mb-1">{label}</label>
      {children}
    </div>
  );
}
function Input({ value, onChange, error, name, ...props }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`field-input w-full py-2.5 px-3 bg-cream/[0.06] border-[1.5px] rounded-md text-cream font-[DM_Mono,monospace] text-xs outline-none transition-colors select-text ${error ? 'border-red' : 'border-cream/15'} focus:border-gold/40 placeholder:text-cream/20`}
      style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
      {...props}
    />
  );
}
function StateSelect({ value, onChange, error }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`field-input w-full py-2.5 px-3 bg-cream/[0.06] border-[1.5px] rounded-md text-cream font-[DM_Mono,monospace] text-xs outline-none transition-colors ${error ? 'border-red' : 'border-cream/15'} focus:border-gold/40`}
    >
      <option value="">—</option>
      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}
