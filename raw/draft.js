// Draft mode: each round rolls a region and a type, you pick one of the matching Pokémon and place
// it in an open position; after 22 rounds the team gets a Team Score (out of 1000) and plays a
// 17-game season. Pure game logic (no DOM), so it can also be simulated outside the browser.
const DRAFT = (() => {
  "use strict";

  const ROUNDS = 22;
  const GAMES = 17;
  // At most this many Legendary/Mythical Pokémon per run.
  const MAX_LEGENDS = 3;
  const REGIONS = {
    1: "Kanto", 2: "Johto", 3: "Hoenn", 4: "Sinnoh", 5: "Unova", 6: "Kalos", 7: "Alola", 8: "Galar", 9: "Paldea",
  };
  const GENS = Object.keys(REGIONS);
  // Variants: the full game rolls from all nine regions; Retro sticks to Gen 1–4 (Kanto to Sinnoh)
  // for players who know the classic Pokémon best.
  const VARIANTS = { all: GENS, retro: ["1", "2", "3", "4"] };
  const gensOf = (variant) => VARIANTS[variant] || GENS;

  // ---------- Deterministic randomness (a run's rolls and season are fixed by its seed) ----------
  function rand(seed, i) {
    let t = (seed + Math.imul(i + 1, 0x9e3779b9)) | 0;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  }
  const pickFrom = (list, r) => list[Math.floor(r * list.length)];

  // ---------- Rolls ----------
  // Unlike the builder, the draft pool spans all nine generations and includes Legendary and
  // Mythical Pokémon.
  const POOL = {};
  for (const g of GENS) POOL[g] = [];
  POKEMON_NAMES.forEach((name, i) => POOL[genOf(i + 1)].push({ id: i + 1, name, legendary: LEGENDARIES.has(i + 1) }));
  const nameOf = (id) => POKEMON_NAMES[id - 1];

  // noLegends: the run has used up its Legendaries, so only regular Pokémon count (rolls never land
  // on a region and type that only has Legendaries left).
  function available(gen, type, taken, noLegends = false) {
    return POOL[gen].filter((p) => !taken.has(p.id) && !(noLegends && p.legendary) && POKEDATA[p.id - 1].types.includes(type));
  }
  function typesFor(gen, taken, noLegends = false) {
    return TYPE_NAMES.filter((t) => available(gen, t, taken, noLegends).length > 0);
  }
  function gensFor(type, taken, noLegends = false, variant = "all") {
    return gensOf(variant).filter((g) => available(g, type, taken, noLegends).length > 0);
  }
  // A fresh roll: region first (one of the variant's), then a type that region still has Pokémon for.
  function roll(seed, i, taken, noLegends = false, variant = "all") {
    const gen = pickFrom(gensOf(variant).filter((g) => typesFor(g, taken, noLegends).length > 0), rand(seed, i * 2));
    const type = pickFrom(typesFor(gen, taken, noLegends), rand(seed, i * 2 + 1));
    return { gen, type };
  }
  function rerollType(current, seed, i, taken, noLegends = false) {
    const options = typesFor(current.gen, taken, noLegends).filter((t) => t !== current.type);
    return options.length ? { gen: current.gen, type: pickFrom(options, rand(seed, i)) } : null;
  }
  function rerollGen(current, seed, i, taken, noLegends = false, variant = "all") {
    const options = gensFor(current.type, taken, noLegends, variant).filter((g) => g !== current.gen);
    return options.length ? { gen: pickFrom(options, rand(seed, i)), type: current.type } : null;
  }
  const legendsIn = (ids) => ids.filter((id) => LEGENDARIES.has(id)).length;

  // ---------- The 151 Challenge ----------
  // Each round rolls one of the original 151 (Legendaries included, with no limit), and the only
  // choice is where it plays. Five rerolls per run.
  const KANTO = POOL["1"];
  const MON_REROLLS = 5;
  function rollMon(seed, i, taken) {
    const options = KANTO.filter((p) => !taken.has(p.id));
    return { id: pickFrom(options, rand(seed ^ 0x151, i)).id };
  }
  function rerollMon(current, seed, i, taken) {
    const options = KANTO.filter((p) => p.id !== current.id && !taken.has(p.id));
    return options.length ? { id: pickFrom(options, rand(seed, i)).id } : null;
  }

  // ---------- Position ratings ----------
  // Each role values a mix of base stats (and size); a few types get a small football-flavored bump.
  const ROLES = {
    QB: { stats: { spa: 0.34, spd: 0.22, spe: 0.18, atk: 0.1, hp: 0.16 }, types: { psychic: 6, normal: 2, dragon: 2 } },
    HB: { stats: { spe: 0.34, atk: 0.3, hp: 0.16, def: 0.1, kg: 0.1 }, types: { fighting: 3, ground: 3, normal: 2 } },
    FB: { stats: { atk: 0.28, def: 0.26, hp: 0.2, kg: 0.26 }, types: { rock: 4, ground: 4, fighting: 3, normal: 2 } },
    WR: { stats: { spe: 0.5, atk: 0.14, spa: 0.14, m: 0.12, spd: 0.1 }, types: { electric: 4, flying: 4 } },
    TE: { stats: { atk: 0.24, def: 0.2, hp: 0.16, spe: 0.14, kg: 0.14, m: 0.12 }, types: { fighting: 3, water: 2 } },
    OL: { stats: { def: 0.3, hp: 0.24, kg: 0.3, atk: 0.1, spd: 0.06 }, types: { rock: 5, steel: 5, ground: 3, fighting: 2 } },
    DE: { stats: { atk: 0.34, spe: 0.28, hp: 0.14, kg: 0.14, def: 0.1 }, types: { fighting: 5, dark: 2, dragon: 2 } },
    NT: { stats: { kg: 0.34, hp: 0.24, def: 0.22, atk: 0.2 }, types: { rock: 4, ground: 4, steel: 3, fighting: 2 } },
    OLB: { stats: { atk: 0.3, spe: 0.3, def: 0.18, hp: 0.14, spd: 0.08 }, types: { fighting: 4, dark: 3, bug: 2 } },
    ILB: { stats: { atk: 0.3, def: 0.28, hp: 0.2, spe: 0.14, spd: 0.08 }, types: { fighting: 4, dark: 3, ground: 2 } },
    CB: { stats: { spe: 0.46, spd: 0.22, def: 0.14, atk: 0.1, m: 0.08 }, types: { flying: 3, dark: 3, ghost: 3 } },
    S: { stats: { spe: 0.32, spd: 0.26, def: 0.16, hp: 0.14, spa: 0.12 }, types: { flying: 4, psychic: 3 } },
    // 4-3 front and the slot offense
    DT: { stats: { kg: 0.28, atk: 0.26, hp: 0.2, def: 0.18, spe: 0.08 }, types: { rock: 3, ground: 3, steel: 3, fighting: 3 } },
    MLB: { stats: { atk: 0.28, def: 0.24, hp: 0.18, spe: 0.16, spd: 0.14 }, types: { fighting: 4, dark: 3, ground: 2 } },
    SLOT: { stats: { spe: 0.48, atk: 0.16, spd: 0.14, spa: 0.12, hp: 0.1 }, types: { electric: 4, flying: 3, fairy: 2 } },
  };

  // Schemes: defense "34" or "43", offense "fb" (fullback) or "slot" (slot receiver). Every spot
  // keeps its id in each scheme; the 4-3 turns the NT and one ILB into tackles and the other ILB
  // into the middle linebacker, and the slot offense turns the fullback into a slot receiver.
  const BASE_SCHEME = { def: "34", off: "fb" };
  const SLOT_ROLE = {
    S1: "S", S2: "S", CB1: "CB", CB2: "CB", OLB1: "OLB", OLB2: "OLB", ILB1: "ILB", ILB2: "ILB",
    DE1: "DE", DE2: "DE", NT: "NT",
    WR1: "WR", WR2: "WR", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL", TE: "TE",
    QB: "QB", FB: "FB", HB: "HB",
  };
  const SCHEME_ROLE = { "43": { NT: "DT", ILB2: "DT", ILB1: "MLB" }, slot: { FB: "SLOT" } };
  function roleOf(slot, scheme = BASE_SCHEME) {
    return (SCHEME_ROLE[scheme.def] || {})[slot] || (SCHEME_ROLE[scheme.off] || {})[slot] || SLOT_ROLE[slot];
  }
  // How much each spot matters to its side of the ball (each side sums to 1).
  const OL = { LT: 0.074, LG: 0.074, C: 0.074, RG: 0.074, RT: 0.074 };
  const OFFENSE_BY = {
    fb: { QB: 0.24, HB: 0.1, FB: 0.04, WR1: 0.09, WR2: 0.09, TE: 0.07, ...OL },
    slot: { QB: 0.24, HB: 0.1, FB: 0.06, WR1: 0.085, WR2: 0.085, TE: 0.06, ...OL },
  };
  const DEFENSE_BY = {
    "34": { DE1: 0.11, DE2: 0.11, NT: 0.1, OLB1: 0.08, OLB2: 0.08, ILB1: 0.09, ILB2: 0.09, CB1: 0.11, CB2: 0.11, S1: 0.06, S2: 0.06 },
    "43": { DE1: 0.11, DE2: 0.11, NT: 0.085, ILB2: 0.085, OLB1: 0.08, OLB2: 0.08, ILB1: 0.11, CB1: 0.11, CB2: 0.11, S1: 0.06, S2: 0.06 },
  };
  const OFFENSE = OFFENSE_BY.fb;
  const DEFENSE = DEFENSE_BY["34"];

  const norm = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const featureCache = new Map();
  function features(id) {
    let f = featureCache.get(id);
    if (f) return f;
    const p = POKEDATA[id - 1];
    f = {
      hp: norm(p.hp, 20, 150), atk: norm(p.atk, 20, 140), def: norm(p.def, 20, 140),
      spa: norm(p.spa, 20, 140), spd: norm(p.spd, 20, 140), spe: norm(p.spe, 20, 130),
      kg: norm(Math.log(Math.max(p.kg, 0.1)), Math.log(5), Math.log(400)),
      m: norm(HEIGHT_DM[id - 1] / 10, 0.3, 2.2),
    };
    featureCache.set(id, f);
    return f;
  }
  // 0–100: how well a Pokémon fits a slot in a scheme.
  function positionScore(id, slot, scheme = BASE_SCHEME) {
    const role = ROLES[roleOf(slot, scheme)];
    const f = features(id);
    let s = 0;
    for (const k in role.stats) s += role.stats[k] * f[k];
    let bonus = 0;
    for (const t of POKEDATA[id - 1].types) bonus = Math.max(bonus, role.types[t] || 0);
    return Math.max(0, Math.min(100, s * 100 + bonus));
  }

  // ---------- Team Score (0–1000) ----------
  // Weighted average of every starter's fit, with the weakest links pulling the team down
  // (a team is only as good as its worst blockers and cover men). The offense and defense ratings
  // work the same way, each with its own two weakest spots.
  const WEAK_LINKS = 4;
  const WEAK_WEIGHT = 0.18;
  function rawTeam(lineup, scheme = BASE_SCHEME) {
    const side = (weights) => {
      let avg = 0;
      const fits = [];
      for (const slot in weights) {
        const v = positionScore(lineup[slot], slot, scheme);
        avg += weights[slot] * v;
        fits.push(v);
      }
      fits.sort((a, b) => a - b);
      return { avg, fits, rated: avg * (1 - WEAK_WEIGHT) + ((fits[0] + fits[1]) / 2) * WEAK_WEIGHT };
    };
    const off = side(OFFENSE_BY[scheme.off]), def = side(DEFENSE_BY[scheme.def]);
    const all = [...off.fits, ...def.fits].sort((a, b) => a - b);
    const weak = all.slice(0, WEAK_LINKS).reduce((a, b) => a + b, 0) / WEAK_LINKS;
    const blended = (off.avg + def.avg) / 2;
    return { offense: off.rated, defense: def.rated, raw: blended * (1 - WEAK_WEIGHT) + weak * WEAK_WEIGHT };
  }
  // Raw quality to Team Score, per challenge: [raw, score] points joined by straight lines, so a
  // straight scale up to a knee, then a stretched top where 950 and a perfect 1000 take a great team.
  // Calibrated on the real results of ~57,000 seasons (October 2026), fitted to a mix of simulated
  // players who judge fits by eye (the game never shows them): about 1% of seasons go 17–0, about
  // 0.1% of teams reach 950 and about 0.01% reach 1000 (in the 17–0 Challenge 1000 was already
  // rarer, about 1 in 60,000, and stays that way). Gen 1–4 and Kanto-only teams have lower stats,
  // so Retro and the 151 Challenge have their own scales.
  const CURVES = {
    all: [[19.5, 0], [71.51, 950], [74, 1000]],
    retro: [[19.5, 0], [61.73, 820], [70.33, 950], [71.83, 1000]],
    151: [[24, 0], [49.49, 885], [56.3, 950], [58.52, 1000]],
  };
  function toScore(raw, variant) {
    const pts = CURVES[variant] || CURVES.all;
    if (raw <= pts[0][0]) return 0;
    for (let i = 1; i < pts.length; i++) {
      const [r0, s0] = pts[i - 1];
      const [r1, s1] = pts[i];
      if (raw <= r1) return Math.round(s0 + ((s1 - s0) * (raw - r0)) / (r1 - r0));
    }
    return 1000;
  }
  function teamScore(lineup, scheme = BASE_SCHEME, variant = "all") {
    const t = rawTeam(lineup, scheme);
    return { score: toScore(t.raw, variant), offense: toScore(t.offense, variant), defense: toScore(t.defense, variant) };
  }

  // ---------- Season ----------
  // 17 opponents of fixed strength on the same 0–1000 scale; each game's odds follow the score gap:
  // a 900 team is undefeated ~9% of the time, a 950 team ~24%. With the Team Score scales above,
  // about 1 season in 100 goes 17-0 (a strong player's more often: ~1 in 25 to 40).
  // The 151 Challenge plays its season in Kanto, in the order the original games visit it.
  const OPPONENT_NAMES = {
    "17-0": [
      "Pallet Town", "Littleroot Town", "Twinleaf Town", "New Bark Town", "Pewter City", "Violet City",
      "Rustboro City", "Oreburgh City", "Cerulean City", "Goldenrod City", "Mauville City", "Hearthome City",
      "Saffron City", "Blackthorn City", "Sootopolis City", "Snowpoint City", "Indigo Plateau",
    ],
    151: [
      "Pallet Town", "Viridian Forest", "Pewter City", "Mt. Moon", "Cerulean City", "S.S. Anne",
      "Vermilion City", "Rock Tunnel", "Lavender Town", "Celadon City", "Silph Co.", "Fuchsia City",
      "Saffron City", "Seafoam Islands", "Cinnabar Island", "Viridian City", "Indigo Plateau",
    ],
  };
  const opponentsFor = (names) => names.map((name, i) => ({ name, score: 350 + (560 * i) / 16 }));
  const OPPONENTS = opponentsFor(OPPONENT_NAMES["17-0"]);
  const OPPONENTS_151 = opponentsFor(OPPONENT_NAMES[151]);
  const SPREAD = 77.5;
  const winChance = (score, opp) => 1 / (1 + Math.exp(-(score - opp.score) / SPREAD));
  function simulateSeason(score, seed, game = "17-0") {
    const opponents = game === "151" ? OPPONENTS_151 : OPPONENTS;
    const order = opponents.map((o, k) => ({ o, r: rand(seed ^ 0x5eed, k) })).sort((a, b) => a.r - b.r).map((x) => x.o);
    const games = order.map((opp, k) => {
      const p = winChance(score, opp);
      const win = rand(seed ^ 0x9a3e, k) < p;
      // Football-ish scorelines that agree with the result.
      const a = 10 + Math.round(rand(seed ^ 0x51e7, k) * 24);
      const b = 3 + Math.round(rand(seed ^ 0x7ac1, k) * 20);
      const [hi, lo] = a > b ? [a, b] : a < b ? [b, a] : [a + 3, b];
      return { opponent: opp.name, rating: Math.round(opp.score), win, us: win ? hi : lo, them: win ? lo : hi };
    });
    const wins = games.filter((g) => g.win).length;
    return { wins, losses: GAMES - wins, games };
  }

  return {
    ROUNDS, GAMES, MAX_LEGENDS, REGIONS, GENS, VARIANTS, legendsIn, SLOT_ROLE, OFFENSE, DEFENSE, OFFENSE_BY, DEFENSE_BY, roleOf, POOL, nameOf,
    rand, roll, rerollType, rerollGen, available, typesFor, gensFor, MON_REROLLS, rollMon, rerollMon,
    positionScore, rawTeam, teamScore, simulateSeason, winChance, OPPONENTS,
  };
})();
