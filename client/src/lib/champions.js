// Data Dragon ships more than the playable roster.
//
// As of patch 16.15.1 champion.json has 233 entries, but 60 champion names
// appear twice: the real champion plus a "Jade_" variant belonging to a
// separate game mode, keyed at +60000 (Ahri = 103, Jade_Ahri = 60103). The
// variants carry the older classic artwork, so rendering the raw list shows
// 60 champions twice with mismatched icons.
//
// Real champion ids are single words with no underscore, which is the most
// durable way to drop the variants without hardcoding a prefix list.
export function isPlayableChampion(champ) {
  const id = typeof champ === 'string' ? champ : champ?.id;
  return typeof id === 'string' && id.length > 0 && !id.includes('_');
}

// Map Data Dragon's champion.json `data` object to the playable roster.
export function toChampionList(data, version) {
  return Object.values(data)
    .filter(isPlayableChampion)
    .map(champ => ({
      id: champ.id,
      name: champ.name,
      tags: champ.tags,
      image: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.id}.png`
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
