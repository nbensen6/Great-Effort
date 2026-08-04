import React, { useEffect, useState } from 'react';
import { normalizePool } from '../lib/championPool';

// Riot's CDN has no transparent champion art — every splash and loading image
// ships with an opaque background. Instead of a hard rectangle, each portrait is
// masked to fade out on all four edges and blended with `lighten`, which drops
// dark backgrounds into the page entirely and softens brighter ones.
const LOADING_ART = (id) =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${id}_0.jpg`;

// Fallback if the roster has not loaded (or nobody has pools yet).
const FALLBACK = ['Darius', 'Shyvana', 'Locke', 'Caitlyn', 'Senna', 'Alistar'];

function ChampionMarquee() {
  const [champions, setChampions] = useState(FALLBACK);

  useEffect(() => {
    // /api/players is public, so the marquee works for logged-out visitors too.
    fetch('/api/players')
      .then(r => (r.ok ? r.json() : []))
      .then(players => {
        const picks = [];
        for (const p of players) {
          if (!p.champion_pool_data) continue;
          // One signature pick per player. These are full-size portraits, so
          // the reel is duplicated to loop — keep the count low or the page
          // pays for a dozen megabytes of background art.
          const main = normalizePool(p.champion_pool_data).main[0];
          if (main && !picks.includes(main.id)) picks.push(main.id);
        }
        if (picks.length >= 4) setChampions(picks.slice(0, 6));
      })
      .catch(() => {});
  }, []);

  // The track is rendered twice so the animation can loop seamlessly: it
  // translates by exactly -50%, at which point the copy sits where the
  // original started.
  const reel = [...champions, ...champions];

  return (
    <div className="champ-marquee" aria-hidden="true">
      <div
        className="champ-marquee-track"
        style={{ animationDuration: `${Math.max(60, champions.length * 7)}s` }}
      >
        {reel.map((id, i) => (
          <img
            key={`${id}-${i}`}
            src={LOADING_ART(id)}
            alt=""
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ))}
      </div>
    </div>
  );
}

export default ChampionMarquee;
