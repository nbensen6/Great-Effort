import React, { useCallback, useEffect, useRef, useState } from 'react';
import { normalizePool } from '../lib/championPool';

// Full-bleed splash art, one champion at a time, crossfading like the hero
// carousel on riotgames.com. Splash is the landscape 1215x717 art — the whole
// image, not a masked cutout.
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
  const [paused, setPaused] = useState(false);
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
    if (paused || slides.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer.current = setInterval(() => advance(1), INTERVAL_MS);
    return () => clearInterval(timer.current);
  }, [paused, slides.length, advance, index]);

  return (
    <div
      className="hero-carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
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

      <div className="hero-caption">
        <span className="hero-role">{slides[index]?.role}</span>
        <h2>{slides[index]?.id?.replace(/([a-z])([A-Z])/g, '$1 $2')}</h2>
        {slides[index]?.player && <span className="hero-player">{slides[index].player}</span>}
      </div>

      {slides.length > 1 && (
        <>
          <button className="hero-nav prev" aria-label="Previous champion"
            onClick={() => advance(-1)}>‹</button>
          <button className="hero-nav next" aria-label="Next champion"
            onClick={() => advance(1)}>›</button>
          <div className="hero-dots">
            {slides.map((s, i) => (
              <button
                key={s.id}
                className={`hero-dot${i === index ? ' active' : ''}`}
                aria-label={`Show ${s.id}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default ChampionHero;
