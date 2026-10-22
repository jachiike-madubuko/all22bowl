// Ratings from POKEDATA, rosters (the builder's All-22, Quick Draft, YOUR DRAFT, the region's 8 gyms and
// its Champion), team identities (play style, aggression, home/away kits) and team colors.
// Reads the site's classic-script globals (POKEDATA, POKEMON_NAMES, DRAFT, ALL22_REGIONS, ...) — never
// writes the builder's keys. The game's own saves use keys prefixed `all22bowl-`. Owner: modes team.
//
// REGION — the region this page plays in (regions.js), read once: picking another one reloads the page.
//   Its Pokédex (DEX, validId), the builder's lineup for its generation, its league (GYMS, CHAMPION:
//   Kanto's below, the others built from regions.js) and the save keys (saveKey) all follow it; Kanto
//   keeps every original key, name and number.
//
// TEAM OBJECT — makeTeam(kind, opts) returns a plain object (the World keeps it as teams.{home,away}.data):
//   key        'mine' | 'draft' | 'mydraft' | <gym key> | 'champion'
//   name short abbr city leader type          display identity (type = the leader's type, 'mixed', 'normal')
//   lineup {slot → dex id, K}   scheme {def:'34'|'43', off:'fb'|'slot'}   overall {ovr, off, def}
//   skill 0–1 (CPU smarts)   boost (rating multiplier)   stars 0–5 (difficulty shown on cards)
//   primary secondary / colors [primary, secondary]   identity colors (menus, cards)
//   style      'air' | 'ground' | 'balanced' | 'blitz' | 'trick'   CPU play-calling tendency (football team reads it)
//   aggression 0–1   blitz rate, deep shots, going for it on 4th (0.5 = neutral)
//   kits {home: {primary, secondary}, away: {primary, secondary}}
//   gyms + champion also: aces (= signature) badge order quote beaten pool
//   after resolveColors(home, away) (the World calls it): side 'home'|'away', kit = kitFor(...) worn
//   this game, color / color2 = kit.primary / kit.secondary (what render/ui paint with).
//
// KITS — kitFor(team, opponent, side?) → { kind:'home'|'away'|'alt', primary, secondary, dark, light, text }
//   primary always reads on the green turf AND against the opponent's kit (CIE Lab ΔE checks), so the two
//   teams never blend: the home side wears its home kit; the away side its home kit if it contrasts, else
//   its away kit, else a white or black alternate. dark/light are shades of primary for bases and rims,
//   text is ink or white for labels on primary. Memoized per (team, opponent, side): cheap per frame.
import { CFG } from "./config.js";
import { makeRng, clamp, colorDist, shade, hexToRgb } from "./util.js";
import { reportError } from "./events.js";

const G = globalThis;
const PD = () => G.POKEDATA || (typeof POKEDATA !== "undefined" ? POKEDATA : null); // eslint-disable-line no-undef
const NAMES = () => G.POKEMON_NAMES || (typeof POKEMON_NAMES !== "undefined" ? POKEMON_NAMES : []); // eslint-disable-line no-undef
const DRAFTG = () => G.DRAFT || (typeof DRAFT !== "undefined" ? DRAFT : null); // eslint-disable-line no-undef
const LEGENDS = () => G.LEGENDARIES || (typeof LEGENDARIES !== "undefined" ? LEGENDARIES : new Set([144, 145, 146, 150, 151])); // eslint-disable-line no-undef
const FACING = (id) => {
  const f = G.spriteFacing || (typeof spriteFacing !== "undefined" ? spriteFacing : null); // eslint-disable-line no-undef
  return f ? f("pixel", id) : "L";
};
const DEFAULTS = () => (G.DEFAULT_LINEUPS || (typeof DEFAULT_LINEUPS !== "undefined" ? DEFAULT_LINEUPS : null)); // eslint-disable-line no-undef
const store = () => {
  try { return G.localStorage || null; } catch (_) { return null; }
};

// The region (regions.js: ?region=, else the saved choice, else Kanto).
const RG = G.ALL22_REGIONS || null;
export const REGION = (RG && RG.current()) || { key: "kanto", name: "Kanto", gen: "1", range: [1, 151] };
// A Pokédex id of this region: lineups, drafts and saved teams hold nothing else.
export const validId = (v) => (RG ? RG.inRange(REGION, v) : Number.isInteger(v) && v >= REGION.range[0] && v <= REGION.range[1]);
// The region's key for a BOWL save: Kanto keeps the original (all22bowl-gyms-v1), Johto all22bowl-gyms-johto-v1.
export const saveKey = (base) => (RG ? RG.saveKey(base, REGION) : base);

export const OFF_SLOTS = ["QB", "HB", "FB", "WR1", "WR2", "TE", "LT", "LG", "C", "RG", "RT"];
export const DEF_SLOTS = ["DE1", "NT", "DE2", "OLB1", "ILB1", "ILB2", "OLB2", "CB1", "CB2", "S1", "S2"];
export const ALL_SLOTS = [...OFF_SLOTS, ...DEF_SLOTS];
const SLOT_ROLE = {
  S1: "S", S2: "S", CB1: "CB", CB2: "CB", OLB1: "OLB", OLB2: "OLB", ILB1: "ILB", ILB2: "ILB",
  DE1: "DE", DE2: "DE", NT: "NT", WR1: "WR", WR2: "WR", LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL",
  TE: "TE", QB: "QB", FB: "FB", HB: "HB", K: "K",
};

export function roleOf(slot, scheme) {
  const D = DRAFTG();
  if (D && D.roleOf && slot !== "K") return D.roleOf(slot, scheme);
  if (scheme && scheme.def === "43") {
    if (slot === "NT" || slot === "ILB2") return "DT";
    if (slot === "ILB1") return "MLB";
  }
  if (scheme && scheme.off === "slot" && slot === "FB") return "SLOT";
  return SLOT_ROLE[slot];
}

export const monName = (id) => (NAMES()[id - 1] || `#${id}`).toUpperCase();
export const monData = (id) => PD()[id - 1];
export const monFacing = (id) => FACING(id);
export const isLegend = (id) => LEGENDS().has(id);
export const monTypes = (id) => (monData(id) && monData(id).types) || ["normal"];

const normKg = (kg) => clamp((Math.log(Math.max(kg, 0.1)) - Math.log(5)) / (Math.log(400) - Math.log(5)), 0, 1);

export function fitOf(id, slot, scheme) {
  const D = DRAFTG();
  if (!D || slot === "K") return 0.6;
  try {
    return clamp(D.positionScore(id, slot, scheme) / 100, 0, 1);
  } catch (_) {
    return 0.6;
  }
}

// Every rating a player uses on the field. `boost` is the team's difficulty multiplier.
export function ratingsFor(id, slot, scheme, boost = 1) {
  const p = monData(id) || { types: ["normal"], hp: 60, atk: 60, def: 60, spa: 60, spd: 60, spe: 60, kg: 40 };
  const nk = normKg(p.kg);
  const fit = fitOf(id, slot, scheme);
  const eff = (CFG.FIT_BASE + CFG.FIT_GAIN * fit) * boost;
  const tb = { speed: 1, power: 1, anchor: 1, accuracy: 1, highHands: 1, juke: 1 };
  for (const t of p.types) {
    const b = CFG.TYPE_BONUS[t];
    if (b) for (const k in b) tb[k] *= b[k];
  }
  const spe = Math.min(p.spe, 160);
  const speedFit = 0.95 + 0.07 * fit;
  const r = {
    speed: (CFG.SPEED_BASE + CFG.SPEED_SPE * (spe / 150)) * tb.speed * speedFit * (0.97 + 0.03 * boost),
    accel: CFG.ACCEL_BASE + CFG.ACCEL_SPE * (spe / 150) - CFG.ACCEL_KG * nk,
    power: (0.55 * p.atk + 0.25 * p.def + 25 * nk) * eff * tb.power,
    anchor: (0.5 * p.def + 0.2 * p.hp + 30 * nk) * eff * tb.anchor,
    hands: (0.45 * p.spd + 0.35 * p.spa + 0.2 * spe) * eff,
    arm: (0.6 * p.spa + 0.4 * p.spd) * eff,
    accuracy: clamp(((0.6 * p.spa + 0.4 * p.spd) * eff) / 120, 0.25, 1.1) * tb.accuracy,
    agility: (spe - 0.3 * nk * 100) * eff,
    toughness: p.hp * (0.8 + 0.2 * eff),
    juke: tb.juke,
    highHands: tb.highHands,
    kick: (0.55 * p.spa + 0.25 * p.atk + 0.2 * p.spd) * (0.85 + 0.15 * boost),
    fit,
    eff,
    kg: p.kg,
    nk,
  };
  for (const k in r) {
    if (Number.isFinite(r[k])) continue;
    // keep the game running, but say so (the NaN invariant / __game.errors should see bad data)
    reportError("ratingsFor", `non-finite rating ${k}=${r[k]} for #${id} at ${slot} → 50`);
    r[k] = 50;
  }
  return r;
}

