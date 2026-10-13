import { useEffect } from 'react';

// Adds the 'ap-revealed' class (see .ap-reveal in index.css) to any element
// with the 'ap-reveal' class once it scrolls into view — the shared
// Apple-style fade/reveal-on-scroll used across every page. Call once per
// page/view root; it re-scans on every render so it also catches elements
// that mount later (tab switches, async content).
export default function useApReveal(deps = []) {
  useEffect(() => {
    const els = document.querySelectorAll('.ap-reveal:not(.ap-revealed)');
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('ap-revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
