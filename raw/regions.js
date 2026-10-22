// ALL-22 GAMES regions, shared by /play (hub.js), ALL-22 BOWL (game/) and ALL-22 PRO (allpro/) as the global
// ALL22_REGIONS. Load it after pokemon.js (ALL_POKEMON, LEGENDARIES, DEFAULT_LINEUPS; read when called).
//  · a region is one generation's Pokédex (Kanto = Gen 1, Johto = Gen 2, Hoenn = Gen 3, Sinnoh = Gen 4), the builder's
//    saved All-22 for it (the builder keeps one lineup per generation, Legendaries or not),
//    and a league. Kanto's league lives in each game's own data; the other leagues are defined here once and
//    game-agnostic (team, leader, type, colors, aces = the signature Pokémon every roster includes; badge and city for
//    gyms); each game builds its own teams from them (type-themed, filled from the region's pool by the builder's
//    position ratings, no Legendaries on CPU teams except the bonus Legends team).
//  · the chosen region is shared: localStorage all22-games-region, overridden by ?region= in a game's URL. Picking one
//    reloads the game, so every module starts in that region. Kanto is the default and keeps the original save keys;
//    other regions save beside them (saveKey).
//  · only ready regions are offered (and honored).
(function () {
  "use strict";
  const KEY = "all22-games-region";
  const REGIONS = [
    { key: "kanto", name: "Kanto", gen: "1", range: [1, 151], ready: true },
    {
      key: "johto", name: "Johto", gen: "2", range: [152, 251], ready: true,
      league: {
        gyms: [
          {"key": "violet", "team": "Violet Falcons", "abbr": "VIO", "leader": "Falkner", "type": "flying", "colors": ["#7b5ea7", "#d8cdf0"], "aces": [164, 227, 178, 198], "city": "Violet", "badge": "Zephyr"},
          {"key": "azalea", "team": "Azalea Swarm", "abbr": "AZA", "leader": "Bugsy", "type": "bug", "colors": ["#7aa63a", "#f2e28a"], "aces": [212, 214, 166, 168, 205], "city": "Azalea", "badge": "Hive"},
          {"key": "goldenrod", "team": "Goldenrod Stampede", "abbr": "GOL", "leader": "Whitney", "type": "normal", "colors": ["#e9a3c0", "#ffd84a"], "aces": [241, 217, 203, 234, 242], "city": "Goldenrod", "badge": "Plain"},
          {"key": "ecruteak", "team": "Ecruteak Specters", "abbr": "ECR", "leader": "Morty", "type": "ghost", "colors": ["#3d2f5b", "#e0c068"], "aces": [200, 197, 198, 229], "city": "Ecruteak", "badge": "Fog"},
          {"key": "cianwood", "team": "Cianwood Crushers", "abbr": "CIA", "leader": "Chuck", "type": "fighting", "colors": ["#b5541f", "#f5deb3"], "aces": [237, 214, 236, 232], "city": "Cianwood", "badge": "Storm"},
          {"key": "olivine", "team": "Olivine Ironclads", "abbr": "OLI", "leader": "Jasmine", "type": "steel", "colors": ["#8c9aa8", "#2e5c8a"], "aces": [208, 227, 212, 205], "city": "Olivine", "badge": "Mineral"},
          {"key": "mahogany", "team": "Mahogany Frost", "abbr": "MAH", "leader": "Pryce", "type": "ice", "colors": ["#6fb7d8", "#5a3a22"], "aces": [221, 215, 225, 238], "city": "Mahogany", "badge": "Glacier"},
          {"key": "blackthorn", "team": "Blackthorn Dragons", "abbr": "BLK", "leader": "Clair", "type": "dragon", "colors": ["#1f4f8a", "#7ad1e8"], "aces": [230, 248, 181, 232], "city": "Blackthorn", "badge": "Rising"},
        ],
        elite: [
          {"key": "will", "team": "Indigo Psychics", "abbr": "WIL", "leader": "Will", "type": "psychic", "colors": ["#b03a8c", "#f0c8e8"], "aces": [178, 196, 203, 199], "city": "Indigo Plateau"},
          {"key": "koga", "team": "Indigo Ninjas", "abbr": "KOG", "leader": "Koga", "type": "poison", "colors": ["#5d2e7a", "#c9a0dc"], "aces": [169, 168, 211, 205], "city": "Indigo Plateau"},
          {"key": "bruno2", "team": "Indigo Brawlers", "abbr": "BRU", "leader": "Bruno", "type": "fighting", "colors": ["#a33a2b", "#f0d0a0"], "aces": [237, 214, 232], "city": "Indigo Plateau"},
          {"key": "karen", "team": "Indigo Nightfall", "abbr": "KAR", "leader": "Karen", "type": "dark", "colors": ["#2b2b3a", "#c94f4f"], "aces": [197, 229, 198, 215, 248], "city": "Indigo Plateau"},
        ],
        champion: {"key": "champion", "team": "Dragon's Den", "abbr": "DEN", "leader": "Lance", "type": "dragon", "colors": ["#4a3fbf", "#f2a33a"], "aces": [230, 248, 181, 227, 232], "city": "Indigo Plateau"},
        bonus: {"key": "legends", "team": "Tin Tower Legends", "abbr": "LEG", "leader": "Ho-Oh", "type": null, "colors": ["#c8402a", "#f6c64a"], "aces": [250, 249, 243, 244, 245, 251], "city": "Tin Tower"},
      },
    },
    {
      key: "hoenn", name: "Hoenn", gen: "3", range: [252, 386], ready: true,
      league: {
        gyms: [
          {"key": "rustboro", "team": "Rustboro Boulders", "abbr": "RUS", "leader": "Roxanne", "type": "rock", "colors": ["#8b6a4f", "#e8d3a9"], "aces": [299, 306, 346, 348], "city": "Rustboro", "badge": "Stone"},
          {"key": "dewford", "team": "Dewford Breakers", "abbr": "DEW", "leader": "Brawly", "type": "fighting", "colors": ["#2c7fb8", "#f6c14b"], "aces": [297, 308, 286, 257], "city": "Dewford", "badge": "Knuckle"},
          {"key": "mauville", "team": "Mauville Dynamos", "abbr": "MAU", "leader": "Wattson", "type": "electric", "colors": ["#f5c518", "#3a6ea5"], "aces": [310, 311, 312], "city": "Mauville", "badge": "Dynamo"},
          {"key": "lavaridge", "team": "Lavaridge Inferno", "abbr": "LAV", "leader": "Flannery", "type": "fire", "colors": ["#d9381e", "#ffcf6b"], "aces": [324, 323, 257, 256], "city": "Lavaridge", "badge": "Heat"},
          {"key": "petalburg", "team": "Petalburg Pride", "abbr": "PET", "leader": "Norman", "type": "normal", "colors": ["#6b8e23", "#f0e6c8"], "aces": [289, 288, 335, 264, 277], "city": "Petalburg", "badge": "Balance"},
          {"key": "fortree", "team": "Fortree Skyhawks", "abbr": "FOR", "leader": "Winona", "type": "flying", "colors": ["#4fa3d1", "#f3f3f3"], "aces": [334, 277, 279, 357], "city": "Fortree", "badge": "Feather"},
          {"key": "mossdeep", "team": "Mossdeep Eclipse", "abbr": "MOS", "leader": "Tate & Liza", "type": "psychic", "colors": ["#c2448f", "#f4d35e"], "aces": [338, 337, 344, 282, 376], "city": "Mossdeep", "badge": "Mind"},
          {"key": "sootopolis", "team": "Sootopolis Surge", "abbr": "SOO", "leader": "Wallace", "type": "water", "colors": ["#2a6fdb", "#8ee3ef"], "aces": [350, 340, 365, 260, 342], "city": "Sootopolis", "badge": "Rain"},
        ],
        elite: [
          {"key": "sidney", "team": "Ever Grande Fangs", "abbr": "SID", "leader": "Sidney", "type": "dark", "colors": ["#3b3b4f", "#e05a47"], "aces": [262, 275, 332, 342, 359], "city": "Ever Grande City"},
          {"key": "phoebe", "team": "Ever Grande Spirits", "abbr": "PHO", "leader": "Phoebe", "type": "ghost", "colors": ["#5b3f8c", "#c7b8ea"], "aces": [356, 354, 302], "city": "Ever Grande City"},
          {"key": "glacia", "team": "Ever Grande Glaciers", "abbr": "GLA", "leader": "Glacia", "type": "ice", "colors": ["#77c3e8", "#ffffff"], "aces": [362, 365, 364, 361], "city": "Ever Grande City"},
          {"key": "drake", "team": "Ever Grande Dragons", "abbr": "DRK", "leader": "Drake", "type": "dragon", "colors": ["#2f5d8a", "#e8a33a"], "aces": [373, 330, 334, 372], "city": "Ever Grande City"},
        ],
        champion: {"key": "champion", "team": "Ever Grande Steel", "abbr": "STE", "leader": "Steven", "type": "steel", "colors": ["#5c6f82", "#b9d2e6"], "aces": [376, 306, 344, 346, 348], "city": "Ever Grande City"},
        bonus: {"key": "legends", "team": "Sky Pillar Legends", "abbr": "LEG", "leader": "Rayquaza", "type": null, "colors": ["#2f8a4e", "#f2d64b"], "aces": [384, 383, 382, 380, 381, 377, 378, 379, 385, 386], "city": "Sky Pillar"},
      },
    },
    {
      key: "sinnoh", name: "Sinnoh", gen: "4", range: [387, 493], ready: true,
      league: {
        gyms: [
          {"key": "oreburgh", "team": "Oreburgh Miners", "abbr": "ORE", "leader": "Roark", "type": "rock", "colors": ["#7a5230", "#f2b134"], "aces": [409, 411, 476, 464], "city": "Oreburgh", "badge": "Coal"},
          {"key": "eterna", "team": "Eterna Thorns", "abbr": "ETE", "leader": "Gardenia", "type": "grass", "colors": ["#2e8b57", "#f5a3c7"], "aces": [407, 389, 465, 421], "city": "Eterna", "badge": "Forest"},
          {"key": "veilstone", "team": "Veilstone Fists", "abbr": "VEI", "leader": "Maylene", "type": "fighting", "colors": ["#c0392b", "#f7dc6f"], "aces": [448, 454, 475, 392], "city": "Veilstone", "badge": "Cobble"},
          {"key": "pastoria", "team": "Pastoria Waves", "abbr": "PAS", "leader": "Crasher Wake", "type": "water", "colors": ["#1f77b4", "#ffd166"], "aces": [419, 395, 423, 457], "city": "Pastoria", "badge": "Fen"},
          {"key": "hearthome", "team": "Hearthome Haunts", "abbr": "HEA", "leader": "Fantina", "type": "ghost", "colors": ["#6c3483", "#f5b7b1"], "aces": [429, 426, 442, 477], "city": "Hearthome", "badge": "Relic"},
          {"key": "canalave", "team": "Canalave Bulwark", "abbr": "CAN", "leader": "Byron", "type": "steel", "colors": ["#7f8c8d", "#2c3e50"], "aces": [411, 437, 476, 462], "city": "Canalave", "badge": "Mine"},
          {"key": "snowpoint", "team": "Snowpoint Blizzard", "abbr": "SNO", "leader": "Candice", "type": "ice", "colors": ["#85c1e9", "#ffffff"], "aces": [460, 478, 473, 461], "city": "Snowpoint", "badge": "Icicle"},
          {"key": "sunyshore", "team": "Sunyshore Sparks", "abbr": "SUN", "leader": "Volkner", "type": "electric", "colors": ["#f1c40f", "#1b4f72"], "aces": [405, 466, 462, 417], "city": "Sunyshore", "badge": "Beacon"},
        ],
        elite: [
          {"key": "aaron", "team": "Lily of the Valley Swarm", "abbr": "AAR", "leader": "Aaron", "type": "bug", "colors": ["#6e9c2f", "#f0e68c"], "aces": [452, 416, 469, 414], "city": "Pokémon League"},
          {"key": "bertha", "team": "Valley Quakes", "abbr": "BER", "leader": "Bertha", "type": "ground", "colors": ["#a0522d", "#e6c88a"], "aces": [450, 472, 464, 423], "city": "Pokémon League"},
          {"key": "flint", "team": "Valley Flames", "abbr": "FLI", "leader": "Flint", "type": "fire", "colors": ["#e74c3c", "#fad7a0"], "aces": [392, 467], "city": "Pokémon League"},
          {"key": "lucian", "team": "Valley Minds", "abbr": "LUC", "leader": "Lucian", "type": "psychic", "colors": ["#8e44ad", "#d2b4de"], "aces": [475, 437], "city": "Pokémon League"},
        ],
        champion: {"key": "champion", "team": "Sinnoh Champions", "abbr": "CYN", "leader": "Cynthia", "type": null, "colors": ["#1c1c1c", "#f4d03f"], "aces": [445, 442, 448, 407, 468], "city": "Pokémon League"},
        bonus: {"key": "legends", "team": "Spear Pillar Legends", "abbr": "LEG", "leader": "Arceus", "type": null, "colors": ["#5a5f9a", "#e8e2c8"], "aces": [493, 483, 484, 487, 480, 481, 482, 485, 486, 488, 491, 492], "city": "Spear Pillar"},
      },
    },
  ];
  const BY_KEY = Object.fromEntries(REGIONS.map((r) => [r.key, r]));
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  const ls = () => { try { return G.localStorage || null; } catch (_) { return null; } };

  // the region this page plays in: ?region= (a game's URL), else the saved choice, else Kanto
  function current() {
    let k = null;
    try { k = new URLSearchParams(G.location.search).get("region"); } catch (_) { /* no location */ }
    if (!k) { const s = ls(); try { k = s && s.getItem(KEY); } catch (_) { k = null; } }
    const r = BY_KEY[String(k || "").toLowerCase()];
    return r && r.ready ? r : BY_KEY.kanto;
  }
  function set(key) {
    const s = ls();
    try { if (s && BY_KEY[key]) s.setItem(KEY, key); } catch (_) { /* private mode: this page only */ }
  }
  const inRange = (r, id) => Number.isInteger(id) && id >= r.range[0] && id <= r.range[1];
  // pokemon.js's top-level consts are global bindings, not window properties: reach them by name
  const LEGENDS = () => (typeof LEGENDARIES !== "undefined" ? LEGENDARIES : G.LEGENDARIES) || null; // eslint-disable-line no-undef
  const DEFAULTS = () => (typeof DEFAULT_LINEUPS !== "undefined" ? DEFAULT_LINEUPS : G.DEFAULT_LINEUPS) || null; // eslint-disable-line no-undef
  const legendary = (id) => { const L = LEGENDS(); return !!(L && L.has(id)); };
  // the region's Pokédex ids, Legendaries left out unless asked for
  function pool(r, legends = false) {
    const out = [];
    for (let id = r.range[0]; id <= r.range[1]; id++) if (legends || !legendary(id)) out.push(id);
    return out;
  }
  // the builder's saved All-22 keys for this region, in the order to try them (its Legendaries switch picks which first)
  function lineupKeys(r) {
    const base = r.gen === "1" ? "pokemon-all22-lineup-" : `pokemon-all22-lineup-gen${r.gen}-`;
    let legendsFirst = false;
    const s = ls();
    try { legendsFirst = !!s && s.getItem("pokemon-all22-legends-v1") === "1"; } catch (_) { /* default order */ }
    return legendsFirst ? [base + "legends-v1", base + "v1"] : [base + "v1", base + "legends-v1"];
  }
  // the builder's starting lineup for the region's generation
  const defaultLineup = (r) => { const D = DEFAULTS(); return D ? D[r.gen] || D["1"] : null; };
  // a save key for this region: Kanto keeps the original (all22bowl-gyms-v1), others add the region (all22bowl-gyms-johto-v1)
  const saveKey = (base, r) => (!r || r.key === "kanto" ? base : String(base).replace(/-v(\d+)$/, `-${r.key}-v$1`));
  // analytics: "" in Kanto (the original event values), " · Johto" elsewhere
  const tag = (r) => (!r || r.key === "kanto" ? "" : ` · ${r.name}`);

  G.ALL22_REGIONS = {
    KEY, list: REGIONS, ready: () => REGIONS.filter((r) => r.ready), get: (k) => BY_KEY[k] || null,
    current, set, inRange, legendary, pool, lineupKeys, defaultLineup, saveKey, tag,
  };
})();
