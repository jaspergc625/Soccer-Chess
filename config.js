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
  CPU_DIFFICULTY: "PRO",
  CPU_THINK_MS: 280,

  /**
   * Player-facing CPU difficulties. All four use the same legal-action generator
   * and the same game rules. Only search quality, prediction, and mistake rate change.
   *
   * topN / weights: pick among the best-scoring legal actions
   * mistakeChance: sometimes take a legal but lower-ranked option
   * chaseBall: defenders run at the ball (high) vs hold shape (low)
   * coverSpace: value of zones / lanes / own-box cover
   * predictPlayer: weight of "what would a decent opponent do next"
   * lookAhead: 0 = current board, 1 = immediate threats, 2+ = likely replies
   * riskUse: willingness to take curve/air when the extra value is there
   * tackleBias: eagerness to dive in (low = knows when not to tackle)
   * scoreJitter: tiny noise so repeats are not identical
   */
  CPU_PROFILES: {
    ROOKIE: {
      label: "Rookie",
      topN: 7,
      weights: [0.22, 0.18, 0.16, 0.14, 0.12, 0.1, 0.08],
      mistakeChance: 0.32,
      mistakeDepth: 9,
      chaseBall: 1.45,
      coverSpace: 0.4,
      predictPlayer: 0.08,
      lookAhead: 0,
      predictBranches: 1,
      riskUse: 0.55,
      tackleBias: 1.28,
      laneAwareness: 0.4,
      scoreJitter: 14,
      patternMemory: false,
    },
    PRO: {
      label: "Pro",
      topN: 3,
      weights: [0.52, 0.3, 0.18],
      mistakeChance: 0.12,
      mistakeDepth: 5,
      chaseBall: 0.9,
      coverSpace: 1.05,
      predictPlayer: 0.42,
      lookAhead: 1,
      predictBranches: 1,
      riskUse: 1.0,
      tackleBias: 1.0,
      laneAwareness: 1.0,
      scoreJitter: 6,
      patternMemory: false,
    },
    MASTER: {
      label: "Master",
      topN: 2,
      weights: [0.8, 0.2],
      mistakeChance: 0.045,
      mistakeDepth: 3,
      chaseBall: 0.48,
      coverSpace: 1.5,
      predictPlayer: 0.9,
      lookAhead: 2,
      predictBranches: 2,
      riskUse: 1.22,
      tackleBias: 0.72,
      laneAwareness: 1.2,
      scoreJitter: 3,
      patternMemory: false,
    },
    DEV: {
      label: "Dev",
      topN: 1,
      weights: [1],
      mistakeChance: 0.018,
      mistakeDepth: 2,
      chaseBall: 0.28,
      coverSpace: 1.75,
      predictPlayer: 1.0,
      lookAhead: 3,
      predictBranches: 3,
      riskUse: 1.32,
      tackleBias: 0.62,
      laneAwareness: 1.3,
      scoreJitter: 2,
      patternMemory: true,
    },
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

  COIN_STORAGE_KEY: "soccerChess.wallet",
  GOAL_REWARD: 25,
  INTERCEPTION_REWARD: 10,
  SHOT_BLOCK_REWARD: 10,
  WIN_REWARD: 100,
  MATCH_COMPLETE_REWARD: 15,
  LOSS_REWARD: 10,
  PASS_REWARD: 0,
  SPRINT_REWARD: 0,
  MOVE_REWARD: 0,
  TACKLE_REWARD: 0,
  DEFEND_REWARD: 0,
  COIN_TOAST_MS: 1500,
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

CONFIG.AI_FLAVOR = {
  HOVER: {
    ROOKIE: [
      "Your first opponent. Be gentle.",
      "Perfect for making you feel smart.",
      "Still learning the game.",
      "It knows which way the goal is.",
      "It’s trying its best.",
      "A perfect warm-up. Probably.",
      "It has a plan. Probably.",
      "Don’t overthink this one.",
      "It has discovered soccer.",
      "It may accidentally help you.",
      "It knows the rules. Mostly.",
      "A gentle introduction to suffering.",
      "It’s got this. Probably.",
      "It knows the game. Kind of.",
      "It makes mistakes. Lots of them.",
      "It sees the ball. Usually.",
      "It has a strategy. Sort of.",
      "It’s learning. You’re not.",
      "This one shouldn't be too difficult.",
    ],
    PRO: [
      "You’re going to have to earn those goals.",
      "It makes mistakes. Just fewer of them.",
      "Okay, it actually knows what it’s doing.",
      "Free goals are no longer guaranteed.",
      "It has started thinking.",
      "You might actually have to think now.",
      "It’s not falling for everything anymore.",
      "It knows a few tricks.",
      "Your mistakes are starting to matter.",
      "It’s getting suspicious.",
      "You’re going to have to earn this one.",
      "It knows the rules. And how to use them.",
      "It has figured out what passing is.",
      "Welcome to the actual game.",
      "It’s getting harder to fool.",
      "Your usual tricks might not work anymore.",
    ],
    MASTER: [
      "It has a plan for your plan.",
      "It can counter your counter for its counter.",
      "Hope you have a backup plan.",
      "It’s been waiting for you to make that move.",
      "It already knows what you’re trying to do.",
      "You have a plan. It has three.",
      "Your backup plan needs a backup plan.",
      "It was hoping you’d do that.",
      "You’re not the only one thinking.",
      "Every move gives it information.",
      "It’s not chasing the ball anymore.",
      "It’s playing the board, not the ball.",
      "You might want to stop being predictable.",
      "It has been saving that counter.",
      "Congratulations. You’ve become predictable.",
      "Think carefully. It is.",
      "Your first move was already part of its plan.",
      "You’re going to have to outthink it.",
      "Good luck hiding your intentions.",
    ],
    DEV: [
      "You probably shouldn’t play this.",
      "Seriously. Don’t.",
      "This is a terrible idea.",
      "You have been warned.",
      "Why is this even an option?",
      "You asked for this.",
      "There is still time to turn back.",
      "For testing purposes only.",
      "We strongly recommend Rookie.",
      "Are you sure about this?",
      "This one is not here to make friends.",
      "You wanted the hardest AI. Here it is.",
      "This is above your pay grade.",
      "Please reconsider your life choices.",
      "You clicked Dev. That’s on you.",
      "There is still time to choose something easier.",
    ],
  },
  CONFIRM_DEV: [
    "Seriously. Don’t. We accept no liability for any trauma caused by this match.",
    "Are you absolutely sure? We tried to warn you.",
    "You can still go back. Nobody will judge you.",
    "This is your final warning.",
    "We strongly recommend choosing literally anything else.",
    "You clicked Dev. That’s on you.",
    "Please reconsider your life choices.",
  ],
  START: {
    ROOKIE: [
      "Your first opponent. Be gentle.",
      "Good luck. You got this.",
      "Try not to embarrass it.",
      "Remember: this is supposed to be easy.",
      "Let’s see what you’ve learned.",
    ],
    PRO: [
      "Alright. Time to actually play.",
      "Free goals have been disabled.",
      "Hope you brought a strategy.",
      "It’s not going to let you have this one.",
      "Okay, now it gets interesting.",
    ],
    MASTER: [
      "You wanted a challenge. You got one.",
      "Think before you move.",
      "It’s already thinking.",
      "Whatever you do, don’t become predictable.",
      "Good luck hiding your intentions.",
      "You have one plan. It has several.",
    ],
    DEV: [
      "You wanted a challenge. Here it is.",
      "You can still turn back.",
      "You were warned.",
      "Remember: you chose this.",
      "This was entirely your decision.",
      "Good luck. Seriously.",
      "Godspeed.",
    ],
  },
};

/** Older names still resolve if anything reads them. */
CONFIG.CPU_PROFILES.EASY = CONFIG.CPU_PROFILES.ROOKIE;
CONFIG.CPU_PROFILES.MEDIUM = CONFIG.CPU_PROFILES.PRO;
CONFIG.CPU_PROFILES.HARD = CONFIG.CPU_PROFILES.MASTER;

/**
 * Shop catalog. Keep this data-driven so items can be added later without
 * rewriting the shop screen. Leave it empty until real items exist.
 *
 * Expected item shape:
 *   { id, name, category, price, type, asset }
 *
 * Purchased / equipped state lives in the local wallet, not here.
 */
CONFIG.SHOP_ITEMS = [];

/**
 * Future team logos — research only, do not implement yet.
 *
 * A. Creation: prefer small local SVG (or PNG) files in an assets/logos folder.
 *    SVG keeps the current no-build, static-file setup and scales on the HUD.
 *    Do not generate logos at runtime; cache-busting and style control are worse.
 *
 * B. Countries: ship a short curated set (not every FIFA nation). Store
 *    { id: "eng", name: "England", category: "nation", asset: "assets/logos/nations/eng.svg" }.
 *    Simple geometric / simplified crests beat full-detail reproductions.
 *
 * C. Clubs: same catalog pattern, category "club", assets under
 *    assets/logos/clubs/<id>.svg. Unlock via shopItems price + wallet.purchases[id].
 *
 * D. Licensing: official club and many national crests are trademarked.
 *    Do not scrape or bundle real badges without a license. Use original
 *    geometric marks, public-domain historical marks, or licensed packs.
 */

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