// ---------- Team identities ----------
export const TEAM_STYLES = ["air", "ground", "balanced", "blitz", "trick"];
export const STYLE_INFO = {
  air: { label: "AIR RAID", desc: "Lives on the deep ball" },
  ground: { label: "GROUND & POUND", desc: "Runs it right at you" },
  balanced: { label: "BALANCED", desc: "No weak spots to attack" },
  blitz: { label: "BLITZ HAPPY", desc: "Pressure on every down" },
  trick: { label: "TRICK PLAYS", desc: "Fakes, screens and misdirection" },
};

// Classic type colors (chips, card bands, type themes).
export const TYPE_COLORS = {
  normal: "#a8a878", fire: "#f08030", water: "#6890f0", electric: "#f8d030", grass: "#78c850", ice: "#98d8d8",
  fighting: "#c03028", poison: "#a040a0", ground: "#e0c068", flying: "#a890f0", psychic: "#f85888", bug: "#a8b820",
  rock: "#b8a038", ghost: "#705898", dragon: "#7038f8", dark: "#705848", steel: "#b8b8d0", fairy: "#ee99ac", mixed: "#e8c547",
};

const kit = (primary, secondary) => ({ primary, secondary });

// The Kanto gyms in badge order (regions.json → regions.kanto: names, abbrs, leaders, types, colors, aces).
// Difficulty rises along the ladder: stars (cards), skill (CPU smarts), boost (ratings) and roster
// noise (lower-ranked gyms fill their depth chart less carefully). slot: the offense lines up with a slot WR.
const KANTO_GYMS = [
  {
    key: "pewter", order: 1, name: "PEWTER ROCKERS", short: "ROCKERS", abbr: "PEW", city: "Pewter", leader: "Brock", type: "rock",
    pool: ["rock", "ground"], bench: ["fighting", "steel"], stars: 1, skill: 0.35, boost: 0.93, ladderBoost: 1.0, primary: "#8a6b3e", secondary: "#d9c49a",
    aces: [95, 76, 74, 141, 139], style: "ground", aggression: 0.25, badge: "BOULDER",
    kits: { home: kit("#8a6b3e", "#d9c49a"), away: kit("#d9c49a", "#5a4426") },
    quote: "MY ROCK-HARD LINE WON'T GIVE YOU AN INCH!", beaten: "YOU CRACKED MY WALL. THE BOULDER BADGE IS YOURS!",
  },
  {
    key: "cerulean", order: 2, name: "CERULEAN TIDE", short: "TIDE", abbr: "CER", city: "Cerulean", leader: "Misty", type: "water",
    pool: ["water", "ice"], bench: ["normal"], stars: 2, skill: 0.5, boost: 0.96, ladderBoost: 1.0, primary: "#2f6fd6", secondary: "#9fd3ff",
    aces: [121, 120, 55, 130], style: "balanced", aggression: 0.45, badge: "CASCADE",
    kits: { home: kit("#2f6fd6", "#9fd3ff"), away: kit("#e8f6ff", "#2f6fd6") },
    quote: "MY TIDE IS GONNA WASH RIGHT OVER YOUR DEFENSE!", beaten: "UGH... FINE! YOU EARNED THE CASCADE BADGE.",
  },
  {
    key: "vermilion", order: 3, name: "VERMILION VOLTS", short: "VOLTS", abbr: "VER", city: "Vermilion", leader: "Lt. Surge", type: "electric",
    pool: ["electric", "steel", "normal"], bench: ["flying"], stars: 2, skill: 0.55, boost: 0.97, ladderBoost: 1.03, primary: "#f2c200", secondary: "#ffe36e", colors: ["#f2c200", "#2b2b2b"],
    aces: [26, 101, 125, 135], style: "air", aggression: 0.75, badge: "THUNDER", slot: true,
    kits: { home: kit("#f2c200", "#2b2b2b"), away: kit("#2b2b2b", "#f2c200") },
    quote: "LISTEN UP, ROOKIE! MY RECEIVERS MOVE AT THE SPEED OF LIGHTNING!", beaten: "WHOA! YOU'RE THE REAL DEAL. TAKE THE THUNDER BADGE!",
  },
  {
    key: "celadon", order: 4, name: "CELADON BLOOM", short: "BLOOM", abbr: "CEL", city: "Celadon", leader: "Erika", type: "grass",
    pool: ["grass", "bug", "fairy"], bench: ["poison", "normal"], stars: 3, skill: 0.62, boost: 0.99, ladderBoost: 1.2, primary: "#3c9d3c", secondary: "#f7a8c8",
    aces: [45, 71, 114, 103], style: "trick", aggression: 0.3, badge: "RAINBOW",
    // green would vanish on the turf: Erika's side takes the field in petal pink
    kits: { home: kit("#f28cb8", "#2f7d32"), away: kit("#f6f6f2", "#3c9d3c") },
    quote: "OH MY... SHALL WE PLAY A GENTLE GAME TODAY?", beaten: "WHAT LOVELY FOOTBALL. PLEASE ACCEPT THE RAINBOW BADGE.",
  },
  {
    key: "fuchsia", order: 5, name: "FUCHSIA SHADOWS", short: "SHADOWS", abbr: "FUC", city: "Fuchsia", leader: "Koga", type: "poison",
    pool: ["poison", "bug", "dark"], bench: ["ghost", "ground"], stars: 3, skill: 0.68, boost: 1.0, ladderBoost: 1.04, primary: "#8e44ad", secondary: "#e3c4f5",
    aces: [110, 89, 49, 34], style: "blitz", aggression: 0.85, badge: "SOUL",
    kits: { home: kit("#8e44ad", "#e3c4f5"), away: kit("#e3c4f5", "#5b2a86") },
    quote: "FWAHAHA! YOU WON'T SEE MY BLITZ COMING!", beaten: "A NINJA KNOWS WHEN HE IS BEATEN. THE SOUL BADGE IS YOURS!",
  },
  {
    key: "saffron", order: 6, name: "SAFFRON MINDS", short: "MINDS", abbr: "SAF", city: "Saffron", leader: "Sabrina", type: "psychic",
    pool: ["psychic", "ghost", "fairy"], bench: ["normal", "poison"], stars: 4, skill: 0.8, boost: 1.02, ladderBoost: 1.22, primary: "#e0569b", secondary: "#ffd84a",
    aces: [65, 122, 97, 49], style: "trick", aggression: 0.6, badge: "MARSH", slot: true,
    kits: { home: kit("#e0569b", "#ffd84a"), away: kit("#ffd84a", "#b03070") },
    quote: "I ALREADY KNOW EVERY PLAY YOU ARE GOING TO CALL.", beaten: "I DID NOT FORESEE THIS... TAKE THE MARSH BADGE.",
  },
  {
    key: "cinnabar", order: 7, name: "CINNABAR BLAZE", short: "BLAZE", abbr: "CIN", city: "Cinnabar", leader: "Blaine", type: "fire",
    pool: ["fire", "dragon", "flying"], bench: ["normal", "rock"], stars: 4, skill: 0.85, boost: 1.03, ladderBoost: 1.03, primary: "#e2401c", secondary: "#ffb000",
    aces: [59, 78, 38, 126], style: "air", aggression: 0.9, badge: "VOLCANO",
    kits: { home: kit("#e2401c", "#ffb000"), away: kit("#ffb000", "#a02a10") },
    quote: "HAH! HOPE YOU BROUGHT BURN HEAL, BECAUSE WE BRING THE HEAT!", beaten: "I'VE BEEN BURNED! YOU'VE EARNED THE VOLCANO BADGE!",
  },
  {
    key: "viridian", order: 8, name: "VIRIDIAN TITANS", short: "TITANS", abbr: "VIR", city: "Viridian", leader: "Giovanni", type: "ground",
    pool: ["ground", "fighting", "normal"], bench: ["rock", "poison"], stars: 5, skill: 0.95, boost: 1.05, ladderBoost: 0.93, primary: "#2f6b3a", secondary: "#c8a24a",
    aces: [112, 34, 31, 51], style: "ground", aggression: 0.8, badge: "EARTH",
    // forest green disappears on the turf: the Titans wear black and gold at home
    kits: { home: kit("#25282f", "#c8a24a"), away: kit("#c8a24a", "#1f4d2b") },
    quote: "SO, YOU'VE MADE IT THIS FAR. SHOW ME WHAT YOUR TEAM IS MADE OF.", beaten: "...IMPRESSIVE. THE EARTH BADGE IS YOURS.",
  },
];

