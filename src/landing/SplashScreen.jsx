import { useState, useEffect, useRef } from 'react';
import './SplashScreen.css';

// Intro splash — shown before the landing page on every page load.
// A procedurally generated site-plan/massing scene drifts in and rises, a
// title lockup (kicker + words + rule line) assembles on its mid-line, then
// the whole scene "zooms through": it scales up and fades while the landing
// page emerges from within it. One continuous, designed moment — not a cut.
//
// The scene has no baked-in text, so the title is rendered as live animated
// text on top.

const HOLD  = 3000;   // visible time before the zoom-through begins
const ZOOM  = 950;    // zoom-through / fade-out duration (must match CSS)

// Same visual language as LandingPage.jsx's HeroCanvas (seeded site-plan
// dot-grid, pulsing massing blocks, red scan line) — denser and with an
// added "rise-in" over the hold duration, suited to a full-bleed intro
// moment rather than HeroCanvas's steady-state background pulse. Deliberately
// NOT a duplicate import/reuse of HeroCanvas: that component is scoped to a
// small hero panel and always at steady-state; this one owns its own
// rise-in timeline synced to the splash's HOLD/ZOOM constants above.
function SplashCanvas() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, raf, t = 0;
    const start = performance.now();
    const resize = () => { W = canvas.width = canvas.offsetWidth; H = canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    let s = 7;
    const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

    const CELL = 24;
    const COLS = Math.ceil(1400 / CELL) + 2;
    const ROWS = Math.ceil(900 / CELL) + 2;
    const blocks = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // User-directed: back to the denser original reading (was cut ~55%,
        // 0.1→0.045, for a calmer atmosphere — reverted per later request).
        if (rng() < 0.1) {
          const bw = 2 + Math.floor(rng() * 4);
          const bh = 2 + Math.floor(rng() * 3);
          if (c + bw < COLS && r + bh < ROWS) {
            const floors = 2 + Math.floor(rng() * 10);
            blocks.push({ c, r, bw, bh, floors, phase: rng() * Math.PI * 2, delay: rng() * 900 });
          }
        }
      }
    }

    const draw = (now) => {
      const elapsed = now - start;
      // Rise-in: each block's height eases from 0 to full over ~1.2s, staggered
      // by its own delay, so the scene reads as the massing "growing" into
      // place rather than appearing all at once.
      ctx.clearRect(0, 0, W, H);
      t += 0.005;
      const cW = W / COLS, cH = H / ROWS;

      for (let r = 0; r <= ROWS; r++) {
        for (let c = 0; c <= COLS; c++) {
          const a = 0.04 + 0.018 * Math.sin(t * 0.4 + c * 0.18 + r * 0.22);
          ctx.beginPath();
          ctx.arc(c * cW, r * cH, 1, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(240,236,226,${a})`;
          ctx.fill();
        }
      }

      blocks.forEach(b => {
        const riseT = Math.max(0, Math.min(1, (elapsed - b.delay) / 1200));
        const rise = 1 - Math.pow(1 - riseT, 3); // ease-out cubic
        const pulse = 0.65 + 0.35 * Math.sin(t * 0.6 + b.phase);
        const height = (b.floors / 16) * pulse * rise;
        // User-directed: back to the brighter original values (was roughly
        // halved for a calmer atmosphere — reverted per later request).
        const alpha = (0.05 + height * 0.14) * rise;
        const strokeA = (0.16 + height * 0.26) * rise;
        const h = (b.bh * cH - 2) * rise;
        const y = b.r * cH + 1 + ((b.bh * cH - 2) - h); // grow upward from base

        ctx.fillStyle = `rgba(240,236,226,${alpha})`;
        ctx.fillRect(b.c * cW + 1, y, b.bw * cW - 2, h);
        ctx.strokeStyle = `rgba(240,236,226,${strokeA})`;
        ctx.lineWidth = 0.8;
        ctx.strokeRect(b.c * cW + 1, y, b.bw * cW - 2, h);
      });

      // Red scan line, same motif as HeroCanvas
      const scanY = ((t * 34) % (H + 60)) - 30;
      const grad = ctx.createLinearGradient(0, scanY - 14, 0, scanY + 14);
      grad.addColorStop(0, 'rgba(224,92,58,0)');
      grad.addColorStop(0.5, 'rgba(224,92,58,0.16)');
      grad.addColorStop(1, 'rgba(224,92,58,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 14, W, 28);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={canvasRef} className="splash-canvas" />;
}

export default function SplashScreen({ onDone }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), HOLD);
    const t2 = setTimeout(() => onDone?.(), HOLD + ZOOM);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div className={`splash${leaving ? ' splash--leaving' : ''}`} aria-hidden={leaving}>
      <div className="splash-scene">
        <div className="splash-art">
          <div className="splash-stone-bg" />
          {/* Vignette grounds the scene and deepens the edges for drama */}
          <div className="splash-vignette" />
        </div>

        {/* Title lockup sits on the scene's mid-line — user-directed: just
            the one line, no "Lithic Pulse" wordmark and no separate kicker
            above it. splash-introducing carries the whole statement now, so
            it's sized up to read as the headline rather than a small label. */}
        <div className="splash-lockup">
          <div className="splash-introducing--solo">
            <span className="splash-introducing-elongate">Introducing new age of stone housing</span>
          </div>

          {/* Rule line draws across the split line, anchoring the statement */}
          <div className="splash-rule" />
        </div>
      </div>
    </div>
  );
}
