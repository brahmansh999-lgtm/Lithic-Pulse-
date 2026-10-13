import { useState, useEffect } from 'react';
import './SplashScreen.css';

// Intro splash — shown before the landing page on every page load.
// The rock artwork drifts in, a title lockup (kicker + words + rule line)
// assembles on the image's mid-line, then the whole scene "zooms through":
// the rock scales up and fades while the landing page emerges from within it.
// One continuous, designed moment — not a cut.
//
// The artwork has no baked-in text, so the title is rendered as live animated
// text on top (also fixes the original "Fipping" → "Flipping").

const TITLE = 'Flipping The Matrix';
const HOLD  = 3000;   // visible time before the zoom-through begins
const ZOOM  = 950;    // zoom-through / fade-out duration (must match CSS)

export default function SplashScreen({ onDone }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), HOLD);
    const t2 = setTimeout(() => onDone?.(), HOLD + ZOOM);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  const words = TITLE.split(' ');

  return (
    <div className={`splash${leaving ? ' splash--leaving' : ''}`} aria-hidden={leaving}>
      <div className="splash-scene">
        <div className="splash-art">
          <img
            className="splash-img"
            src="/FLIPPING%20MATRIX%20IMAGE.png"
            alt="Flipping The Matrix"
            draggable="false"
          />
          {/* Vignette grounds the rock and deepens the edges for drama */}
          <div className="splash-vignette" />
        </div>

        {/* Title lockup sits on the image's two-tone mid-line */}
        <div className="splash-lockup">
          <div className="splash-kicker">
            <span className="splash-kicker-dot" />
            Lithic Pulse
          </div>

          <h1 className="splash-title" aria-label={TITLE}>
            {words.map((word, wi) => (
              <span
                className="splash-word"
                key={wi}
                style={{ animationDelay: `${420 + wi * 150}ms` }}
              >
                {word}
              </span>
            ))}
          </h1>

          {/* Rule line draws across the split line, tying title to the image */}
          <div className="splash-rule" />
        </div>
      </div>
    </div>
  );
}