// The final boss of the Gym Challenge: Blue's mixed all-star team (not one of the 8 GYMS cards).
// venue: where the final is played (ladder card); foe: who the Hall of Fame tells you to beat.
const KANTO_CHAMPION = {
  key: "champion", id: "champion", order: 9, name: "PALLET CHAMPIONS", short: "CHAMPIONS", abbr: "PAL", city: "Pallet", leader: "Blue", type: "mixed",
  pool: null, stars: 5, skill: 1.0, boost: 1.0, ladderBoost: 0.82, primary: "#1f2d5c", secondary: "#e8c547", colors: ["#1f2d5c", "#e8c547"],
  aces: [18, 65, 112, 130, 59, 103, 6], style: "balanced", aggression: 0.7, badge: "CHAMPION",
  kits: { home: kit("#1f2d5c", "#e8c547"), away: kit("#e8c547", "#1f2d5c") },
  quote: "TOOK YOU LONG ENOUGH! MY TEAM IS THE BEST IN THE WHOLE LEAGUE!", beaten: "NO WAY... I LOST? YOU'RE THE NEW KANTO CHAMPION!",
  venue: "Indigo Plateau", foe: "Blue's Pallet Champions",
};

// ---------- the other regions' leagues ----------
// regions.js defines them once for both games (team, leader, type, colors, aces, city, badge). BOWL's side: the
// roster's type pools (the leader's types, then the bench), play style, the Gym Challenge strength, UI accents where
// an identity color sinks into the navy panels, and the leaders' lines (town: the gym's place is a town, not a city).
// A league with no entry here still plays: its type, Kanto's curve, stock lines.
// Each league's ladderBoost is measured like Kanto's (headless CPU-vs-CPU games, the generation's default All-22 at
// home) so it plays the climb Kanto plays today (measured: 99% vs Pewter … 61% vs Blue): Johto wins ~99% vs Violet
// stepping down to ~71% vs Blackthorn and ~61% vs Lance; Hoenn ~100% vs Roxanne … ~70% vs Wallace and ~63% vs
// Steven; Sinnoh ~100% vs Roark … ~70% vs Volkner and ~64% vs Cynthia. Some rosters change sharply with tiny steps
// (Mossdeep: 1.107 → 85%, 1.108 → 73%), hence the odd third decimal.
const LEAGUE_SIDE = {
  johto: {
    violet: {
      pool: ["flying"], bench: ["normal", "psychic"], style: "air", aggression: 0.4, slot: true, ladderBoost: 0.92,
      quote: "MY FLYERS OWN THE SKY. YOUR SECONDARY CAN'T COVER THEM ALL!", beaten: "GROUNDED... FINE. THE ZEPHYR BADGE IS YOURS.",
    },
    azalea: {
      pool: ["bug"], bench: ["grass", "poison"], style: "blitz", aggression: 0.8, town: true, ladderBoost: 1.09,
      quote: "I'VE STUDIED EVERY BLITZ THERE IS. MY SWARM WILL FIND YOUR QB!", beaten: "WOW, I LEARNED A LOT TODAY! HERE'S THE HIVE BADGE.",
    },
    goldenrod: {
      pool: ["normal"], bench: ["fairy", "fighting"], style: "ground", aggression: 0.5, ladderBoost: 1.19,
      quote: "MY STAMPEDE RUNS RIGHT UP THE MIDDLE. JUST TRY TO STOP IT!", beaten: "WAAAH! NO FAIR... OKAY, OKAY. TAKE THE PLAIN BADGE.",
    },
    ecruteak: {
      pool: ["ghost", "dark"], bench: ["psychic", "poison"], style: "trick", aggression: 0.6, slot: true, ladderBoost: 1.08,
      ui: ["#e0c068", "#a58fe0"], // the night purple sinks into the navy panels: gold leads in the menus
      quote: "YOU CAN'T TACKLE WHAT YOU CAN'T SEE. MY TRICKS WILL HAUNT YOU.", beaten: "I DIDN'T SEE THAT ONE COMING. THE FOG BADGE IS YOURS.",
    },
    cianwood: {
      pool: ["fighting"], bench: ["rock", "ground", "normal"], style: "ground", aggression: 0.75, ladderBoost: 1.06,
      quote: "WAHAHAH! MY LINE TRAINS UNDER A WATERFALL. YOU'RE NEXT!", beaten: "WAHAHAH! WHAT A HIT! YOU'VE EARNED THE STORM BADGE!",
    },
    olivine: {
      pool: ["steel", "rock"], bench: ["normal", "ground"], style: "balanced", aggression: 0.35, ladderBoost: 1.18,
      ui: ["#8c9aa8", "#c8d4e0"],
      quote: "UM... MY STEEL WALL DOESN'T BEND. PLEASE GIVE IT YOUR BEST.", beaten: "YOU BROKE THROUGH STEEL... PLEASE TAKE THE MINERAL BADGE.",
    },
    mahogany: {
      pool: ["ice"], bench: ["water", "ground", "normal"], style: "blitz", aggression: 0.85, town: true, ladderBoost: 1.04,
      ui: ["#6fb7d8", "#e2f2fa"],
      quote: "FIFTY WINTERS ON THE SIDELINE. YOUR OFFENSE WILL FREEZE UP.", beaten: "YOU THAWED THIS OLD DEFENSE. THE GLACIER BADGE IS YOURS.",
    },
    blackthorn: {
      pool: ["dragon", "rock", "dark"], bench: ["electric", "ground", "water"], style: "air", aggression: 0.8, ladderBoost: 1.02,
      ui: ["#3a7bd5", "#7ad1e8"],
      quote: "I'M THE BEST DRAGON TAMER THERE IS. NOBODY GETS PAST MY LINE!", beaten: "...FINE. YOU WIN. TAKE THE RISING BADGE.",
    },
    champion: {
      style: "balanced", aggression: 0.7, ladderBoost: 0.79,
      quote: "SO YOU BEAT EVERY GYM IN JOHTO. NOW FACE A REAL DRAGON MASTER!", beaten: "THE BEST TEAM WON TODAY. YOU'RE THE NEW JOHTO CHAMPION!",
    },
  },
  hoenn: {
    rustboro: {
      pool: ["rock"], bench: ["steel", "ground"], style: "ground", aggression: 0.25, ladderBoost: 0.97,
      quote: "I'VE STUDIED EVERY PLAYBOOK. MY ROCK LINE IS TEXTBOOK SOLID!", beaten: "SO THERE'S STILL MORE TO LEARN... THE STONE BADGE IS YOURS.",
    },
    dewford: {
      pool: ["fighting"], bench: ["water", "normal"], style: "blitz", aggression: 0.75, town: true, ladderBoost: 1.12,
      quote: "I RIDE THE BIG WAVES, AND MY RUSH HITS JUST AS HARD!", beaten: "WIPEOUT! YOU RODE THAT ONE OUT. THE KNUCKLE BADGE IS YOURS.",
    },
    mauville: {
      pool: ["electric", "steel"], bench: ["normal"], style: "trick", aggression: 0.6, slot: true, ladderBoost: 0.96,
      ui: ["#f5c518", "#8ec2ee"], // the blue trim sinks into the navy panels
      quote: "OHO! MY PLAYBOOK IS WIRED WITH SURPRISES. DON'T GET ZAPPED!", beaten: "WELL, I'M SHOCKED! YOU'VE EARNED THE DYNAMO BADGE.",
    },
    lavaridge: {
      pool: ["fire", "ground"], bench: ["rock", "dragon"], style: "air", aggression: 0.9, town: true, ladderBoost: 1.09,
      quote: "MY OFFENSE IS RED HOT TODAY. TRY NOT TO GET SCORCHED!", beaten: "PHEW, THAT GOT HEATED... THE HEAT BADGE IS YOURS!",
    },
    petalburg: {
      pool: ["normal"], bench: ["fighting", "dark"], style: "balanced", aggression: 0.5, ladderBoost: 1.1,
      quote: "A STRONG TEAM KEEPS ITS BALANCE. LET'S SEE IF YOURS CAN.", beaten: "WELL PLAYED. I'M PROUD TO HAND YOU THE BALANCE BADGE.",
    },
    fortree: {
      pool: ["flying"], bench: ["dragon", "grass", "bug"], style: "air", aggression: 0.55, slot: true, ladderBoost: 1,
      quote: "MY SKYHAWKS GLIDE PAST ANY COVERAGE. KEEP YOUR EYES UP!", beaten: "YOU CLIPPED MY WINGS... THE FEATHER BADGE IS YOURS.",
    },
    mossdeep: {
      pool: ["psychic"], bench: ["flying", "normal"], style: "trick", aggression: 0.6, ladderBoost: 1.108,
      quote: "TWO MINDS, ONE PLAYBOOK. WE KNOW YOUR CALL BEFORE YOU DO!", beaten: "NEITHER OF US SAW THAT COMING! THE MIND BADGE IS YOURS.",
    },
    sootopolis: {
      pool: ["water", "dragon"], bench: ["ice", "ground"], style: "balanced", aggression: 0.6, ladderBoost: 1.14,
      quote: "ALLOW ME TO SHOW YOU FOOTBALL AS GRACEFUL AS THE RAIN.", beaten: "BRAVO. WHAT A BEAUTIFUL GAME. THE RAIN BADGE IS YOURS.",
    },
    champion: {
      style: "balanced", aggression: 0.7, ladderBoost: 0.84,
      ui: ["#9fb4c8", "#dbe8f4"],
      quote: "EVERY GYM IN HOENN, BEATEN. NOW TRY A WALL OF STEEL AND STONE.", beaten: "WHAT A FIND YOU ARE. YOU'RE THE NEW HOENN CHAMPION!",
    },
  },
  sinnoh: {
    oreburgh: {
      pool: ["rock"], bench: ["ground", "steel"], style: "ground", aggression: 0.3, ladderBoost: 1,
      quote: "HARD HATS ON! MY LINE HITS LIKE A CAVE-IN.", beaten: "YOU DUG RIGHT THROUGH ME! THE COAL BADGE IS YOURS.",
    },
    eterna: {
      pool: ["grass"], bench: ["bug", "normal"], style: "trick", aggression: 0.35, ladderBoost: 1.09,
      quote: "MY FOREST GROWS THICK ON DEFENSE. GOOD LUCK FINDING A GAP!", beaten: "AW, WE GOT UPROOTED! HERE, THE FOREST BADGE IS YOURS.",
    },
    veilstone: {
      pool: ["fighting"], bench: ["normal", "steel", "rock"], style: "blitz", aggression: 0.75, ladderBoost: 1.065,
      quote: "I TRAIN BAREFOOT ON THE ROCKS. MY RUSH WILL KNOCK YOU FLAT!", beaten: "YOU'RE STRONG! I'LL TRAIN EVEN HARDER. TAKE THE COBBLE BADGE.",
    },
    pastoria: {
      pool: ["water"], bench: ["ground", "ice", "normal"], style: "ground", aggression: 0.8, ladderBoost: 1.03,
      quote: "CRASHER WAKE HAS ARRIVED! MY RUN GAME HITS LIKE A TIDAL WAVE!", beaten: "WHAT A MATCH! YOU'VE EARNED THE FEN BADGE!",
    },
    hearthome: {
      pool: ["ghost"], bench: ["psychic", "dark", "fairy"], style: "trick", aggression: 0.6, slot: true, ladderBoost: 1.22,
      ui: ["#b06ad0", "#f5b7b1"], // the night purple sinks into the navy panels
      quote: "BONJOUR! MY TEAM WILL DANCE RIGHT PAST YOUR DEFENSE.", beaten: "OH LA LA, WHAT A PERFORMANCE! THE RELIC BADGE IS YOURS.",
    },
    canalave: {
      pool: ["steel", "rock"], bench: ["ground", "psychic"], style: "balanced", aggression: 0.4, ladderBoost: 1.16,
      ui: ["#9aa8a9", "#d4dde0"],
      quote: "MY BOY DIGS COAL. I BUILD WALLS OF STEEL. TRY TO BREAK ONE!", beaten: "GWAHAHA! NOW THAT'S A GAME! THE MINE BADGE IS YOURS.",
    },
    snowpoint: {
      pool: ["ice"], bench: ["water", "ground", "normal"], style: "blitz", aggression: 0.85, ladderBoost: 0.98,
      quote: "TIME TO FOCUS! MY BLITZ WILL HIT YOU LIKE A BLIZZARD.", beaten: "WOW, WHAT FOCUS! YOU'VE EARNED THE ICICLE BADGE.",
    },
    sunyshore: {
      pool: ["electric"], bench: ["steel", "normal", "water"], style: "air", aggression: 0.7, slot: true, ladderBoost: 1.04,
      ui: ["#f1c40f", "#7fc0ea"],
      quote: "IT'S BEEN SO DULL HERE. GO ON, GIVE MY DEFENSE A REAL JOLT.", beaten: "NOW THAT WAS ELECTRIFYING. TAKE THE BEACON BADGE.",
    },
    champion: {
      style: "balanced", aggression: 0.75, ladderBoost: 0.847,
      ui: ["#f4d03f", "#d8d8e0"], // black sinks into the navy panels: gold leads in the menus
      quote: "I'VE BEEN WAITING FOR A CHALLENGER LIKE YOU. GIVE ME YOUR ALL!", beaten: "WHAT A WONDERFUL GAME. YOU'RE THE NEW SINNOH CHAMPION!",
    },
  },
};
// a league with no side entry: the leader's type sets the play style
const TYPE_STYLE = {
  flying: "air", electric: "air", fire: "air", dragon: "air", normal: "ground", rock: "ground", ground: "ground", fighting: "ground",
  poison: "blitz", bug: "blitz", dark: "blitz", psychic: "trick", ghost: "trick", grass: "trick", fairy: "trick",
};
// A regions.js gym (or Champion) in BOWL's format. Stars, CPU skill and rating boost come from the Kanto team on the
// same rung, so every league climbs the same curve.
function leagueTeam(t, order) {
  const champ = t.key === "champion";
  const side = (LEAGUE_SIDE[REGION.key] || {})[t.key] || {};
  const rung = champ ? KANTO_CHAMPION : KANTO_GYMS[order - 1];
  const [c1, c2] = t.colors;
  const [primary, secondary] = side.ui || t.colors;
  const name = t.team.toUpperCase();
  const badge = champ ? "CHAMPION" : String(t.badge || t.city).toUpperCase();
  return {
    key: t.key, id: t.key, order, name, short: champ ? "CHAMPIONS" : name.split(" ").pop(), abbr: t.abbr, city: t.city, leader: t.leader,
    type: t.type || "mixed", pool: champ ? null : side.pool || [t.type], bench: champ ? null : side.bench || ["normal"],
    stars: rung.stars, skill: rung.skill, boost: rung.boost, ladderBoost: side.ladderBoost ?? rung.boost, primary, secondary, colors: [c1, c2],
    aces: t.aces.slice(), style: side.style || TYPE_STYLE[t.type] || "balanced", aggression: side.aggression ?? 0.5, badge, slot: !!side.slot, town: !!side.town,
    kits: { home: kit(c1, c2), away: kit(c2, shade(c1, -0.35)) },
    quote: side.quote || `WELCOME TO ${t.city.toUpperCase()}! LET'S SEE WHAT YOUR TEAM CAN DO.`,
    beaten: side.beaten || (champ ? `YOU'RE THE NEW ${REGION.name.toUpperCase()} CHAMPION!` : `WELL PLAYED. THE ${badge} BADGE IS YOURS!`),
    ...(champ ? { venue: t.city, foe: `Champion ${t.leader}` } : {}),
  };
}

