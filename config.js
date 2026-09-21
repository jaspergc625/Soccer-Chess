/**
 * Soccer Chess — prototype knobs.
 *
 * Change these values instead of hunting through game logic.
 * Board geometry, ranges, and resolution rules all read from here.
 */
const CONFIG = {
  BOARD_SIZE: 8,
  NORMAL_MOVE_RANGE: 1,
  MOVE_RANGE: 1,          // alias of NORMAL_MOVE_RANGE (kept for older call sites)
  SPRINT_MOVE_RANGE: 2,   // exactly this many squares in one of 8 directions
  PASS_RANGE: 3,          // Chebyshev distance (king-move distance)
  TACKLE_RANGE: 1,        // must be adjacent at planning AND after movement
  ATTACKER_SHOT_RANGE: 3, // Chebyshev distance to either goal square
  DEFENDER_SHOT_RANGE: 2,
  GOAL_COL_START: 3,      // goal occupies these two columns
  GOAL_COL_END: 4,
  GOALS_TO_WIN: 3,
  BALL_ICON: "⚽",

  CURVE_PASS_CLEAN_CHANCE: 0.70,
  CURVE_PASS_BAD_TOUCH_CHANCE: 0.20,
  CURVE_PASS_OVERCURVE_CHANCE: 0.10,

  AIR_BALL_CLEAN_CHANCE: 0.65,
  AIR_BALL_BAD_TOUCH_CHANCE: 0.25,
  AIR_BALL_MISSED_CHANCE: 0.10,

  CURVE_SHOT_ON_TARGET_CHANCE: 0.70,
  CURVE_SHOT_WIDE_CHANCE: 0.20,
  CURVE_SHOT_WILD_MISS_CHANCE: 0.10,

  /** Set to an outcome id (e.g. "badTouch") to force rolls while testing. Leave null in play. */
  DEBUG_FORCE_RISK: null,

  /**
   * Sprint possession risk by situation (0 = keep ball, 1 = always lose).
   * Values between 0 and 1 can later be treated as probabilities.
   */
  SPRINT_RISK: {
    OPEN: 0,
    NEAR_OPPONENT: 1,
    IN_ZONE: 1,
    INTO_OCCUPIED: 1,
  },

  // Kickoff / reset layout. Row 0 is the top of the screen (Orange's end).
  START_POSITIONS: {
    blue: {
      attacker: { r: 6, c: 3 },
      defenders: [
        { r: 7, c: 2 },
        { r: 7, c: 5 },
      ],
    },
    orange: {
      attacker: { r: 1, c: 4 },
      defenders: [
        { r: 0, c: 2 },
        { r: 0, c: 5 },
      ],
    },
  },

  // Blue attacks toward the top (decreasing row). Orange attacks toward the bottom.
  ATTACK_DIR: {
    blue: { dr: -1, dc: 0 },
    orange: { dr: 1, dc: 0 },
  },

  TEAMS: {
    blue: { id: "blue", name: "Blue", attackLabel: "up" },
    orange: { id: "orange", name: "Orange", attackLabel: "down" },
  },

  FIRST_PLANNING_TEAM: "blue",
  KICKOFF_TEAM: "blue",
  HUMAN_TEAM: "blue",
  CPU_TEAM: "orange",
  CPU_DIFFICULTY: "MEDIUM",
  CPU_THINK_MS: 280,

  /**
   * Later: swap CPU_DIFFICULTY to EASY / HARD.
   * topN + weights pick among high-scoring legal actions (not the whole list).
   */
  CPU_PROFILES: {
    EASY: { topN: 5, weights: [0.34, 0.24, 0.18, 0.14, 0.1] },
    MEDIUM: { topN: 3, weights: [0.5, 0.3, 0.2] },
    HARD: { topN: 2, weights: [0.75, 0.25] },
  },

  REVEAL_MS: 1100,        // time both arrow sets are shown before pieces move
  MOVE_ANIM_MS: 450,
  PASS_ANIM_MS: 560,      // smooth straight pass/shot travel
  CURVE_ANIM_MS: 760,     // curved pass/shot travel
  AIR_ANIM_MS: 820,       // lofted air-ball travel
  BOUNCE_ANIM_MS: 320,    // bad-touch / miss bounce away
  BOUNCE_PAUSE_MS: 160,   // hold on the receiver before a bad-touch bounce
  GOAL_NET_MS: 420,       // ⚽ slides from the goal line into the net
  GOAL_PAUSE_MS: 950,     // hold on the ball in the net before kickoff
};

CONFIG.RISK = {
  CURVE_PASS: [
    { outcome: "clean", chance: CONFIG.CURVE_PASS_CLEAN_CHANCE, label: "Clean Receive" },
    { outcome: "badTouch", chance: CONFIG.CURVE_PASS_BAD_TOUCH_CHANCE, label: "Bad Touch" },
    { outcome: "overcurve", chance: CONFIG.CURVE_PASS_OVERCURVE_CHANCE, label: "Overcurve" },
  ],
  AIR_BALL: [
    { outcome: "clean", chance: CONFIG.AIR_BALL_CLEAN_CHANCE, label: "Clean Control" },
    { outcome: "badTouch", chance: CONFIG.AIR_BALL_BAD_TOUCH_CHANCE, label: "Bad Touch" },
    { outcome: "missed", chance: CONFIG.AIR_BALL_MISSED_CHANCE, label: "Missed Aerial" },
  ],
  CURVE_SHOT: [
    { outcome: "onTarget", chance: CONFIG.CURVE_SHOT_ON_TARGET_CHANCE, label: "On Target" },
    { outcome: "wide", chance: CONFIG.CURVE_SHOT_WIDE_CHANCE, label: "Wide" },
    { outcome: "wild", chance: CONFIG.CURVE_SHOT_WILD_MISS_CHANCE, label: "Wild Miss" },
  ],
};

/**
 * Eight compass directions. DEFEND uses the same set.
 * LEFT = West, RIGHT = East, relative to the screen (not the team).
 */
const DIRECTIONS = {
  N:  { key: "N",  label: "Up",         dr: -1, dc: 0 },
  NE: { key: "NE", label: "Up-Right",   dr: -1, dc: 1 },
  E:  { key: "E",  label: "Right",      dr: 0,  dc: 1 },
  SE: { key: "SE", label: "Down-Right", dr: 1,  dc: 1 },
  S:  { key: "S",  label: "Down",       dr: 1,  dc: 0 },
  SW: { key: "SW", label: "Down-Left",  dr: 1,  dc: -1 },
  W:  { key: "W",  label: "Left",       dr: 0,  dc: -1 },
  NW: { key: "NW", label: "Up-Left",    dr: -1, dc: -1 },
};

const ACTION = {
  MOVE: "MOVE",
  DRIBBLE: "DRIBBLE",
  SPRINT: "SPRINT",
  PASS: "PASS",
  CURVE_PASS: "CURVE_PASS",
  AIR_BALL: "AIR_BALL",
  DEFEND: "DEFEND",
  TACKLE: "TACKLE",
  SHOOT: "SHOOT",
  CURVE_SHOT: "CURVE_SHOT",
};

const CURVE_DIR = {
  LEFT: "LEFT",
  RIGHT: "RIGHT",
};
