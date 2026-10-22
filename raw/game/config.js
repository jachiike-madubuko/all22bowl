// Every tunable constant in one place: field geometry, timing, movement, contact, passing,
// kicking, AI, rendering and the pixel palette. Tune feel here, not in the systems.

export const CFG = {
  // ---------- Field geometry (yards) ----------
  FIELD_W: 53.333, // sideline to sideline
  HASH_TOP: 23.58,
  HASH_BOT: 29.75,
  EZ: 10, // end zone depth

  // ---------- Rendering (buffer pixels; 1 buffer px = 1 sprite px) ----------
  PX_PER_YARD: 22,
  Y_SQUASH: 0.62, // oblique look: pxPerYardY = PX_PER_YARD * Y_SQUASH
  Z_PX: 20, // px per yard of height (ball arcs, hops)
  FIELD_X0: -13, // leftmost yard drawn in the field canvas
  FIELD_X1: 113,
  STANDS_PX: 104, // crowd strip above the top sideline
  APRON_PX: 70, // sideline area below the bottom sideline
  TARGET_YARDS: 44, // integer scale chosen so about this many yards are visible
  MIN_BACKING_SCALE: 2, // backing store at least 2 screen px per art px (crisp + auditable)

  // ---------- Time ----------
  DT: 1 / 60,
  QUARTER_SEC: 120,
  RUNOFF: 4.5, // clock drained after an inbounds tackle (arcade pace: more snaps per quarter)
  PRESNAP_AUTO: 1.2, // CPU snaps after this
  PRESNAP_HUMAN_AUTO: 9, // the human's offense snaps on its own after this
  SET_SEC: 0.55, // the formation hustles from the huddle to its set spots in this time (human offense)
  SET_SEC_CPU: 0.9, // ...a little more leisurely when the CPU has the ball
  PRESNAP_MIN_SEC: 0.6, // an early SNAP press is queued and fires as soon as the set is legal
  PAT_CHOICE_AUTO: 8, // the human's PAT / 2-point choice defaults to the kick after this
  KICKOFF_SET: 1.15, // kicker's approach before the boot (CPU kicks)
  KICKOFF_HUMAN_AUTO: 3, // the human's kicking team boots it deep on its own after this
  KICKOFF_CHOICE_AUTO: 8, // trailing kickoff decision panel (deep vs onside) defaults to deep after this
  FORWARD_PROGRESS_SEC: 1.9, // a carrier stood up in a pile this long is down at his furthest spot
  FORWARD_PROGRESS_R: 2.2, // ...when a defender is this close
  DEAD_TIME: 1.6,
  DEAD_TIME_BIG: 3.0, // TDs, turnovers
  PLAYCLOCK: 20, // soft play clock for the human's play call (real seconds)
  MAX_DOWN_TIME: 25, // invariant: every down ends within this much game time
  HEADLESS_WAIT: 0.25, // phase waits when simulating headlessly

  // ---------- Ratings (from POKEDATA) ----------
  SPEED_BASE: 5.6,
  SPEED_SPE: 3.0,
  ACCEL_BASE: 11,
  ACCEL_SPE: 7,
  ACCEL_KG: 2.5,
  FIT_BASE: 0.75,
  FIT_GAIN: 0.35,
  TYPE_BONUS: {
    electric: { speed: 1.03 },
    fighting: { power: 1.06 },
    rock: { anchor: 1.06 },
    steel: { anchor: 1.06 },
    psychic: { accuracy: 1.05 },
    flying: { highHands: 1.04 },
    ghost: { juke: 1.05 },
  },

  // ---------- Movement ----------
  PLAYER_R: 0.55,
  DECEL_MUL: 1.7, // braking is faster than speeding up
  USER_ACCEL_MUL: 1.25, // the human's player feels snappy
  TURN_DRAG: 0.18, // speed lost on hard cuts (fraction)
  BACKPEDAL_MUL: 0.78,
  CARRIER_SPEED_MUL: 0.97,

  // ---------- Blocking ----------
  ENGAGE_RANGE: 0.3, // gap between bodies
  SHED_BASE: 1.7, // seconds, scaled by strength ratio
  SHED_MIN: 0.45,
  SHED_MAX: 4.2,
  DOUBLE_TEAM_SHED: 1.7,
  RUN_BLOCK_HOLD: 1.5, // run blocks last longer than the base shed time...
  PASS_BLOCK_HOLD: 1.55, // ...and pass protection longer still
  BLOCK_PUSH: 1.5, // yd/s per unit of strength edge
  BLOCK_SLIDE: 1.25, // rusher's lateral slide while engaged
  PANCAKE_EDGE: 28,
  PANCAKE_P: 0.1,
  PANCAKE_TIME: 1.2,
  REENGAGE_COOLDOWN: 0.9,

  // ---------- Tackling ----------
  TACKLE_RANGE: 0.38, // gap between bodies
  TACKLE_INTERVAL: 0.35,
  TACKLE_BASE: 0.53,
  TACKLE_FRONT: 0.08, // bonus for a tackler squared up in front of the carrier
  TACKLE_CATCH: 0.14, // bonus on a receiver who just caught it (no time to get going)
  TACKLE_POWER_K: 0.004,
  TACKLE_CLOSE_K: 0.022,
  TACKLE_MIN: 0.15,
  TACKLE_MAX: 0.95,
  ENGAGED_TACKLE_MUL: 0.18, // arm tackle while blocked
  BROKEN_STUN: 0.6,
  BROKEN_SLOW: 0.25,
  DIVE_RANGE: 2.4,
  DIVE_LUNGE: 1.5,
  DIVE_BONUS: 0.15,
  DIVE_MISS_DOWN: 1.0,
  JUKE_TIME: 0.35,
  JUKE_EVADE: 0.35,
  JUKE_COOLDOWN: 1.6,
  STIFF_TIME: 0.4,
  STIFF_COOLDOWN: 1.4,
  FUMBLE_K: 0.0035, // chance ∝ hit power / toughness
  SCOOP_P: 0.5, // a defender with room to run scoops a loose ball instead of falling on it
  FALL_FORWARD: 0.8,
  FALL_MOMENTUM: 0.15, // yd of forward fall per yd/s of the carrier's downfield speed at the hit

  // ---------- Passing ----------
  THROW_WINDUP: 0.18,
  BALL_SPEED_MIN: 18,
  BALL_SPEED_MAX: 28,
  GRAVITY: 10.7, // yd/s²
  RELEASE_Z: 2.0,
  CATCH_Z: 1.5,
  CATCH_REACH: 1.15,
  CATCH_Z_MAX: 2.4,
  ACC_BASE: 0.35, // yd of error at any distance
  ACC_DIST: 0.055, // error per yd of throw, scaled by (1 - arm accuracy)
  ACC_PRESSURE: 1.4, // extra error when a rusher is close
  ACC_DEEP: 0.022, // extra error per yd beyond 18 (deep balls are hard to drop in a bucket)
  CATCH_BASE: 0.84,
  CATCH_HANDS_K: 0.0032,
  CONTEST_RANGE: 1.6,
  CROWD_R: 2.4, // defenders this close to the ball when it comes down crowd the catch
  CROWD_PBU: 0.16, // breakup chance per extra defender in the crowd
  INT_BASE: 0.15,
  PBU_BASE: 0.32,
  LANE_REACH: 0.75, // a defender this close to a low ball in flight can get a hand on it
  LANE_Z: 2.25, // ...if it's no higher than this
  LANE_INT: 0.04,
  LANE_TIP: 0.3,
  PITCH_SPEED: 11,

  // ---------- Kicking ----------
  PAT_P: 0.95,
  PUNT_NET_MIN: 37, // gross punt distance range (yd in the air), by the punter's leg
  PUNT_NET_MAX: 47,
  FG_RANGE_LOS: 62, // FG offered when the ball is inside the opponent 38
  LATE_FG_SEC: 10, // ...on any down (not just 4th) with this little left in the half or the game
  KICKOFF_TB_SPOT: 25,
  PUNT_TB_SPOT: 20,
  SAFETY_FREE_SPOT: 35,
  KICKOFF_SPOT: 35, // kicking team's own yard line
  FREE_KICK_SPOT: 20, // after a safety
  KICKOFF_OOB_SPOT: 40, // kickoff out of bounds: receiving team's ball here
  KICK_HANG: 3.55, // kickoff hang time (s), + leg
  KICK_DEPTH: 61, // kickoff distance (yd), + leg
  PUNT_HANG: 4.4,
  KICK_GRAVITY: 6.4, // kicked balls float a little (arcade hang time without sailing off the top of the screen)
  KICK_CATCH_R: 1.35, // a returner within this of the ball when it comes down fields it
  MUFF_P: 0.02, // base muff chance on a kick catch (more with a gunner in his face)
  ONSIDE_DIST: 11.5, // onside kick travels about this far
  ONSIDE_SHIFT: 1.6, // the kicking team's shift into the onside bunch: seconds from the call to the boot
  ONSIDE_CPU_CALL: 0.5, // the CPU calls its onside kick (and shifts) this long after the teams line up
  KNEEL_DEPTH: 3.5, // CPU returners take a knee when catching deeper than this in the end zone
  TWO_PT_LOS: 98, // 2-point try snapped from the 2

  // ---------- AI ----------
  RUN_READ: 0.4, // linebackers read run vs pass
  PA_BITE: 0.55,
  COVER_LAG: 0.32, // man coverage reaction lag (s), shortened by skill
  BALL_REACT: 0.28,
  QB_READ_STEP: 0.42,
  QB_OPEN_SEP: 2.3,
  QB_MAX_HOLD: 2.9,
  LATE_RUSH_T: 4.6, // a QB still holding the ball after this gets the underneath defenders coming (coverage sack)
  QB_LANE_R: 1.6, // a defender this close to the QB → catch-point line caps that receiver's openness
  QB_DEEP_SEP: 0.2, // extra separation the CPU wants before a deep shot
  QB_DEEP_YDS: 12, // ...for a target this far downfield (a vertical is caught ~14 yd deep)
  QB_CROWD_K: 0.35, // openness lost per extra defender around the catch point
  PRESSURE_R: 2.1,
  AI_THINK_JITTER: 0.06,
  // FLIP: the CPU offense flips its play calls as a player can (ai.js cpuFlip), so a call's name doesn't give its side
  // away. false: the CPU never flips (and draws no random numbers for it: games play exactly as before the feature)
  CPU_FLIP: true,
  CPU_WIDE_P: 0.8, // an outside play (playbook `wide`) with the ball on a hash goes to the wide side this often
  CPU_HASH_OFF: 1.5, // the ball counts as on a hash this many yards or more off the middle of the field

  // ---------- Camera ----------
  CAM_STIFF: 7.5,
  CAM_LEAD_X: 0.18, // fraction of the view: frame the LOS left of center pre-snap
  PUNCH_TIME: 1.0,
  SLOWMO: 0.35,
  SLOWMO_DIST: 4.5,

  // ---------- Overtime ----------
  OT_MAX_POSSESSIONS: 2,

  // ---------- Pixel palette (particles, UI accents) ----------
  PALETTE: {
    black: "#0b0d14",
    ink: "#141a2e",
    navy: "#1b2547",
    white: "#f6f6f2",
    cream: "#fff3c4",
    yellow: "#ffd23f",
    gold: "#f4a81d",
    orange: "#ff7a1a",
    red: "#e8352a",
    darkred: "#8f1d1d",
    pink: "#ff6fb5",
    purple: "#9b5de5",
    violet: "#5b2a86",
    blue: "#3a86ff",
    cyan: "#4cc9f0",
    teal: "#2ec4b6",
    green: "#5bd15b",
    leaf: "#2f9e44",
    brown: "#8a5a2b",
    tan: "#d9b98a",
    gray: "#8d99ae",
    dgray: "#4a5068",
    turfA: "#2f8f3a",
    turfB: "#2a8034",
    turfDark: "#1c5e26",
    line: "#eef4ea",
    los: "#4aa3ff",
    first: "#ffd23f",
  },
};

// Hit-power thresholds for FX/audio scaling.
export const HIT = { SMALL: 40, BIG: 95, HUGE: 140 };
