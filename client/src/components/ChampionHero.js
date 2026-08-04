import React, { useCallback, useEffect, useRef, useState } from 'react';
import { normalizePool } from '../lib/championPool';

// Ambient backdrop: full splash art crossfading behind the page content, faded
// into the page background rather than sitting in a hard-edged banner. Purely
// decorative, so it takes no pointer events and carries no caption.
const SPLASH = (id) => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg`;

const FALLBACK = [
  { id: 'Darius', role: 'Top' },
  { id: 'Shyvana', role: 'Jungle' },
  { id: 'Locke', role: 'Mid' },
  { id: 'Caitlyn', role: 'ADC' },
  { id: 'Senna', role: 'Support' }
];

const INTERVAL_MS = 6000;

function ChampionHero() {
  const [slides, setSlides] = useState(FALLBACK);
  const [index, setIndex] = useState(0);
  const timer = useRef(null);

  useEffect(() => {
    fetch('/api/players')
      .then(r => (r.ok ? r.json() : []))
      .then(players => {
        const picked = [];
        for (const p of players) {
          if (!p.champion_pool_data || !p.role) continue;
          const main = normalizePool(p.champion_pool_data).main[0];
          if (main && !picked.some(s => s.id === main.id)) {
            picked.push({ id: main.id, role: p.role, player: p.summoner_name });
          }
        }
        if (picked.length >= 3) setSlides(picked);
      })
      .catch(() => {});
  }, []);

  const advance = useCallback((step) => {
    setIndex(i => (i + step + slides.length) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer.current = setInterval(() => advance(1), INTERVAL_MS);
    return () => clearInterval(timer.current);
  }, [slides.length, advance, index]);

  return (
    <div className="hero-carousel" aria-hidden="true">
      {slides.map((s, i) => (
        <div
          key={s.id}
          className={`hero-slide${i === index ? ' active' : ''}`}
          // Background-image rather than <img> so the art can cover any aspect
          // ratio without letterboxing at the edges of a wide viewport.
          style={{ backgroundImage: `url(${SPLASH(s.id)})` }}
          aria-hidden={i !== index}
        />
      ))}

      <div className="hero-scrim" />
    </div>
  );
}

export default ChampionHero;