// The region's 8 gyms in badge order and its Champion.
export const GYMS = REGION.league ? REGION.league.gyms.map((g, i) => leagueTeam(g, i + 1)) : KANTO_GYMS;
export const CHAMPION = REGION.league ? leagueTeam(REGION.league.champion, 9) : KANTO_CHAMPION;
// colors = the team's identity pair (regions.json); primary/secondary stay readable as accents on
// the UI's navy panels (Vermilion's black second color only shows up in its kits).
for (const g of GYMS) {
  g.id = g.key;
  g.signature = g.aces;
  if (!g.colors) g.colors = [g.primary, g.secondary];
}
CHAMPION.signature = CHAMPION.aces;

// The Gym Challenge ladder in order: 8 gyms, then the Champion.
export const LADDER = [...GYMS, CHAMPION];
export const gymByKey = (key) => LADDER.find((g) => g.key === key);
export const teamInfo = gymByKey;

// Fill order: the spots that matter most first.
const FILL_ORDER = ["QB", "CB1", "CB2", "DE1", "DE2", "HB", "WR1", "WR2", "NT", "ILB1", "ILB2", "OLB1", "OLB2", "S1", "S2", "TE", "LT", "RT", "C", "LG", "RG", "FB"];
let DEX_CACHE = null;
// The region's Pokédex minus the Legendaries (the draft pool and the gyms' benches): in Kanto the original 151 less five.
export const DEX = () => {
  if (DEX_CACHE) return DEX_CACHE;
  if (RG) return (DEX_CACHE = RG.pool(REGION));
  const out = [];
  for (let id = REGION.range[0]; id <= REGION.range[1]; id++) if (!isLegend(id)) out.push(id);
  return (DEX_CACHE = out);
};
// Four of the region's Pokémon for menu art (the draft intro's headshots).
const SHOWCASE = { kanto: [6, 68, 135, 131], johto: [157, 214, 196, 160], hoenn: [257, 306, 282, 260], sinnoh: [392, 448, 445, 395] };
export const showcase = () => SHOWCASE[REGION.key] || DEX().slice(0, 4);

function bestKicker(lineup) {
  let best = lineup.QB, bv = -1;
  for (const s in lineup) {
    const p = monData(lineup[s]);
    if (!p) continue;
    const v = 0.6 * p.spa + 0.4 * p.spd;
    if (v > bv) { bv = v; best = lineup[s]; }
  }
  return best;
}

// A themed roster: the leader's aces first (each into the open spot it fits best, best matches
// first), then every other spot from the type pool by position fit (falling back to the region's
// whole Pokédex when the pool has nobody who fits), with a little seeded noise for the weaker gyms.
function buildRoster(poolTypes, benchTypes, aces, seed, noise, scheme) {
  const rng = makeRng(seed);
  const all = DEX();
  const ofTypes = (types) => (types ? all.filter((id) => monData(id).types.some((t) => types.includes(t))) : all);
  const typed = ofTypes(poolTypes);
  const bench = benchTypes ? ofTypes(benchTypes) : all;
  const lineup = {};
  const taken = new Set();
  const left = aces.filter((id) => monData(id));
  while (left.length) {
    let bi = -1, bs = null, bv = -1;
    left.forEach((id, i) => {
      for (const slot of FILL_ORDER) {
        if (lineup[slot]) continue;
        const v = fitOf(id, slot, scheme);
        if (v > bv) { bv = v; bi = i; bs = slot; }
      }
    });
    if (bi < 0) break;
    lineup[bs] = left[bi];
    taken.add(left[bi]);
    left.splice(bi, 1);
  }
  for (const slot of FILL_ORDER) {
    if (lineup[slot]) continue;
    const pick = (cands) => {
      let best = null, bv = -1;
      for (const id of cands) {
        if (taken.has(id)) continue;
        const v = fitOf(id, slot, scheme) + noise * rng.next();
        if (v > bv) { bv = v; best = id; }
      }
      return best;
    };
    // stay on theme: the leader's types, then the bench types, then anyone who can play the spot
    let id = pick(typed);
    if (id == null || fitOf(id, slot, scheme) < FALLBACK_FIT) id = pick(bench) ?? id;
    if (id == null || fitOf(id, slot, scheme) < FALLBACK_FIT) id = pick(all) ?? id;
    lineup[slot] = id;
    taken.add(id);
  }
  lineup.K = bestKicker(lineup);
  return lineup;
}

const FALLBACK_FIT = 0.2;

// The builder's "Your All-22" for this region's generation (read-only). With the builder's Legendaries
// switch on (pokemon-all22-legends-v1 === '1') the Legendaries lineup is read first.
export function readBuilderLineup() {
  const ls = store();
  let scheme = { def: "34", off: "fb" };
  let legends = false;
  try {
    legends = !!ls && ls.getItem("pokemon-all22-legends-v1") === "1";
  } catch (_) {}
  const keys = RG
    ? RG.lineupKeys(REGION)
    : legends ? ["pokemon-all22-lineup-legends-v1", "pokemon-all22-lineup-v1"] : ["pokemon-all22-lineup-v1", "pokemon-all22-lineup-legends-v1"];
  try {
    const f = JSON.parse((ls && ls.getItem("pokemon-all22-formation-v1")) || "null");
    if (f && (f.def === "34" || f.def === "43")) scheme.def = f.def;
    if (f && (f.off === "fb" || f.off === "slot")) scheme.off = f.off;
  } catch (_) {}
  for (const k of keys) {
    try {
      const raw = ls && ls.getItem(k);
      if (!raw) continue;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") continue;
      const ok = ALL_SLOTS.every((s) => validId(obj[s]));
      if (!ok) continue;
      const lineup = {};
      for (const s of ALL_SLOTS) lineup[s] = obj[s];
      lineup.K = validId(obj.K) ? obj.K : bestKicker(lineup);
      return { lineup, scheme, fromBuilder: true, legends: k.includes("legends") };
    } catch (_) {}
  }
  // nothing saved: the builder's starting lineup for the generation
  const d = RG ? RG.defaultLineup(REGION) : DEFAULTS() && DEFAULTS()[1];
  const base = d || {
    S1: 82, S2: 105, CB1: 123, OLB1: 57, ILB1: 24, ILB2: 62, OLB2: 28, CB2: 141, DE1: 68, NT: 143, DE2: 67,
    WR1: 135, LT: 9, LG: 76, C: 3, RG: 89, RT: 115, TE: 34, WR2: 85, QB: 94, FB: 128, HB: 112, K: 106,
  };
  const lineup = { ...base };
  if (!lineup.K) lineup.K = bestKicker(lineup);
  return { lineup, scheme: { def: "34", off: "fb" }, fromBuilder: false, legends: false };
}

// ---------- YOUR DRAFT (the arena draft's saved team) ----------
export const DRAFTED_KEY = saveKey("all22bowl-drafted-v1");
const HEX = /^#[0-9a-f]{6}$/i;
const cleanName = (s, max) => String(s || "").toUpperCase().replace(/[^A-Z0-9 .'&-]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

// The saved drafted team ({v, name, abbr, primary, secondary, lineup, scheme, ovr, created}) or null.
export function readDraftedTeam() {
  try {
    const ls = store();
    const o = JSON.parse((ls && ls.getItem(DRAFTED_KEY)) || "null");
    if (!o || typeof o !== "object" || o.v !== 1 || !o.lineup) return null;
    const lineup = {};
    for (const s of [...ALL_SLOTS, "K"]) {
      if (!validId(o.lineup[s])) return null;
      lineup[s] = o.lineup[s];
    }
    const scheme = { def: o.scheme && o.scheme.def === "43" ? "43" : "34", off: o.scheme && o.scheme.off === "slot" ? "slot" : "fb" };
    return {
      v: 1, lineup, scheme,
      name: cleanName(o.name, 20) || "YOUR DRAFT",
      abbr: cleanName(o.abbr, 3).replace(/[^A-Z0-9]/g, "") || "DRF",
      primary: HEX.test(o.primary) ? o.primary : "#e8352a",
      secondary: HEX.test(o.secondary) ? o.secondary : "#f6f6f2",
      created: typeof o.created === "string" ? o.created.slice(0, 32) : "",
      games: Number.isInteger(o.games) ? o.games : 0,
    };
  } catch (_) {
    return null;
  }
}
export function saveDraftedTeam(o) {
  try {
    const ls = store();
    if (ls) ls.setItem(DRAFTED_KEY, JSON.stringify({ ...o, v: 1 }));
    return true;
  } catch (_) {
    return false;
  }
}
export const hasDraftedTeam = () => !!readDraftedTeam();

// ---------- ratings for menus (draft cards, ladders) ----------
// Display ranges (≈ 5th percentile → best) so every rating reads 1–99 on a bar.
const NORM = {
  speed: [5.8, 8.6], power: [15, 120], anchor: [15, 110], hands: [20, 110], arm: [20, 115],
  accuracy: [0.25, 1.05], agility: [5, 120], toughness: [25, 150], kick: [25, 105],
};
export const STAT_LABEL = {
  speed: "SPD", power: "POW", anchor: "ANC", hands: "HND", arm: "ARM", accuracy: "ACC", agility: "AGI",
  toughness: "TGH", kick: "KCK", bulk: "WT",
};
export const STAT_NAME = {
  speed: "SPEED", power: "POWER", anchor: "ANCHOR", hands: "HANDS", arm: "ARM", accuracy: "ACCURACY", agility: "AGILITY",
  toughness: "TOUGHNESS", kick: "KICK", bulk: "WEIGHT",
};
const ROLE_STATS = {
  QB: ["arm", "accuracy", "speed"], HB: ["speed", "power", "agility"], FB: ["power", "anchor", "speed"],
  SLOT: ["speed", "hands", "agility"], WR: ["speed", "hands", "agility"], TE: ["hands", "power", "speed"],
  OL: ["power", "anchor", "bulk"], DE: ["power", "speed", "agility"], NT: ["power", "anchor", "bulk"],
  DT: ["power", "anchor", "speed"], OLB: ["power", "speed", "agility"], ILB: ["power", "speed", "anchor"],
  MLB: ["power", "speed", "hands"], CB: ["speed", "agility", "hands"], S: ["speed", "hands", "power"],
  K: ["kick", "accuracy", "speed"],
};
export const ROLE_NAME = {
  QB: "QUARTERBACK", HB: "HALFBACK", FB: "FULLBACK", SLOT: "SLOT RECEIVER", WR: "WIDE RECEIVER", TE: "TIGHT END",
  OL: "OFFENSIVE LINE", DE: "DEFENSIVE END", NT: "NOSE TACKLE", DT: "DEFENSIVE TACKLE", OLB: "OUTSIDE LINEBACKER",
  ILB: "INSIDE LINEBACKER", MLB: "MIDDLE LINEBACKER", CB: "CORNERBACK", S: "SAFETY", K: "KICKER",
};
const OL_NAME = { LT: "LEFT TACKLE", LG: "LEFT GUARD", C: "CENTER", RG: "RIGHT GUARD", RT: "RIGHT TACKLE" };
export const slotRole = (slot, scheme) => (slot === "K" ? "K" : roleOf(slot, scheme));
export const slotName = (slot, scheme) => OL_NAME[slot] || ROLE_NAME[slotRole(slot, scheme)] || slot;
// Short position label for the spot in this scheme ("WR", "SLOT", "DT", "MLB", ...).
export const slotTag = (slot, scheme) => {
  const r = slotRole(slot, scheme);
  return r === "OL" ? slot : r;
};

// 0–100 position fit as the builder rates it (the kicker: leg strength).
export function slotFit(id, slot, scheme) {
  if (slot === "K") {
    const p = monData(id);
    if (!p) return 0;
    return clamp(Math.round(((0.55 * p.spa + 0.25 * p.atk + 0.2 * p.spd) - 30) / 0.8), 0, 100);
  }
  return Math.round(fitOf(id, slot, scheme) * 100);
}
// Where a Pokémon ranks at a spot among the region's Pokédex (0 = the best fit), and a letter grade from that
// rank: S top 3 · A top 10 · B top 24 · C top 48 · D the rest.
const RANKS = new Map();
export function fitRank(id, slot, scheme) {
  const key = `${slot}|${scheme ? scheme.def + scheme.off : "34fb"}`;
  let r = RANKS.get(key);
  if (!r) {
    const list = DEX().map((k) => [k, slotFit(k, slot, scheme)]).sort((a, b) => b[1] - a[1]);
    r = new Map(list.map(([k], i) => [k, i]));
    RANKS.set(key, r);
  }
  return r.has(id) ? r.get(id) : DEX().length;
}
export const gradeOfRank = (rank) => (rank < 3 ? "S" : rank < 10 ? "A" : rank < 24 ? "B" : rank < 48 ? "C" : "D");
export const fitGrade = (v, id, slot, scheme) => (id != null ? gradeOfRank(fitRank(id, slot, scheme)) : v >= 80 ? "S" : v >= 68 ? "A" : v >= 55 ? "B" : v >= 42 ? "C" : "D");

// The key ratings for a spot (what a draft card shows), each 1–99, as the Pokémon would play there.
export function slotRatings(id, slot, scheme) {
  const r = ratingsFor(id, slot, scheme, 1);
  const keys = ROLE_STATS[slotRole(slot, scheme)] || ROLE_STATS.WR;
  return keys.map((k) => {
    let v;
    if (k === "bulk") v = r.nk * 98 + 1;
    else {
      const [lo, hi] = NORM[k];
      v = 1 + (98 * (r[k] - lo)) / (hi - lo);
    }
    return { key: k, label: STAT_LABEL[k], name: STAT_NAME[k], value: clamp(Math.round(v), 1, 99) };
  });
}

// The type most of a lineup shares (team themes, draft names).
export function dominantType(lineup) {
  const n = {};
  for (const s in lineup) for (const t of monTypes(lineup[s])) n[t] = (n[t] || 0) + (t === "normal" ? 0.6 : 1);
  let best = "normal", bv = -1;
  for (const t in n) if (n[t] > bv) { bv = n[t]; best = t; }
  return best;
}

// Team OVR (40–99) from the builder's team rating; works on a partial lineup too (the draft's
// running overall): open spots count as replacement-level players (fit `REPLACEMENT`), so the OVR
// climbs as good picks fill the depth chart and dips on a reach, ending exactly on teamOverall().
const WEAK_LINKS = 4, WEAK_WEIGHT = 0.18, REPLACEMENT = 45;
const ovrOf = (v) => clamp(Math.round(v * 1.62), 40, 99);
export function partialOverall(lineup, scheme) {
  const D = DRAFTG();
  if (!D || !D.OFFENSE_BY || !D.DEFENSE_BY) return null;
  const fits = [];
  const side = (weights) => {
    let s = 0, w = 0;
    const mine = [];
    for (const slot in weights) {
      const v = lineup[slot] ? D.positionScore(lineup[slot], slot, scheme) : REPLACEMENT;
      s += weights[slot] * v;
      w += weights[slot];
      mine.push(v);
      fits.push(v);
    }
    mine.sort((a, b) => a - b);
    const avg = s / w;
    return { avg, rated: avg * (1 - WEAK_WEIGHT) + ((mine[0] + mine[1]) / 2) * WEAK_WEIGHT };
  };
  try {
    const off = side(D.OFFENSE_BY[scheme.off] || D.OFFENSE_BY.fb), def = side(D.DEFENSE_BY[scheme.def] || D.DEFENSE_BY["34"]);
    fits.sort((a, b) => a - b);
    const weak = fits.slice(0, WEAK_LINKS).reduce((a, b) => a + b, 0) / WEAK_LINKS;
    const raw = ((off.avg + def.avg) / 2) * (1 - WEAK_WEIGHT) + weak * WEAK_WEIGHT;
    return { ovr: ovrOf(raw), off: ovrOf(off.rated), def: ovrOf(def.rated) };
  } catch (_) {
    return null;
  }
}

// Unclamped team ratings on the OVR scale (strong rosters go past 99).
function rawOverall(lineup, scheme) {
  const D = DRAFTG();
  try {
    if (D && D.rawTeam) {
      const t = D.rawTeam(lineup, scheme);
      return { ovr: t.raw * 1.62, off: t.offense * 1.62, def: t.defense * 1.62 };
    }
  } catch (_) {}
  const o = teamOverall(lineup, scheme);
  return { ovr: o.ovr, off: o.off, def: o.def };
}

export function teamOverall(lineup, scheme) {
  const D = DRAFTG();
  try {
    if (D && D.rawTeam) {
      const t = D.rawTeam(lineup, scheme);
      return { ovr: ovrOf(t.raw), off: ovrOf(t.offense), def: ovrOf(t.defense) };
    }
  } catch (_) {}
  let s = 0;
  for (const slot of ALL_SLOTS) s += fitOf(lineup[slot], slot, scheme);
  const v = Math.round((s / ALL_SLOTS.length) * 100);
  return { ovr: v, off: v, def: v };
}

export function makeTeam(kind, opts = {}) {
  if (kind === "mine") {
    const b = readBuilderLineup();
    return finishTeam({
      key: "mine", name: "YOUR ALL-22", short: "ALL-22", abbr: "YOU", city: REGION.league ? REGION.name : "Pallet", leader: "You", type: "normal",
      primary: "#e8352a", secondary: "#f6f6f2", stars: 0, skill: 0.82, boost: 1.0,
      kits: { home: kit("#e8352a", "#f6f6f2"), away: kit("#f6f6f2", "#e8352a") },
      lineup: b.lineup, scheme: b.scheme, fromBuilder: b.fromBuilder, legends: b.legends,
    });
  }
  if (kind === "mydraft") {
    const d = readDraftedTeam();
    if (d) {
      return finishTeam({
        key: "mydraft", name: d.name, short: d.name.split(" ").pop().slice(0, 10), abbr: d.abbr, city: REGION.name, leader: "You",
        type: dominantType(d.lineup), primary: d.primary, secondary: d.secondary, stars: 0, skill: 0.82, boost: 1.0,
        kits: { home: kit(d.primary, d.secondary), away: kit(d.secondary === d.primary ? "#f6f6f2" : d.secondary, d.primary) },
        lineup: { ...d.lineup }, scheme: { ...d.scheme }, created: d.created,
      });
    }
    // nothing drafted yet: a quick draft stands in under the same name
    const t = makeTeam("draft", { seed: opts.seed ?? 1 });
    t.key = "mydraft";
    t.name = "YOUR DRAFT";
    return t;
  }
  if (kind === "draft") {
    const seed = opts.seed ?? 1;
    const rng = makeRng(seed * 7919 + 13);
    const scheme = { def: rng.chance(0.5) ? "34" : "43", off: rng.chance(0.6) ? "fb" : "slot" };
    const all = DEX();
    const lineup = {};
    const taken = new Set();
    const order = FILL_ORDER.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const slot of order) {
      const ranked = all.filter((id) => !taken.has(id)).map((id) => ({ id, v: fitOf(id, slot, scheme) })).sort((a, b) => b.v - a.v);
      const pick = ranked[Math.floor(rng.next() * Math.min(5, ranked.length))].id;
      lineup[slot] = pick;
      taken.add(pick);
    }
    lineup.K = bestKicker(lineup);
    return finishTeam({
      key: "draft", name: "QUICK DRAFT", short: "DRAFT", abbr: "QDR", city: REGION.name, leader: "You", type: "normal",
      primary: "#3a86ff", secondary: "#ffd23f", stars: 0, skill: 0.82, boost: 1.0,
      kits: { home: kit("#3a86ff", "#ffd23f"), away: kit("#ffd23f", "#1b4fa8") },
      lineup, scheme, draftSeed: seed,
    });
  }
  const gym = gymByKey(kind) || GYMS[1];
  const scheme = gym.key === "champion"
    ? { def: "43", off: "fb" }
    : { def: gym.stars % 2 ? "43" : "34", off: gym.slot ? "slot" : "fb" };
  const noise = 0.32 * (1 - gym.skill);
  const lineup = buildRoster(gym.pool, gym.bench, gym.aces, gym.key.length * 1009 + gym.stars * 31 + gym.order * 7, noise, scheme);
  const t = finishTeam({ ...gym, lineup, scheme });
  // Cards show the ladder's difficulty curve (66 → 99); the fit-based numbers only shade OFF/DEF.
  const raw = rawOverall(lineup, scheme);
  const target = LADDER_OVR[gym.order - 1] || t.overall.ovr;
  t.overall = {
    ovr: target,
    off: clamp(Math.round(target + (raw.off - raw.ovr) * 0.5), 40, 99),
    def: clamp(Math.round(target + (raw.def - raw.ovr) * 0.5), 40, 99),
  };
  return t;
}

// The ladder's difficulty curve: team OVR shown for gyms 1–8 and the Champion. A gym's real strength
// is its roster, `skill` (CPU smarts, rising) and its rating multiplier: `boost` for exhibition games,
// the attract mode and simulate() (the football tuning's baseline), and `ladderBoost` in the Gym
// Challenge — calibrated with simulate() so Your All-22's CPU wins ~95% vs Pewter, ~60% vs Cinnabar,
// ~50% vs Viridian and ~35% vs the Champion (see ladderTune).
export const LADDER_OVR = [66, 71, 75, 79, 83, 87, 91, 95, 99];

// Exhibition games: the eight gyms play up (ratings x EXHIBITION_GYM_BOOST on top of their `boost`),
// so the default Your All-22 (OVR ~96) wins ~70% of autopilot games against the mid-ladder gyms
// instead of all of them (measured with headless autoplay worlds: x1.00 100%, x1.12 72%, x1.16 61%).
// simulate() and the attract mode keep the plain `boost` (the football tuning's baseline); the Gym
// Challenge replaces it with `ladderBoost` (ladderTune).
export const EXHIBITION_GYM_BOOST = 1.16;
export function exhibitionTune(team) {
  const g = team && GYMS.find((x) => x.key === team.key);
  if (g && !team.ladder) {
    team.boost = (g.boost || 1) * EXHIBITION_GYM_BOOST;
    team.exhibition = true;
  }
  return team;
}

// Turns an opponent made by makeTeam(<gym key>) into its Gym Challenge version (in place).
export function ladderTune(team) {
  const g = team && gymByKey(team.key);
  if (g && Number.isFinite(g.ladderBoost)) {
    team.boost = g.ladderBoost;
    team.ladder = true;
  }
  return team;
}

function finishTeam(t) {
  t.overall = teamOverall(t.lineup, t.scheme);
  const b = (t.boost || 1) * (t.boost || 1);
  for (const k in t.overall) t.overall[k] = clamp(Math.round(t.overall[k] * b), 40, 99);
  t.dark = t.primary;
  t.style = TEAM_STYLES.includes(t.style) ? t.style : "balanced";
  t.aggression = clamp(Number.isFinite(t.aggression) ? t.aggression : 0.5, 0, 1);
  t.colors = t.colors || [t.primary, t.secondary];
  if (!t.kits) t.kits = { home: kit(t.primary, t.secondary), away: kit(t.secondary || "#f6f6f2", t.primary) };
  // before a game pairs it with an opponent the team shows its home kit
  if (!t.color) {
    t.color = t.kits.home.primary;
    t.color2 = t.kits.home.secondary;
  }
  return t;
}

// ---------- kits & color contrast ----------
const LAB = new Map();
function lab(hex) {
  let v = LAB.get(hex);
  if (v) return v;
  const [r, g, b] = hexToRgb(hex).map((c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  v = [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  if (LAB.size > 512) LAB.clear();
  LAB.set(hex, v);
  return v;
}
// Perceptual color difference (CIE76 ΔE): ≈ 2 barely visible, 40+ clearly different at a glance.
export function colorDelta(a, b) {
  if (!HEX.test(a) || !HEX.test(b)) return colorDist(HEX.test(a) ? a : "#000000", HEX.test(b) ? b : "#000000") / 4;
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
const TURF = [CFG.PALETTE.turfA, CFG.PALETTE.turfB];
export const KIT_TURF_MIN = 40; // kit vs the grass
export const KIT_CLASH_MIN = 55; // kit vs the other team's kit
const turfDelta = (c) => Math.min(colorDelta(c, TURF[0]), colorDelta(c, TURF[1]));
const USER_KEYS = new Set(["mine", "draft", "mydraft"]);

function kitList(team) {
  const k = team.kits || { home: kit(team.primary, team.secondary), away: kit(team.secondary || "#f6f6f2", team.primary) };
  const P = k.home.primary, S = k.home.secondary || "#f6f6f2";
  return [
    { kind: "home", primary: P, secondary: S },
    { kind: "away", primary: k.away.primary, secondary: k.away.secondary || P },
    { kind: "alt", primary: "#f6f6f2", secondary: turfDelta(P) >= KIT_TURF_MIN ? P : S },
    { kind: "alt", primary: "#1b1d24", secondary: colorDelta(S, "#1b1d24") > 30 ? S : "#f6f6f2" },
  ];
}
// Which of two teams is at home (and keeps its colors): the one marked home by resolveColors, else
// the player's team, else the first by key — the same answer whichever argument order kitFor gets.
function homeTeamOf(a, b) {
  if (!b) return a;
  if (a.side === "home" || b.side === "away") return a;
  if (b.side === "home" || a.side === "away") return b;
  const ua = USER_KEYS.has(a.key), ub = USER_KEYS.has(b.key);
  if (ua !== ub) return ua ? a : b;
  return String(a.key) <= String(b.key) ? a : b;
}
function finishKit(c) {
  const [r, g, b] = hexToRgb(c.primary);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return {
    kind: c.kind, primary: c.primary, secondary: c.secondary,
    dark: shade(c.primary, -0.55), light: shade(c.primary, 0.35), text: lum > 0.6 ? "#0b0d14" : "#f6f6f2",
  };
}
// [merge] ΔE alone lets same-lightness hue neighbours through (red vs magenta reads as one team in
// a pile — the art team's clash rule): two kits also need a lightness step, a clear hue difference
// or a clear chroma difference (red vs amber, red vs brown, red vs light pink stay apart).
export function kitsApart(a, b) {
  if (colorDelta(a, b) < KIT_CLASH_MIN) return false;
  if (!HEX.test(a) || !HEX.test(b)) return true;
  const p = lab(a), q = lab(b);
  const C1 = Math.hypot(p[1], p[2]), C2 = Math.hypot(q[1], q[2]);
  let gap = Math.abs(Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1])) * (180 / Math.PI);
  if (gap > 180) gap = 360 - gap;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((gap / 2) * (Math.PI / 180));
  return Math.abs(p[0] - q[0]) >= 18 || dH >= 60 || Math.abs(C1 - C2) >= 40;
}
function pickKit(team, opponent, isHome) {
  const cands = kitList(team);
  const readable = cands.filter((c) => turfDelta(c.primary) >= KIT_TURF_MIN);
  if (!opponent || isHome) return readable[0] || cands[0];
  const opp = pickKit(opponent, null, true);
  const ok = readable.find((c) => kitsApart(c.primary, opp.primary));
  if (ok) return ok;
  let best = cands[0], bv = -1;
  for (const c of cands) {
    const v = Math.min(turfDelta(c.primary), colorDelta(c.primary, opp.primary));
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}
// The kit `team` wears against `opponent` (side 'home'|'away' optional; resolveColors marks both teams).
export function kitFor(team, opponent = null, side = null) {
  if (!team) return null;
  const isHome = side ? side === "home" : homeTeamOf(team, opponent) === team;
  const memo = team._kitMemo;
  if (memo && memo.opp === opponent && memo.home === isHome && memo.src === team.kits) return memo.kit;
  const k = finishKit(pickKit(team, opponent, isHome));
  try {
    Object.defineProperty(team, "_kitMemo", { value: { opp: opponent, home: isHome, src: team.kits, kit: k }, writable: true, configurable: true, enumerable: false });
  } catch (_) {}
  return k;
}

// Keep the two teams readable against each other and on the grass (see kitFor): sets side, kit,
// color and color2 on both teams.
export function resolveColors(home, away) {
  home.side = "home";
  away.side = "away";
  home.kit = kitFor(home, away, "home");
  away.kit = kitFor(away, home, "away");
  home.color = home.kit.primary;
  home.color2 = home.kit.secondary;
  away.color = away.kit.primary;
  away.color2 = away.kit.secondary;
}

// The roster's star players (for cards): the leader's aces, then best fits at QB / skill / defense.
export function starPlayers(team, n = 3) {
  const pref = ["QB", "HB", "WR1", "WR2", "CB1", "DE1", "ILB1", "TE"];
  const out = [];
  const aces = team.aces || team.signature;
  if (aces) for (const id of aces) if (out.length < n && Object.values(team.lineup).includes(id) && !out.includes(id)) out.push(id);
  for (const s of pref) if (out.length < n && !out.includes(team.lineup[s])) out.push(team.lineup[s]);
  return out.slice(0, n);
}
