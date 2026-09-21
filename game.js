/**
 * Soccer Chess — first playable prototype.
 *
 * Modes: PVP (local handoff) or PVCPU (human Blue vs local CPU Orange).
 * Loop: PLAN (secret) → LOCK IN → other side plans (hidden) → REVEAL → resolve → freeze → next round
 *
 * Important rules live in clearly named functions so they can be swapped later
 * (tackle, pass interception, shooting, defensive zones, movement contests).
 */
(function () {
  "use strict";

  const SIZE = CONFIG.BOARD_SIZE;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function inBounds(r, c) {
    return r >= 0 && c >= 0 && r < SIZE && c < SIZE;
  }

  function chebyshev(a, b) {
    return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
  }

  function cellKey(r, c) {
    return r + "," + c;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function opponentTeam(team) {
    return team === "blue" ? "orange" : "blue";
  }

  function teamName(team) {
    return CONFIG.TEAMS[team].name;
  }

  /** Algebraic-style labels. A1 is bottom-left (Blue's left corner). */
  function squareName(r, c) {
    return String.fromCharCode(65 + c) + String(SIZE - r);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Squares strictly between two cells, walking like a king.
   * Used for pass lanes and shot paths. Easy to replace with a stricter line.
   */
  function cellsBetween(r0, c0, r1, c1) {
    const out = [];
    const seen = new Set();
    const dr = r1 - r0;
    const dc = c1 - c0;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    if (steps === 0) return out;
    for (let i = 1; i < steps; i++) {
      const r = r0 + Math.round((dr * i) / steps);
      const c = c0 + Math.round((dc * i) / steps);
      const k = cellKey(r, c);
      if (k === cellKey(r0, c0) || k === cellKey(r1, c1) || seen.has(k)) continue;
      seen.add(k);
      out.push({ r, c });
    }
    return out;
  }

  /** Inclusive king-walk from start to end, used to fly ⚽ along a pass/shot. */
  function cellsAlong(r0, c0, r1, c1) {
    const out = [{ r: r0, c: c0 }];
    const dr = r1 - r0;
    const dc = c1 - c0;
    const steps = Math.max(Math.abs(dr), Math.abs(dc));
    if (steps === 0) return out;
    for (let i = 1; i <= steps; i++) {
      out.push({
        r: r0 + Math.round((dr * i) / steps),
        c: c0 + Math.round((dc * i) / steps),
      });
    }
    return out;
  }

  function dirFromDelta(dr, dc) {
    dr = Math.sign(dr);
    dc = Math.sign(dc);
    return Object.values(DIRECTIONS).find((d) => d.dr === dr && d.dc === dc) || null;
  }

  function isPassLike(type) {
    return type === ACTION.PASS || type === ACTION.CURVE_PASS || type === ACTION.AIR_BALL;
  }

  function isShotLike(type) {
    return type === ACTION.SHOOT || type === ACTION.CURVE_SHOT;
  }

  function needsCurveDir(type) {
    return type === ACTION.CURVE_PASS || type === ACTION.CURVE_SHOT;
  }

  function actionTitle(type) {
    if (type === ACTION.CURVE_PASS) return "CURVE PASS";
    if (type === ACTION.AIR_BALL) return "AIR BALL";
    if (type === ACTION.CURVE_SHOT) return "CURVE SHOT";
    return type;
  }

  function riskTableFor(type) {
    if (type === ACTION.CURVE_PASS) return CONFIG.RISK.CURVE_PASS;
    if (type === ACTION.AIR_BALL) return CONFIG.RISK.AIR_BALL;
    if (type === ACTION.CURVE_SHOT) return CONFIG.RISK.CURVE_SHOT;
    return null;
  }

  function oddsLabel(table) {
    return (table || [])
      .map(function (row) {
        return Math.round(row.chance * 100) + "/" + row.label.replace(/\s+/g, " ");
      })
      .join(" · ");
  }

  function compactOdds(table) {
    return (table || [])
      .map(function (row) {
        return Math.round(row.chance * 100);
      })
      .join("/");
  }

  function assertRiskTables() {
    Object.keys(CONFIG.RISK || {}).forEach(function (name) {
      const rows = CONFIG.RISK[name];
      const sum = rows.reduce(function (s, row) {
        return s + row.chance;
      }, 0);
      if (Math.abs(sum - 1) > 1e-6) {
        console.error("Risk table " + name + " chances sum to " + sum + ", expected 1.");
      }
    });
  }

  function resolveRiskOutcome(table) {
    const rows = table || [];
    if (!rows.length) return null;
    const forced = CONFIG.DEBUG_FORCE_RISK;
    if (forced && rows.some(function (row) {
      return row.outcome === forced;
    })) {
      return forced;
    }
    let roll = Math.random();
    for (let i = 0; i < rows.length; i++) {
      roll -= rows[i].chance;
      if (roll <= 0) return rows[i].outcome;
    }
    return rows[rows.length - 1].outcome;
  }

  function curvePerp(dr, dc, curveDir) {
    if (curveDir === CURVE_DIR.RIGHT) return { dr: dc, dc: -dr };
    return { dr: -dc, dc: dr };
  }

  function curveControl(start, end, curveDir, extra) {
    const dr = end.r - start.r;
    const dc = end.c - start.c;
    const dist = Math.max(Math.hypot(dr, dc), 1);
    const perp = curvePerp(dr, dc, curveDir || CURVE_DIR.LEFT);
    const plen = Math.hypot(perp.dr, perp.dc) || 1;
    const mag = clamp(dist * (0.42 + (extra || 0)), 0.85, 2.2);
    return {
      r: (start.r + end.r) / 2 + (perp.dr / plen) * mag,
      c: (start.c + end.c) / 2 + (perp.dc / plen) * mag,
    };
  }

  function bezierPoint(p0, p1, p2, t) {
    const u = 1 - t;
    return {
      r: u * u * p0.r + 2 * u * t * p1.r + t * t * p2.r,
      c: u * u * p0.c + 2 * u * t * p1.c + t * t * p2.c,
    };
  }

  function sampleCurve(start, end, curveDir, steps, extraBend) {
    const ctrl = curveControl(start, end, curveDir, extraBend);
    const n = steps || 8;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const p = bezierPoint(start, ctrl, end, i / n);
      p.curve = true;
      out.push(p);
    }
    return out;
  }

  function sampleAirArc(start, end, steps) {
    const n = steps || 8;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push({
        r: start.r + (end.r - start.r) * t,
        c: start.c + (end.c - start.c) * t,
        lift: Math.sin(t * Math.PI) * 1.2,
        curve: true,
      });
    }
    return out;
  }

  function uniqueIntCells(points) {
    const out = [];
    const seen = new Set();
    (points || []).forEach(function (p) {
      const r = Math.round(p.r);
      const c = Math.round(p.c);
      if (!inBounds(r, c)) return;
      const k = cellKey(r, c);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ r: r, c: c });
    });
    return out;
  }

  /** Animation segment. Gameplay still uses grid cells; this is visual-only. */
  function flightSeg(kind, from, to, extra) {
    const seg = {
      kind: kind,
      from: { r: from.r, c: from.c },
      to: { r: to.r, c: to.c },
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        seg[key] = extra[key];
      });
    }
    return seg;
  }

  function deflectSquare(from, prefer, opts) {
    opts = opts || {};
    const forbidden = new Set();
    forbidden.add(cellKey(from.r, from.c));
    (opts.forbid || []).forEach(function (p) {
      forbidden.add(cellKey(p.r, p.c));
    });
    if (opts.avoidGoalTeam) {
      goalSquares(opts.avoidGoalTeam).forEach(function (g) {
        forbidden.add(cellKey(g.r, g.c));
      });
    }
    const pdr = prefer ? prefer.dr : 0;
    const pdc = prefer ? prefer.dc : 0;
    const range = opts.range || 1;
    const pool = [];
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = from.r + dr;
        const c = from.c + dc;
        if (!inBounds(r, c)) continue;
        if (forbidden.has(cellKey(r, c))) continue;
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        if (opts.minRange && dist < opts.minRange) continue;
        pool.push({
          r: r,
          c: c,
          dist: dist,
          score: pdr * dr + pdc * dc,
        });
      }
    }
    if (!pool.length) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (forbidden.has(cellKey(r, c))) continue;
          if (r === from.r && c === from.c) continue;
          if (chebyshev(from, { r: r, c: c }) > 2) continue;
          pool.push({ r: r, c: c, dist: chebyshev(from, { r: r, c: c }), score: 0 });
        }
      }
    }
    pool.sort(function (a, b) {
      return b.score - a.score || a.dist - b.dist;
    });
    const top = pool.slice(0, Math.min(3, pool.length));
    return top[Math.floor(Math.random() * top.length)] || null;
  }

  function preferVector(start, intended, curveDir, mode) {
    const inDr = Math.sign(intended.r - start.r);
    const inDc = Math.sign(intended.c - start.c);
    const perp = curvePerp(inDr, inDc, curveDir || CURVE_DIR.LEFT);
    if (mode === "badTouch") return { dr: -inDr + perp.dr, dc: -inDc + perp.dc };
    if (mode === "wild") return { dr: inDr + perp.dr * 2, dc: inDc + perp.dc * 2 };
    return { dr: inDr + perp.dr, dc: inDc + perp.dc };
  }

  function settleLooseOrOccupy(ball, units, dest) {
    ball.r = dest.r;
    ball.c = dest.c;
    const here = occupantsAt(units, dest.r, dest.c);
    if (here.length === 1) {
      ball.holderId = here[0].id;
      return here[0];
    }
    ball.holderId = null;
    return null;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const els = {};
  let state;
  let drag = null;
  let timers = [];
  let rafIds = [];

  function later(fn, ms) {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function nowRaf(fn) {
    const id = requestAnimationFrame(function (t) {
      rafIds = rafIds.filter(function (x) {
        return x !== id;
      });
      fn(t);
    });
    rafIds.push(id);
    return id;
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    rafIds.forEach(function (id) {
      cancelAnimationFrame(id);
    });
    rafIds = [];
  }

  function createUnits() {
    const units = [];
    for (const team of ["blue", "orange"]) {
      const start = CONFIG.START_POSITIONS[team];
      units.push({
        id: team + "-att",
        team,
        role: "attacker",
        label: "ATT",
        r: start.attacker.r,
        c: start.attacker.c,
      });
      start.defenders.forEach((pos, i) => {
        units.push({
          id: team + "-def-" + i,
          team,
          role: "defender",
          label: "D" + (i + 1),
          r: pos.r,
          c: pos.c,
        });
      });
    }
    return units;
  }

  function ballWithTeam(units, team) {
    const att = units.find((u) => u.team === team && u.role === "attacker");
    return { r: att.r, c: att.c, holderId: att.id };
  }

  function blankPlans() {
    return { blue: {}, orange: {} };
  }

  function freshMatch(mode) {
    const units = createUnits();
    const gameMode = mode || "PVP";
    return {
      gameMode,
      cpuTeam: CONFIG.CPU_TEAM || "orange",
      cpuDifficulty: CONFIG.CPU_DIFFICULTY || "MEDIUM",
      fxBall: null, // visualBallPosition {left, top} while the ⚽ is in flight; logical ball stays on the grid
      phase: "handoff", // menu | handoff | planning | cpu | reveal | frozen | goal | gameover
      planningTeam: CONFIG.FIRST_PLANNING_TEAM,
      locked: { blue: false, orange: false },
      plans: blankPlans(),
      units,
      ball: ballWithTeam(units, CONFIG.KICKOFF_TEAM),
      score: { blue: 0, orange: 0 },
      selectedId: null,
      selectedAction: ACTION.MOVE,
      events: ["First to " + CONFIG.GOALS_TO_WIN + " goals wins. Blue starts with the ball."],
      eventKinds: ["info"],
      revealPlans: null,
      revealFrom: null,
      contestCells: [],
      zoneCells: [],
      winner: null,
      pendingKickoff: null,
      previewDest: null,
      pendingCurveDir: CURVE_DIR.LEFT,
    };
  }

  function isCpuTeam(team) {
    return state && state.gameMode === "PVCPU" && team === (state.cpuTeam || CONFIG.CPU_TEAM);
  }

  function humanTeam() {
    return CONFIG.HUMAN_TEAM || "blue";
  }

  function getUnit(id, units) {
    return (units || state.units).find((u) => u.id === id);
  }

  function teamUnits(team, units) {
    return (units || state.units).filter((u) => u.team === team);
  }

  function selectedUnit() {
    return state.selectedId ? getUnit(state.selectedId) : null;
  }

  function hasBall(unit) {
    return unit && state.ball.holderId === unit.id;
  }

  function unitTitle(unit) {
    const role = unit.role === "attacker" ? "Attacker" : "Defender " + unit.label.slice(1);
    return teamName(unit.team) + " " + role;
  }

  function currentPlans() {
    return state.plans[state.planningTeam];
  }

  function plannedDest(unit, plans) {
    const plan = plans[unit.id];
    if (plan && plan.dest) return plan.dest;
    return { r: unit.r, c: unit.c };
  }

  // ---------------------------------------------------------------------------
  // Rules: legal options
  // ---------------------------------------------------------------------------

  function teammateDestSet(unit, plans) {
    const blocked = new Set();
    for (const mate of teamUnits(unit.team)) {
      if (mate.id === unit.id) continue;
      const d = plannedDest(mate, plans);
      blocked.add(cellKey(d.r, d.c));
    }
    return blocked;
  }

  function legalMoveDests(unit, plans) {
    const range = CONFIG.NORMAL_MOVE_RANGE || CONFIG.MOVE_RANGE;
    const blocked = teammateDestSet(unit, plans);
    const dests = [];
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        const r = unit.r + dr;
        const c = unit.c + dc;
        if (!inBounds(r, c)) continue;
        if (blocked.has(cellKey(r, c))) continue;
        dests.push({ r, c });
      }
    }
    return dests;
  }

  function legalSprintDests(unit, plans) {
    const range = CONFIG.SPRINT_MOVE_RANGE;
    const blocked = teammateDestSet(unit, plans);
    const dests = [];
    Object.values(DIRECTIONS).forEach(function (dir) {
      const r = unit.r + dir.dr * range;
      const c = unit.c + dir.dc * range;
      if (!inBounds(r, c)) return;
      if (blocked.has(cellKey(r, c))) return;
      dests.push({ r, c });
    });
    return dests;
  }

  function isLegalDest(unit, r, c, plans) {
    return legalMoveDests(unit, plans).some((d) => d.r === r && d.c === c);
  }

  function isLegalSprint(unit, r, c, plans) {
    return legalSprintDests(unit, plans).some((d) => d.r === r && d.c === c);
  }

  /**
   * Directional defensive zone.
   * Cardinal example (LEFT / West): the square to the left, plus both diagonal-left squares.
   * Diagonal example (NE): the NE square plus the N and E squares.
   */
  function defensiveZone(unit, dirKey) {
    const dir = DIRECTIONS[dirKey];
    if (!dir) return [];
    const cells = [];
    function add(r, c) {
      if (inBounds(r, c)) cells.push({ r, c });
    }
    add(unit.r + dir.dr, unit.c + dir.dc);
    if (dir.dr === 0 && dir.dc !== 0) {
      add(unit.r - 1, unit.c + dir.dc);
      add(unit.r + 1, unit.c + dir.dc);
    } else if (dir.dc === 0 && dir.dr !== 0) {
      add(unit.r + dir.dr, unit.c - 1);
      add(unit.r + dir.dr, unit.c + 1);
    } else {
      add(unit.r + dir.dr, unit.c);
      add(unit.r, unit.c + dir.dc);
    }
    const seen = new Set();
    return cells.filter((cell) => {
      const k = cellKey(cell.r, cell.c);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function goalSquares(team) {
    const r = team === "blue" ? 0 : SIZE - 1;
    return [
      { r, c: CONFIG.GOAL_COL_START },
      { r, c: CONFIG.GOAL_COL_END },
    ];
  }

  function shotRangeFor(unit) {
    return unit.role === "attacker" ? CONFIG.ATTACKER_SHOT_RANGE : CONFIG.DEFENDER_SHOT_RANGE;
  }

  function reachableGoalSquares(unit) {
    const range = shotRangeFor(unit);
    return goalSquares(unit.team).filter(function (g) {
      return chebyshev(unit, g) <= range;
    });
  }

  function inShootRange(unit) {
    return reachableGoalSquares(unit).length > 0;
  }

  function shotTargetSquare(unit, plan) {
    if (plan && plan.shotTarget) return plan.shotTarget;
    const options = reachableGoalSquares(unit);
    if (options.length) return options[0];
    const goals = goalSquares(unit.team);
    return goals[0];
  }

  function passSquares(unit) {
    const out = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const d = chebyshev(unit, { r, c });
        if (d >= 1 && d <= CONFIG.PASS_RANGE) out.push({ r, c });
      }
    }
    return out;
  }

  function isLegalPassSquare(unit, r, c) {
    const d = chebyshev(unit, { r, c });
    return d >= 1 && d <= CONFIG.PASS_RANGE && inBounds(r, c);
  }

  function passTargets(unit) {
    return teamUnits(unit.team).filter(
      (mate) => mate.id !== unit.id && chebyshev(unit, mate) <= CONFIG.PASS_RANGE
    );
  }

  function tackleTargets(unit) {
    if (unit.role !== "defender" || !state.ball.holderId) return [];
    const holder = getUnit(state.ball.holderId);
    if (!holder || holder.team === unit.team) return [];
    if (chebyshev(unit, holder) > CONFIG.TACKLE_RANGE) return [];
    return [holder];
  }

  function availableActions(unit) {
    const list = [ACTION.MOVE, ACTION.SPRINT];
    if (hasBall(unit)) {
      list.push(ACTION.DRIBBLE);
      list.push(ACTION.PASS);
      list.push(ACTION.CURVE_PASS);
      list.push(ACTION.AIR_BALL);
      list.push(ACTION.SHOOT);
      list.push(ACTION.CURVE_SHOT);
    }
    if (unit.role === "defender") {
      list.push(ACTION.DEFEND);
      list.push(ACTION.TACKLE);
    }
    return list;
  }

  function actionEnabled(unit, type) {
    if (!availableActions(unit).includes(type)) return false;
    if (isPassLike(type)) return hasBall(unit);
    if (type === ACTION.TACKLE) return tackleTargets(unit).length > 0;
    if (isShotLike(type)) return hasBall(unit) && inShootRange(unit);
    if (type === ACTION.DRIBBLE) return hasBall(unit);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Planning
  // ---------------------------------------------------------------------------

  function ensureStayPlans(team) {
    const plans = state.plans[team];
    for (const unit of teamUnits(team)) {
      if (!plans[unit.id]) {
        plans[unit.id] = {
          type: ACTION.MOVE,
          dest: { r: unit.r, c: unit.c },
          implicitStay: true,
        };
      }
    }
  }

  function revalidateTeamPlans(team) {
    const plans = state.plans[team];
    const units = teamUnits(team);
    let changed = true;
    while (changed) {
      changed = false;
      const destMap = {};
      for (const unit of units) {
        const d = plannedDest(unit, plans);
        const k = cellKey(d.r, d.c);
        destMap[k] = destMap[k] || [];
        destMap[k].push(unit.id);
      }
      for (const ids of Object.values(destMap)) {
        if (ids.length < 2) continue;
        const stayer = ids.find((id) => {
          const u = getUnit(id);
          const d = plannedDest(u, plans);
          return u.r === d.r && u.c === d.c;
        });
        const keep = stayer || ids[0];
        for (const id of ids) {
          if (id !== keep && plans[id]) {
            delete plans[id];
            changed = true;
          }
        }
      }
    }
  }

  function setPlan(unit, plan) {
    state.plans[unit.team][unit.id] = plan;
    revalidateTeamPlans(unit.team);
  }

  function clearPlan(unit) {
    delete state.plans[unit.team][unit.id];
  }

  function planLabel(unit, plan) {
    if (!plan || plan.implicitStay) return unitTitle(unit) + ": stay";
    switch (plan.type) {
      case ACTION.MOVE: {
        const same = plan.dest.r === unit.r && plan.dest.c === unit.c;
        return same
          ? unitTitle(unit) + ": stay"
          : unitTitle(unit) + ": move to " + squareName(plan.dest.r, plan.dest.c);
      }
      case ACTION.DRIBBLE:
        return unitTitle(unit) + ": dribble to " + squareName(plan.dest.r, plan.dest.c);
      case ACTION.SPRINT:
        return unitTitle(unit) + ": sprint to " + squareName(plan.dest.r, plan.dest.c);
      case ACTION.PASS:
      case ACTION.CURVE_PASS:
      case ACTION.AIR_BALL: {
        const kind =
          plan.type === ACTION.CURVE_PASS
            ? "curve pass " + (plan.curveDir === CURVE_DIR.RIGHT ? "right" : "left")
            : plan.type === ACTION.AIR_BALL
              ? "air ball"
              : "pass";
        const odds = riskTableFor(plan.type) ? " (" + compactOdds(riskTableFor(plan.type)) + ")" : "";
        if (plan.passTo) {
          const receiver = plan.targetId ? getUnit(plan.targetId) : null;
          if (receiver) {
            return unitTitle(unit) + ": " + kind + " to " + unitTitle(receiver) + " at " + squareName(plan.passTo.r, plan.passTo.c) + odds;
          }
          return unitTitle(unit) + ": " + kind + " into " + squareName(plan.passTo.r, plan.passTo.c) + odds;
        }
        const target = getUnit(plan.targetId);
        return unitTitle(unit) + ": " + kind + " to " + (target ? unitTitle(target) : "space") + odds;
      }
      case ACTION.DEFEND:
        return unitTitle(unit) + ": defend " + (DIRECTIONS[plan.dir] ? DIRECTIONS[plan.dir].label : plan.dir);
      case ACTION.TACKLE: {
        const target = getUnit(plan.targetId);
        return unitTitle(unit) + ": tackle " + (target ? unitTitle(target) : "ball carrier");
      }
      case ACTION.SHOOT:
      case ACTION.CURVE_SHOT: {
        const odds = plan.type === ACTION.CURVE_SHOT ? " (" + compactOdds(riskTableFor(plan.type)) + ")" : "";
        const kind =
          plan.type === ACTION.CURVE_SHOT
            ? "curve shot " + (plan.curveDir === CURVE_DIR.RIGHT ? "right" : "left")
            : "shoot";
        if (plan.shotTarget) {
          return unitTitle(unit) + ": " + kind + " at " + squareName(plan.shotTarget.r, plan.shotTarget.c) + odds;
        }
        return unitTitle(unit) + ": " + kind + odds;
      }
      default:
        return unitTitle(unit) + ": " + plan.type;
    }
  }

  // ---------------------------------------------------------------------------
  // CPU (local, same rules as a human — never reads the opponent's hidden plan)
  // Difficulty later: set CONFIG.CPU_DIFFICULTY to EASY / MEDIUM / HARD
  // ---------------------------------------------------------------------------

  let cpuContext = { primaryId: null };

  function cpuProfile() {
    const key = (state && state.cpuDifficulty) || CONFIG.CPU_DIFFICULTY || "MEDIUM";
    return CONFIG.CPU_PROFILES[key] || CONFIG.CPU_PROFILES.MEDIUM;
  }

  function ballPosition() {
    if (state.ball.holderId) {
      const holder = getUnit(state.ball.holderId);
      if (holder) return { r: holder.r, c: holder.c };
    }
    return { r: state.ball.r, c: state.ball.c };
  }

  function distToOppGoal(pos, team) {
    let best = 99;
    goalSquares(team).forEach(function (g) {
      const d = chebyshev(pos, g);
      if (d < best) best = d;
    });
    return best;
  }

  function distToOwnGoal(pos, team) {
    return distToOppGoal(pos, opponentTeam(team));
  }

  function oppCountNear(pos, team, range) {
    return state.units.filter(function (u) {
      return u.team !== team && chebyshev(pos, u) <= range;
    }).length;
  }

  function pathLooksBlocked(from, to, team) {
    return cellsBetween(from.r, from.c, to.r, to.c).some(function (cell) {
      return state.units.some(function (u) {
        return u.team !== team && u.r === cell.r && u.c === cell.c;
      });
    });
  }

  function pickPrimaryChaser(team) {
    const ballPos = ballPosition();
    const units = teamUnits(team).slice().sort(function (a, b) {
      return chebyshev(a, ballPos) - chebyshev(b, ballPos);
    });
    const holder = state.ball.holderId ? getUnit(state.ball.holderId) : null;
    const theyHave = holder && holder.team !== team;
    if (theyHave) {
      const defs = units.filter(function (u) {
        return u.role === "defender";
      });
      if (defs[0] && chebyshev(defs[0], ballPos) <= chebyshev(units[0], ballPos) + 1) {
        return defs[0].id;
      }
    }
    return units[0].id;
  }

  function cpuPlanOrder(team) {
    const holder = state.ball.holderId ? getUnit(state.ball.holderId) : null;
    const ballPos = ballPosition();
    return teamUnits(team).slice().sort(function (a, b) {
      const ah = holder && a.id === holder.id ? 0 : 1;
      const bh = holder && b.id === holder.id ? 0 : 1;
      if (ah !== bh) return ah - bh;
      const ar = a.role === "attacker" ? 0 : 1;
      const br = b.role === "attacker" ? 0 : 1;
      if (ar !== br) return ar - br;
      return chebyshev(a, ballPos) - chebyshev(b, ballPos);
    });
  }

  function generateCpuActions(unit) {
    const plans = state.plans[unit.team];
    const actions = [];
    legalMoveDests(unit, plans).forEach(function (dest) {
      const stay = dest.r === unit.r && dest.c === unit.c;
      actions.push({ type: ACTION.MOVE, dest: { r: dest.r, c: dest.c } });
      if (!stay && actionEnabled(unit, ACTION.DRIBBLE)) {
        actions.push({ type: ACTION.DRIBBLE, dest: { r: dest.r, c: dest.c } });
      }
    });
    if (actionEnabled(unit, ACTION.SPRINT)) {
      legalSprintDests(unit, plans).forEach(function (dest) {
        actions.push({ type: ACTION.SPRINT, dest: { r: dest.r, c: dest.c } });
      });
    }
    if (actionEnabled(unit, ACTION.PASS)) {
      passSquares(unit).forEach(function (sq) {
        const occupant = state.units.find(function (u) {
          return u.r === sq.r && u.c === sq.c && u.id !== unit.id;
        });
        actions.push({
          type: ACTION.PASS,
          dest: { r: unit.r, c: unit.c },
          passTo: { r: sq.r, c: sq.c },
          targetId: occupant ? occupant.id : null,
        });
      });
    }
    if (actionEnabled(unit, ACTION.CURVE_PASS) || actionEnabled(unit, ACTION.AIR_BALL)) {
      passTargets(unit).forEach(function (mate) {
        if (actionEnabled(unit, ACTION.CURVE_PASS)) {
          [CURVE_DIR.LEFT, CURVE_DIR.RIGHT].forEach(function (dir) {
            actions.push({
              type: ACTION.CURVE_PASS,
              dest: { r: unit.r, c: unit.c },
              passTo: { r: mate.r, c: mate.c },
              targetId: mate.id,
              curveDir: dir,
            });
          });
        }
        if (actionEnabled(unit, ACTION.AIR_BALL)) {
          actions.push({
            type: ACTION.AIR_BALL,
            dest: { r: unit.r, c: unit.c },
            passTo: { r: mate.r, c: mate.c },
            targetId: mate.id,
          });
        }
      });
    }
    if (actionEnabled(unit, ACTION.SHOOT)) {
      reachableGoalSquares(unit).forEach(function (g) {
        actions.push({
          type: ACTION.SHOOT,
          dest: { r: unit.r, c: unit.c },
          shotTarget: { r: g.r, c: g.c },
        });
      });
    }
    if (actionEnabled(unit, ACTION.CURVE_SHOT)) {
      reachableGoalSquares(unit).forEach(function (g) {
        [CURVE_DIR.LEFT, CURVE_DIR.RIGHT].forEach(function (dir) {
          actions.push({
            type: ACTION.CURVE_SHOT,
            dest: { r: unit.r, c: unit.c },
            shotTarget: { r: g.r, c: g.c },
            curveDir: dir,
          });
        });
      });
    }
    if (actionEnabled(unit, ACTION.DEFEND)) {
      Object.keys(DIRECTIONS).forEach(function (key) {
        actions.push({
          type: ACTION.DEFEND,
          dir: key,
          dest: { r: unit.r, c: unit.c },
        });
      });
    }
    if (actionEnabled(unit, ACTION.TACKLE)) {
      tackleTargets(unit).forEach(function (t) {
        actions.push({
          type: ACTION.TACKLE,
          targetId: t.id,
          dest: { r: unit.r, c: unit.c },
        });
      });
    }
    return actions;
  }

  function scoreCpuAction(unit, action) {
    const team = unit.team;
    const holder = state.ball.holderId ? getUnit(state.ball.holderId) : null;
    const weHave = !!(holder && holder.team === team);
    const theyHave = !!(holder && holder.team !== team);
    const free = !holder;
    const ballPos = ballPosition();
    const dest = action.dest || { r: unit.r, c: unit.c };
    const role = unit.role;
    const chaser = cpuContext.primaryId;
    let s = 0;

    if (action.type === ACTION.MOVE && dest.r === unit.r && dest.c === unit.c) {
      s -= 8;
      if (weHave && holder.id === unit.id) s -= 12;
    }

    if (isShotLike(action.type)) {
      s += 110;
      const target = action.shotTarget;
      if (target && pathLooksBlocked(unit, target, team)) s -= 55;
      else s += 25;
      if (role === "attacker") s += 8;
      if (oppCountNear(unit, team, 1) > 0) s += 12;
      if (action.type === ACTION.CURVE_SHOT) {
        if (target && pathLooksBlocked(unit, target, team)) s += 40;
        s = Math.round(s * 0.72);
      }
      return s;
    }

    if (action.type === ACTION.TACKLE) {
      s += 88;
      if (role === "defender") s += 8;
      return s;
    }

    if (isPassLike(action.type)) {
      const to = action.passTo;
      const occ = state.units.find(function (u) {
        return u.r === to.r && u.c === to.c && u.id !== unit.id;
      });
      const dangerHere = oppCountNear(unit, team, 1);
      if (occ && occ.team === team) {
        s += 28;
        s += (distToOppGoal(unit, team) - distToOppGoal(occ, team)) * 10;
        const ghost = { r: occ.r, c: occ.c, team: occ.team, role: occ.role };
        if (inShootRange(ghost)) s += 22;
        if (dangerHere) s += 24;
        if (oppCountNear(occ, team, 1) >= 2) s -= 20;
        if (pathLooksBlocked(unit, occ, team)) s -= 16;
      } else if (occ && occ.team !== team) {
        s -= 42;
        if (dangerHere >= 2) s += 12;
      } else {
        s += 8;
        s += (distToOppGoal(unit, team) - distToOppGoal(to, team)) * 8;
        if (oppCountNear(to, team, 1)) s -= 18;
        if (dangerHere) s += 12;
        if (distToOppGoal(to, team) <= 3) s += 16;
        if (pathLooksBlocked(unit, to, team)) s -= 10;
      }
      if (action.type === ACTION.CURVE_PASS) {
        if (to && pathLooksBlocked(unit, to, team)) s += 30;
        else s -= 6;
        s = Math.round(s * 0.78);
      } else if (action.type === ACTION.AIR_BALL) {
        if (to && pathLooksBlocked(unit, to, team)) s += 26;
        else s -= 5;
        s = Math.round(s * 0.74);
      }
      return s;
    }

    if (action.type === ACTION.DEFEND) {
      const zone = defensiveZone(unit, action.dir);
      if (theyHave && zone.some(function (z) {
        return z.r === holder.r && z.c === holder.c;
      })) {
        s += 42;
      }
      if (free && zone.some(function (z) {
        return z.r === ballPos.r && z.c === ballPos.c;
      })) {
        s += 30;
      }
      if (theyHave) {
        const lane = cellsBetween(holder.r, holder.c, goalSquares(holder.team)[0].r, goalSquares(holder.team)[0].c);
        if (zone.some(function (z) {
          return lane.some(function (p) {
            return p.r === z.r && p.c === z.c;
          });
        })) {
          s += 14;
        }
      }
      s += Math.max(0, 3 - distToOwnGoal(unit, team)) * 4;
      if (role === "attacker") s -= 16;
      return s;
    }

    s += (distToOppGoal(unit, team) - distToOppGoal(dest, team)) * (weHave && holder.id === unit.id ? 14 : 4);

    if (weHave && holder.id === unit.id) {
      s += 6;
      const dangerNow = oppCountNear(unit, team, 1);
      const dangerThen = oppCountNear(dest, team, 1);
      if (dangerThen < dangerNow) s += 18;
      if (dangerThen > dangerNow) s -= 16;
      if (action.type === ACTION.SPRINT) {
        if (dangerThen === 0 && dangerNow === 0) s += 16;
        else s -= 28;
      }
      if (action.type === ACTION.DRIBBLE) s += 4;
      if (distToOppGoal(dest, team) <= shotRangeFor(unit)) s += 20;
    } else if (free) {
      const closer = chebyshev(unit, ballPos) - chebyshev(dest, ballPos);
      if (unit.id === chaser) {
        s += closer * 16 + 8;
        if (action.type === ACTION.SPRINT && closer > 0) s += 12;
      } else {
        s += closer * 2 - 12;
        if (role === "attacker") s += (distToOppGoal(unit, team) - distToOppGoal(dest, team)) * 6;
        if (role === "defender") s += (distToOwnGoal(unit, team) - distToOwnGoal(dest, team)) * 6;
      }
    } else if (theyHave) {
      const closer = chebyshev(unit, ballPos) - chebyshev(dest, ballPos);
      if (unit.id === chaser) {
        s += closer * 14 + 6;
        if (chebyshev(dest, holder) <= 1) s += 18;
        if (action.type === ACTION.SPRINT && closer > 0) s += 10;
      } else if (role === "defender") {
        s += (distToOwnGoal(unit, team) - distToOwnGoal(dest, team)) * 10;
        s += closer * 4;
        if (distToOwnGoal(dest, team) <= 2) s += 10;
      } else {
        s += (distToOppGoal(unit, team) - distToOppGoal(dest, team)) * 9;
        s += closer * 3;
        if (oppCountNear(dest, team, 1) === 0) s += 8;
      }
      if (action.type === ACTION.SPRINT && unit.id !== chaser) s -= 8;
    }

    if (role === "defender") {
      const mates = teamUnits(team).filter(function (u) {
        return u.id !== unit.id && u.role === "defender";
      });
      const otherCover = mates.length
        ? Math.min.apply(
            null,
            mates.map(function (m) {
              return distToOwnGoal(m, team);
            })
          )
        : 99;
      if (distToOwnGoal(dest, team) > 4 && otherCover > 3 && theyHave) s -= 18;
    }

    if (role === "attacker" && distToOwnGoal(dest, team) <= 1 && !theyHave) s -= 10;
    return s;
  }

  function pickScoredAction(scored) {
    scored.sort(function (a, b) {
      return b.score - a.score;
    });
    const profile = cpuProfile();
    const best = scored[0].score;
    const pool = scored.slice(0, profile.topN).filter(function (item, i) {
      return i === 0 || item.score >= best - 45;
    });
    const weights = (profile.weights || [1]).slice(0, pool.length);
    let sum = 0;
    weights.forEach(function (w) {
      sum += w;
    });
    let roll = Math.random() * sum;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i].action;
    }
    return pool[0].action;
  }

  function generateCpuPlans(team) {
    state.plans[team] = {};
    cpuContext.primaryId = pickPrimaryChaser(team);
    cpuPlanOrder(team).forEach(function (unit) {
      const candidates = generateCpuActions(unit);
      if (!candidates.length) return;
      const scored = candidates.map(function (action) {
        return { action: action, score: scoreCpuAction(unit, action) };
      });
      setPlan(unit, pickScoredAction(scored));
    });
    ensureStayPlans(team);
  }

  function applyCpuPlans() {
    const team = state.cpuTeam || CONFIG.CPU_TEAM;
    generateCpuPlans(team);
    state.locked[team] = true;
  }

  // ---------------------------------------------------------------------------
  // Resolution
  //
  // Order (swap the blocks below to try different mind-game timings):
  //   1. Simultaneous movement + contests
  //   2. Passes
  //   3. Shots
  //   4. Tackles
  //   5. Dribble steals from nearby defending players / zones
  // ---------------------------------------------------------------------------

  function resolveMovement(units, plans, events, contestCells) {
    const intended = {};
    for (const unit of units) {
      intended[unit.id] = plannedDest(unit, plans);
    }

    const destMap = {};
    for (const unit of units) {
      const d = intended[unit.id];
      const k = cellKey(d.r, d.c);
      destMap[k] = destMap[k] || [];
      destMap[k].push(unit.id);
    }

    const finalPos = {};
    for (const unit of units) {
      finalPos[unit.id] = intended[unit.id];
    }

    Object.keys(destMap).forEach(function (k) {
      const claimants = destMap[k];
      if (claimants.length < 2) return;
      const parts = k.split(",");
      const r = Number(parts[0]);
      const c = Number(parts[1]);
      contestCells.push({ r, c });
      const names = claimants.map(function (id) {
        return unitTitle(getUnit(id, units));
      }).join(" and ");
      events.push({
        type: "contest",
        text: names + " share " + squareName(r, c) + ".",
      });
    });

    return finalPos;
  }

  function occupantAt(units, r, c, exceptId) {
    return units.find((u) => u.r === r && u.c === c && u.id !== exceptId);
  }

  function occupantsAt(units, r, c, exceptId) {
    return units.filter((u) => u.r === r && u.c === c && u.id !== exceptId);
  }

  function sprintRiskLevel(holder, units, zones) {
    const others = occupantsAt(units, holder.r, holder.c, holder.id);
    const opponentHere = others.find((u) => u.team !== holder.team);
    if (opponentHere) {
      return { level: "INTO_OCCUPIED", thief: opponentHere };
    }
    const zone = zones.find(function (z) {
      return (
        z.team !== holder.team &&
        z.cells.some((cell) => cell.r === holder.r && cell.c === holder.c)
      );
    });
    if (zone) {
      return { level: "IN_ZONE", thief: getUnit(zone.unitId, units) };
    }
    const near = units.find(function (u) {
      return u.team !== holder.team && chebyshev(u, holder) <= 1;
    });
    if (near) {
      return { level: "NEAR_OPPONENT", thief: near };
    }
    return { level: "OPEN", thief: null };
  }

  function sprintLosesBall(level) {
    const chance = (CONFIG.SPRINT_RISK && CONFIG.SPRINT_RISK[level]) || 0;
    if (chance <= 0) return false;
    if (chance >= 1) return true;
    return Math.random() < chance;
  }

  function resolveRound(liveUnits, liveBall, teamPlans) {
    const units = liveUnits.map((u) => Object.assign({}, u));
    const ball = Object.assign({}, liveBall);
    const plans = Object.assign({}, teamPlans.blue, teamPlans.orange);
    const events = [];
    const contestCells = [];

    const finalPos = resolveMovement(units, plans, events, contestCells);
    for (const unit of units) {
      const pos = finalPos[unit.id];
      unit.r = pos.r;
      unit.c = pos.c;
    }

    if (ball.holderId) {
      const holder = getUnit(ball.holderId, units);
      ball.r = holder.r;
      ball.c = holder.c;
    }

    const zones = [];
    for (const unit of units) {
      const plan = plans[unit.id];
      if (plan && plan.type === ACTION.DEFEND && plan.dir) {
        zones.push({
          unitId: unit.id,
          team: unit.team,
          cells: defensiveZone(unit, plan.dir),
        });
      }
    }

    function zoneDefender(r, c, againstTeam) {
      return zones.find(
        (z) =>
          z.team !== againstTeam &&
          z.cells.some((cell) => cell.r === r && cell.c === c)
      );
    }

    const ballFlight = [];

    // --- Sprint possession risk (situation-based, not a roll every sprint) ---
    if (ball.holderId) {
      const holder = getUnit(ball.holderId, units);
      const holdPlan = holder ? plans[holder.id] : null;
      if (holder && holdPlan && holdPlan.type === ACTION.SPRINT) {
        const risk = sprintRiskLevel(holder, units, zones);
        if (sprintLosesBall(risk.level)) {
          if (risk.thief) {
            ball.holderId = risk.thief.id;
            ball.r = risk.thief.r;
            ball.c = risk.thief.c;
            events.push({
              type: "steal",
              text: unitTitle(risk.thief) + " stripped the ball off the sprint (" + risk.level.replace(/_/g, " ").toLowerCase() + ").",
            });
          } else {
            ball.holderId = null;
            events.push({
              type: "steal",
              text: unitTitle(holder) + " lost the ball while sprinting.",
            });
          }
        }
      }
    }

    // --- Passes (normal, curve, air) ---
    for (const unit of units) {
      const plan = plans[unit.id];
      if (!plan || !isPassLike(plan.type)) continue;
      if (ball.holderId !== unit.id) {
        events.push({ type: "info", text: unitTitle(unit) + "'s pass never left their feet." });
        continue;
      }
      const dest = plan.passTo || null;
      if (!dest || !inBounds(dest.r, dest.c)) continue;

      const start = { r: unit.r, c: unit.c };
      const curveDir = plan.curveDir || CURVE_DIR.LEFT;

      function interceptOnCells(cells) {
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          if (cell.r === start.r && cell.c === start.c) continue;
          if (cell.r === dest.r && cell.c === dest.c) continue;
          const occ = occupantAt(units, cell.r, cell.c);
          if (occ && occ.team !== unit.team) return { interceptor: occ, cell: cell };
          if (plan.type !== ACTION.AIR_BALL) {
            const zd = zoneDefender(cell.r, cell.c, unit.team);
            if (zd) {
              const defender = getUnit(zd.unitId, units);
              return { interceptor: defender, cell: { r: defender.r, c: defender.c } };
            }
          }
        }
        return null;
      }

      function receiveAt(target, segment, toVerb, intoVerb) {
        if (segment) ballFlight.push(segment);
        const receivers = occupantsAt(units, target.r, target.c, unit.id);
        const teammate = receivers.find((u) => u.team === unit.team);
        const opponent = receivers.find((u) => u.team !== unit.team);
        const receiver = teammate || opponent || null;
        if (receiver) {
          ball.holderId = receiver.id;
          ball.r = receiver.r;
          ball.c = receiver.c;
          events.push({
            type: receiver.team === unit.team ? "info" : "steal",
            text: unitTitle(unit) + " " + toVerb + " " + unitTitle(receiver) + ".",
          });
        } else {
          const took = settleLooseOrOccupy(ball, units, target);
          events.push({
            type: took ? (took.team === unit.team ? "info" : "steal") : "info",
            text: took
              ? unitTitle(took) + " collected the " + CONFIG.BALL_ICON + " at " + squareName(target.r, target.c) + "."
              : unitTitle(unit) + " " + (intoVerb || toVerb) + " " + squareName(target.r, target.c) + ".",
          });
        }
      }

      function muffAt(target, approachSeg, mode) {
        const bounce = deflectSquare(target, preferVector(start, dest, curveDir, mode), {
          range: mode === "wild" ? 2 : 1,
          forbid: [start],
        });
        let land = bounce || deflectSquare(target, preferVector(start, dest, curveDir, "overcurve"), { range: 2, forbid: [start, dest] });
        if (!land) {
          land = {
            r: clamp(target.r + (target.r < SIZE - 1 ? 1 : -1), 0, SIZE - 1),
            c: target.c,
          };
          if (land.r === target.r) land.c = clamp(target.c + (target.c < SIZE - 1 ? 1 : -1), 0, SIZE - 1);
        }
        if (approachSeg) ballFlight.push(approachSeg);
        ballFlight.push(flightSeg("pause", target, target, { ms: CONFIG.BOUNCE_PAUSE_MS || 160 }));
        ballFlight.push(flightSeg("bounce", target, land));
        const took = settleLooseOrOccupy(ball, units, land);
        const muffed = occupantsAt(units, target.r, target.c, unit.id)[0];
        events.push({
          type: took ? "steal" : "info",
          text:
            (muffed ? unitTitle(muffed) + " miskicked the " + CONFIG.BALL_ICON : unitTitle(unit) + "'s pass broke down") +
            " — it bounced to " +
            squareName(land.r, land.c) +
            (took ? " where " + unitTitle(took) + " collected it" : "") +
            ".",
        });
      }

      if (plan.type === ACTION.PASS) {
        const path = cellsBetween(start.r, start.c, dest.r, dest.c);
        const hit = interceptOnCells(path);
        if (hit) {
          ball.holderId = hit.interceptor.id;
          ball.r = hit.interceptor.r;
          ball.c = hit.interceptor.c;
          events.push({ type: "steal", text: unitTitle(hit.interceptor) + " intercepted the pass." });
          ballFlight.push(flightSeg("straight", start, { r: hit.interceptor.r, c: hit.interceptor.c }));
        } else {
          receiveAt(dest, flightSeg("straight", start, dest), "passed to", "passed into");
        }
        continue;
      }

      if (plan.type === ACTION.CURVE_PASS) {
        const outcome = resolveRiskOutcome(CONFIG.RISK.CURVE_PASS);
        const curvePts = sampleCurve(start, dest, curveDir, 8);
        const hit = interceptOnCells(uniqueIntCells(curvePts));
        if (hit) {
          ball.holderId = hit.interceptor.id;
          ball.r = hit.interceptor.r;
          ball.c = hit.interceptor.c;
          events.push({ type: "steal", text: unitTitle(hit.interceptor) + " cut out the curve pass." });
          ballFlight.push(flightSeg("curve", start, { r: hit.interceptor.r, c: hit.interceptor.c }, { curveDir: curveDir }));
        } else if (outcome === "clean") {
          receiveAt(dest, flightSeg("curve", start, dest, { curveDir: curveDir }), "curled a pass to", "curled a pass into");
        } else if (outcome === "badTouch") {
          muffAt(dest, flightSeg("curve", start, dest, { curveDir: curveDir }), "badTouch");
        } else {
          const over = deflectSquare(dest, preferVector(start, dest, curveDir, "overcurve"), {
            range: 1,
            forbid: [start],
          });
          const land = over || dest;
          ballFlight.push(flightSeg("curve", start, land, { curveDir: curveDir, extraBend: 0.25 }));
          const took = settleLooseOrOccupy(ball, units, land);
          events.push({
            type: took ? "steal" : "info",
            text:
              unitTitle(unit) +
              " overcurved the pass to " +
              squareName(land.r, land.c) +
              (took ? " — " + unitTitle(took) + " collected it" : "") +
              ".",
          });
        }
        continue;
      }

      if (plan.type === ACTION.AIR_BALL) {
        const outcome = resolveRiskOutcome(CONFIG.RISK.AIR_BALL);
        if (outcome === "clean") {
          receiveAt(dest, flightSeg("air", start, dest), "lofted an air ball to", "lofted an air ball into");
        } else if (outcome === "badTouch") {
          muffAt(dest, flightSeg("air", start, dest), "badTouch");
        } else {
          const past = deflectSquare(dest, preferVector(start, dest, curveDir, "overcurve"), {
            range: 1,
            forbid: [start],
          });
          const land = past || dest;
          ballFlight.push(flightSeg("air", start, land));
          const took = settleLooseOrOccupy(ball, units, land);
          events.push({
            type: took ? "steal" : "info",
            text:
              unitTitle(unit) +
              "'s air ball missed the aerial and dropped at " +
              squareName(land.r, land.c) +
              (took ? " — " + unitTitle(took) + " collected it" : "") +
              ".",
          });
        }
      }
    }

    // --- Shots ---
    let goal = null;
    let goalTarget = null;
    for (const unit of units) {
      const plan = plans[unit.id];
      if (!plan || !isShotLike(plan.type)) continue;
      if (ball.holderId !== unit.id) {
        events.push({ type: "info", text: unitTitle(unit) + " had nothing to shoot." });
        continue;
      }
      if (!inShootRange(unit)) {
        events.push({ type: "info", text: unitTitle(unit) + " was too far from goal." });
        continue;
      }

      const target = shotTargetSquare(unit, plan);
      const curveDir = plan.curveDir || CURVE_DIR.LEFT;
      const outcome =
        plan.type === ACTION.CURVE_SHOT ? resolveRiskOutcome(CONFIG.RISK.CURVE_SHOT) : "onTarget";

      function shotPathCells() {
        if (plan.type === ACTION.CURVE_SHOT) return uniqueIntCells(sampleCurve({ r: unit.r, c: unit.c }, target, curveDir, 8));
        const path = cellsBetween(unit.r, unit.c, target.r, target.c);
        if (unit.r !== target.r || unit.c !== target.c) path.push(target);
        return path;
      }

      function shotFlightSeg(end) {
        if (plan.type === ACTION.CURVE_SHOT) {
          const extra = outcome === "wild" ? 0.5 : outcome === "wide" ? 0.22 : 0;
          return flightSeg("curve", { r: unit.r, c: unit.c }, end, { curveDir: curveDir, extraBend: extra });
        }
        return flightSeg("straight", { r: unit.r, c: unit.c }, end);
      }

      if (outcome === "onTarget") {
        let blocker = null;
        shotPathCells().forEach(function (cell) {
          if (blocker) return;
          if (cell.r === unit.r && cell.c === unit.c) return;
          const occ = occupantAt(units, cell.r, cell.c, unit.id);
          if (occ && occ.team !== unit.team) blocker = occ;
          else {
            const zd = zoneDefender(cell.r, cell.c, unit.team);
            if (zd) blocker = getUnit(zd.unitId, units);
          }
        });
        const flight = shotFlightSeg(blocker ? { r: blocker.r, c: blocker.c } : target);
        if (blocker) {
          ball.holderId = blocker.id;
          ball.r = blocker.r;
          ball.c = blocker.c;
          events.push({ type: "steal", text: unitTitle(blocker) + " blocked the shot." });
          ballFlight.push(flight);
        } else {
          goal = unit.team;
          goalTarget = { r: target.r, c: target.c };
          ball.holderId = null;
          ball.r = target.r;
          ball.c = target.c;
          events.push({ type: "goal", text: "GOAL! " + teamName(unit.team) + " scores." });
          ballFlight.push(flight);
        }
      } else {
        const mode = outcome === "wild" ? "wild" : "wide";
        const miss = deflectSquare(target, preferVector({ r: unit.r, c: unit.c }, target, curveDir, mode), {
          range: outcome === "wild" ? 2 : 1,
          minRange: outcome === "wild" ? 1 : 0,
          forbid: [{ r: unit.r, c: unit.c }],
          avoidGoalTeam: unit.team,
        });
        const land = miss || deflectSquare(target, preferVector({ r: unit.r, c: unit.c }, target, curveDir, "overcurve"), {
          range: 2,
          forbid: [{ r: unit.r, c: unit.c }, target],
          avoidGoalTeam: unit.team,
        });
        if (!land) continue;
        ballFlight.push(shotFlightSeg(land));
        const took = settleLooseOrOccupy(ball, units, land);
        events.push({
          type: took ? "steal" : "info",
          text:
            unitTitle(unit) +
            (outcome === "wild" ? " sent a wild curve shot to " : " bent a curve shot wide to ") +
            squareName(land.r, land.c) +
            (took ? " — " + unitTitle(took) + " collected it" : "") +
            ".",
        });
      }
    }

    // --- Tackles ---
    if (!goal) {
      for (const unit of units) {
        const plan = plans[unit.id];
        if (!plan || plan.type !== ACTION.TACKLE) continue;
        if (!ball.holderId) {
          events.push({ type: "info", text: unitTitle(unit) + " tackled empty space." });
          continue;
        }
        const holder = getUnit(ball.holderId, units);
        if (holder.id !== plan.targetId) {
          events.push({
            type: "info",
            text: unitTitle(unit) + "'s tackle missed — the ball had moved on.",
          });
          continue;
        }
        if (chebyshev(unit, holder) > CONFIG.TACKLE_RANGE) {
          events.push({
            type: "info",
            text: unitTitle(unit) + " could not reach " + unitTitle(holder) + ".",
          });
          continue;
        }
        ball.holderId = unit.id;
        ball.r = unit.r;
        ball.c = unit.c;
        events.push({
          type: "steal",
          text: unitTitle(unit) + " tackled " + unitTitle(holder) + " and won the ball.",
        });
      }
    }

    // --- Dribble vulnerability ---
    // A dribble is stripped if the carrier ends in a defensive zone, or is adjacent
    // to an opposing defender who chose DEFEND or TACKLE this round.
    if (!goal && ball.holderId) {
      const holder = getUnit(ball.holderId, units);
      const holdPlan = plans[holder.id];
      if (holdPlan && holdPlan.type === ACTION.DRIBBLE) {
        const thieves = units.filter((u) => {
          if (u.team === holder.team || u.role !== "defender") return false;
          const defPlan = plans[u.id];
          const adjacent = chebyshev(u, holder) <= 1;
          const inZone = zones.some(
            (z) => z.unitId === u.id && z.cells.some((cell) => cell.r === holder.r && cell.c === holder.c)
          );
          const defending = defPlan && (defPlan.type === ACTION.DEFEND || defPlan.type === ACTION.TACKLE);
          return inZone || (adjacent && defending);
        });
        if (thieves.length) {
          const thief = thieves[0];
          ball.holderId = thief.id;
          ball.r = thief.r;
          ball.c = thief.c;
          events.push({
            type: "steal",
            text: unitTitle(thief) + " nicked the ball off the dribble.",
          });
        }
      }
    }

    if (!goal && !ball.holderId) {
      const here = occupantsAt(units, ball.r, ball.c);
      if (here.length === 1) {
        ball.holderId = here[0].id;
        events.push({
          type: "info",
          text: unitTitle(here[0]) + " collected the loose " + CONFIG.BALL_ICON + ".",
        });
      } else if (here.length > 1) {
        events.push({
          type: "contest",
          text: "Players met the loose ball at " + squareName(ball.r, ball.c) + " — it stays free.",
        });
      }
    }

    if (!events.length) {
      events.push({ type: "info", text: "Both teams shuffled. No contact." });
    }

    return { units, ball, events, goal, goalTarget, zones, contestCells, ballFlight };
  }

  // ---------------------------------------------------------------------------
  // Phase machine
  // ---------------------------------------------------------------------------

  function enterPlanning(team) {
    state.phase = "planning";
    state.planningTeam = team;
    state.selectedId = null;
    state.selectedAction = ACTION.MOVE;
    state.previewDest = null;
    state.revealPlans = null;
    state.revealFrom = null;
    state.contestCells = [];
    state.zoneCells = [];
    state.fxBall = null;
    render();
  }

  function startPlanning(team) {
    if (isCpuTeam(team)) {
      applyCpuPlans();
      beginReveal();
      return;
    }

    state.planningTeam = team;
    state.selectedId = null;
    state.selectedAction = ACTION.MOVE;
    state.previewDest = null;
    state.revealPlans = null;
    state.revealFrom = null;
    state.contestCells = [];
    state.zoneCells = [];
    state.fxBall = null;

    if (state.gameMode === "PVCPU") {
      enterPlanning(team);
      return;
    }

    state.phase = "handoff";
    render();
    showOverlay(
      teamName(team) + " is planning",
      teamName(opponentTeam(team)) + " should look away. Plans stay hidden until both sides lock in.",
      "Start planning",
      function () {
        hideOverlay();
        state.phase = "planning";
        render();
      }
    );
  }

  function lockIn() {
    if (state.phase !== "planning") return;
    const team = state.planningTeam;
    if (isCpuTeam(team)) return;
    ensureStayPlans(team);
    state.locked[team] = true;
    state.selectedId = null;

    if (state.gameMode === "PVCPU") {
      state.phase = "cpu";
      render();
      later(function () {
        applyCpuPlans();
        beginReveal();
      }, CONFIG.CPU_THINK_MS || 280);
      return;
    }

    const other = opponentTeam(team);
    if (!state.locked[other]) {
      startPlanning(other);
      return;
    }

    beginReveal();
  }

  function beginReveal() {
    hideOverlay();
    state.phase = "reveal";
    state.revealFrom = clone(state.units);
    state.revealPlans = clone(Object.assign({}, state.plans.blue, state.plans.orange));
    state.selectedId = null;
    render();

    later(function () {
      const result = resolveRound(state.units, state.ball, state.plans);
      applyResult(result);
    }, CONFIG.REVEAL_MS);
  }

  function scoreLine() {
    return teamName("blue") + " " + state.score.blue + " – " + state.score.orange + " " + teamName("orange");
  }

  function finishResolvedRound(result) {
    setMoveAnim(false);
    if (state.winner) {
      state.fxBall = null;
      state.phase = "gameover";
      hideGoalBanner();
      render();
      showOverlay(
        teamName(state.winner) + " TEAM WINS",
        scoreLine(),
        "PLAY AGAIN",
        function () {
          startMatch(state.gameMode || "PVP");
        },
        "MAIN MENU",
        showMainMenu
      );
    } else if (result && result.goal) {
      state.phase = "goal";
      hideGoalBanner();
      render();
      showOverlay(
        "GOAL!",
        teamName(result.goal) + " scores. " + scoreLine(),
        "NEXT ROUND",
        function () {
          hideOverlay();
          state.fxBall = null;
          nextRound();
        }
      );
    } else {
      state.fxBall = null;
      state.phase = "frozen";
      render();
    }
  }

  function cellSize() {
    return els.pitch.clientWidth / SIZE || 1;
  }

  /** Pixel pose the ⚽ uses when it is not in flight (held vs loose). */
  function logicalBallPx(ball) {
    const cell = cellSize();
    if (ball && ball.holderId) {
      const holder = getUnit(ball.holderId);
      if (holder) {
        const layout = pieceOffset(holder, cell);
        if (layout.stacked) return { x: layout.left + cell * 0.18, y: layout.top - 6 };
        return { x: holder.c * cell + cell * 0.58, y: holder.r * cell + cell * 0.08 };
      }
    }
    const r = ball ? ball.r : 0;
    const c = ball ? ball.c : 0;
    return { x: c * cell + cell * 0.32, y: r * cell + cell * 0.28 };
  }

  function flightPx(r, c, lift) {
    const cell = cellSize();
    return {
      x: (c + 0.5) * cell - 11,
      y: (r + 0.5) * cell - 11 - (lift || 0) * cell,
    };
  }

  function readBallPx() {
    const ball = document.getElementById("ball");
    if (!ball || !ball.style.left) return null;
    const x = parseFloat(ball.style.left);
    const y = parseFloat(ball.style.top);
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
    return { x: x, y: y };
  }

  function writeBallPx(x, y, opts) {
    opts = opts || {};
    state.fxBall = {
      left: x,
      top: y,
      inNet: !!opts.inNet,
      air: !!opts.air,
      flight: !opts.inNet,
    };
    const ball = document.getElementById("ball");
    if (!ball) {
      renderPieces();
      return;
    }
    ball.className = "ball" + (opts.inNet ? " in-net" : " flight") + (opts.air && !opts.inNet ? " air" : "");
    ball.style.setProperty("--move", "0ms");
    ball.style.left = x + "px";
    ball.style.top = y + "px";
  }

  function segmentDuration(seg) {
    if (!seg) return 0;
    if (seg.kind === "pause") return seg.ms || CONFIG.BOUNCE_PAUSE_MS || 160;
    const dist = Math.max(Math.hypot(seg.to.r - seg.from.r, seg.to.c - seg.from.c), 0.75);
    let base = CONFIG.PASS_ANIM_MS || 560;
    if (seg.kind === "air") base = CONFIG.AIR_ANIM_MS || 820;
    else if (seg.kind === "curve") base = CONFIG.CURVE_ANIM_MS || 760;
    else if (seg.kind === "bounce") base = CONFIG.BOUNCE_ANIM_MS || 320;
    return Math.round(clamp(base * (0.38 + dist / 5), 220, base * 1.2));
  }

  function pxOnSegment(seg, t, startPx) {
    t = clamp(t, 0, 1);
    const from = startPx || flightPx(seg.from.r, seg.from.c, 0);
    const to = flightPx(seg.to.r, seg.to.c, 0);
    if (seg.kind === "pause") {
      return { x: from.x, y: from.y, air: false };
    }
    if (seg.kind === "curve") {
      const ctrl = curveControl(seg.from, seg.to, seg.curveDir, seg.extraBend || 0);
      const q = flightPx(ctrl.r, ctrl.c, 0);
      const u = 1 - t;
      return {
        x: u * u * from.x + 2 * u * t * q.x + t * t * to.x,
        y: u * u * from.y + 2 * u * t * q.y + t * t * to.y,
        air: false,
      };
    }
    const liftMax =
      seg.kind === "air" ? (seg.liftMax != null ? seg.liftMax : 1.25) :
      seg.kind === "bounce" ? (seg.liftMax != null ? seg.liftMax : 0.42) :
      0;
    const cell = cellSize();
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * liftMax * cell,
      air: liftMax > 0.15 && t > 0.04 && t < 0.96,
    };
  }

  function flightHasMotion(segments) {
    return (segments || []).some(function (seg) {
      return seg && seg.kind && seg.kind !== "pause";
    });
  }

  function animatePx(from, to, ms, onFrame, done) {
    const dur = Math.max(1, ms || 1);
    const t0 = performance.now();
    function tick(now) {
      const t = clamp((now - t0) / dur, 0, 1);
      onFrame(
        {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        },
        t
      );
      if (t < 1) nowRaf(tick);
      else done();
    }
    nowRaf(tick);
  }

  /**
   * Visual-only: interpolate the ⚽ in pixels along precomputed segments.
   * Does not change logical interception, possession, or grid coordinates mid-flight.
   */
  function animateBallFlight(segments, finalBall, done, opts) {
    opts = opts || {};
    const segs = (segments || []).filter(function (seg) {
      return seg && seg.kind;
    });
    if (!segs.length) {
      state.fxBall = null;
      state.ball = finalBall;
      render();
      done();
      return;
    }

    setMoveAnim(true);
    let i = 0;
    let origin = readBallPx();
    if (origin) writeBallPx(origin.x, origin.y, { air: false });
    render();

    function finish() {
      if (opts.keepVisual) {
        state.ball = finalBall;
        render();
        done();
        return;
      }
      const from = readBallPx() || flightPx(finalBall.r, finalBall.c, 0);
      const to = logicalBallPx(finalBall);
      animatePx(from, to, 90, function (px) {
        writeBallPx(px.x, px.y, { air: false });
      }, function () {
        state.fxBall = null;
        state.ball = finalBall;
        render();
        done();
      });
    }

    function runSeg() {
      if (i >= segs.length) {
        finish();
        return;
      }
      const seg = segs[i];
      const dur = segmentDuration(seg);
      const startPx = origin || flightPx(seg.from.r, seg.from.c, 0);

      if (seg.kind === "pause") {
        writeBallPx(startPx.x, startPx.y, { air: false });
        later(function () {
          origin = startPx;
          i += 1;
          runSeg();
        }, dur);
        return;
      }

      const t0 = performance.now();
      function tick(now) {
        const t = dur <= 0 ? 1 : clamp((now - t0) / dur, 0, 1);
        const px = pxOnSegment(seg, t, startPx);
        writeBallPx(px.x, px.y, { air: px.air });
        if (t < 1) {
          nowRaf(tick);
        } else {
          origin = { x: px.x, y: px.y };
          i += 1;
          runSeg();
        }
      }
      writeBallPx(startPx.x, startPx.y, { air: false });
      nowRaf(tick);
    }

    runSeg();
  }

  function applyGoalScore(result) {
    const ge = (result.events || []).find(function (e) {
      return e.type === "goal";
    });
    if (ge) {
      state.events = [ge.text].concat(state.events || []);
      state.eventKinds = ["goal"].concat(state.eventKinds || []);
    }
    state.score[result.goal] += 1;
    if (state.score[result.goal] >= CONFIG.GOALS_TO_WIN) {
      state.winner = result.goal;
    } else {
      state.pendingKickoff = opponentTeam(result.goal);
    }
  }

  function showGoalBanner() {
    if (!els.goalBanner) return;
    els.goalBanner.textContent = "GOAL!";
    els.goalBanner.classList.remove("hidden");
    els.goalBanner.removeAttribute("hidden");
  }

  function hideGoalBanner() {
    if (!els.goalBanner) return;
    els.goalBanner.classList.add("hidden");
    els.goalBanner.setAttribute("hidden", "");
  }

  function playGoalSequence(result, done) {
    state.phase = "goal";
    const target = result.goalTarget || { r: result.ball.r, c: result.ball.c };
    const cell = cellSize();
    const start = readBallPx() || flightPx(target.r, target.c, 0);
    const intoNet = {
      x: start.x,
      y: result.goal === "blue" ? -cell * 0.48 : SIZE * cell + 6,
    };

    state.ball = { r: target.r, c: target.c, holderId: null };
    setMoveAnim(true);
    writeBallPx(start.x, start.y, { air: false });

    animatePx(start, intoNet, CONFIG.GOAL_NET_MS || 420, function (px, t) {
      writeBallPx(px.x, px.y, { inNet: t > 0.12 });
    }, function () {
      applyGoalScore(result);
      showGoalBanner();
      render();
      later(function () {
        hideGoalBanner();
        state.fxBall = null;
        setMoveAnim(false);
        done();
      }, CONFIG.GOAL_PAUSE_MS || 950);
    });
  }

  function applyResult(result) {
    setMoveAnim(true);
    state.units = result.units;
    state.contestCells = result.contestCells;
    state.zoneCells = result.zones;
    state.pendingKickoff = null;
    state.fxBall = null;

    if (result.goal) {
      state.events = result.events
        .filter(function (e) {
          return e.type !== "goal";
        })
        .map(function (e) {
          return e.text;
        });
      state.eventKinds = result.events
        .filter(function (e) {
          return e.type !== "goal";
        })
        .map(function (e) {
          return e.type;
        });
    } else {
      state.events = result.events.map(function (e) {
        return e.text;
      });
      state.eventKinds = result.events.map(function (e) {
        return e.type;
      });
    }

    const afterFlight = function () {
      if (result.goal) {
        playGoalSequence(result, function () {
          finishResolvedRound(result);
        });
        return;
      }
      later(function () {
        finishResolvedRound(result);
      }, 80);
    };

    const land = result.goal
      ? { r: (result.goalTarget || result.ball).r, c: (result.goalTarget || result.ball).c, holderId: null }
      : result.ball;

    if (flightHasMotion(result.ballFlight)) {
      animateBallFlight(result.ballFlight, land, afterFlight, { keepVisual: !!result.goal });
    } else {
      state.ball = land;
      render();
      later(afterFlight, CONFIG.MOVE_ANIM_MS + 40);
    }
  }

  function nextRound() {
    if (state.pendingKickoff) {
      const units = createUnits();
      state.units = units;
      state.ball = ballWithTeam(units, state.pendingKickoff);
      state.events = ["Kickoff — " + teamName(state.pendingKickoff) + " restarts with the ball."];
      state.eventKinds = ["info"];
      state.pendingKickoff = null;
    }
    state.fxBall = null;
    state.locked = { blue: false, orange: false };
    state.plans = blankPlans();
    state.revealPlans = null;
    state.revealFrom = null;
    state.contestCells = [];
    state.zoneCells = [];
    startPlanning(CONFIG.FIRST_PLANNING_TEAM);
  }

  function startMatch(mode) {
    clearTimers();
    setMoveAnim(false);
    hideGoalBanner();
    hideOverlay();
    state = freshMatch(mode);
    startPlanning(mode === "PVCPU" ? humanTeam() : CONFIG.FIRST_PLANNING_TEAM);
  }

  function resetMatch() {
    startMatch(state && state.gameMode ? state.gameMode : "PVP");
  }

  function showMainMenu() {
    clearTimers();
    setMoveAnim(false);
    hideGoalBanner();
    state = freshMatch("PVP");
    state.gameMode = null;
    state.phase = "menu";
    render();
    showOverlay(
      "SOCCER CHESS",
      "Local match. First to " + CONFIG.GOALS_TO_WIN + " goals.",
      "PLAYER VS PLAYER",
      function () {
        startMatch("PVP");
      },
      "PLAYER VS CPU",
      function () {
        startMatch("PVCPU");
      },
      true
    );
  }

  function setMoveAnim(on) {
    const ms = on ? CONFIG.MOVE_ANIM_MS + "ms" : "0ms";
    els.pieces.style.setProperty("--move", ms);
    const ballEl = document.getElementById("ball");
    if (ballEl) {
      if (state.fxBall && (state.fxBall.flight || state.fxBall.inNet)) ballEl.style.setProperty("--move", "0ms");
      else ballEl.style.setProperty("--move", ms);
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  function canPlan() {
    return state.phase === "planning" && !isCpuTeam(state.planningTeam);
  }

  function selectOwnUnit(unit) {
    state.selectedId = unit.id;
    const existing = currentPlans()[unit.id];
    state.selectedAction =
      existing && !existing.implicitStay && actionEnabled(unit, existing.type)
        ? existing.type
        : ACTION.MOVE;
    if (!actionEnabled(unit, state.selectedAction)) state.selectedAction = ACTION.MOVE;
    state.previewDest = null;
  }

  function chooseAction(type) {
    const unit = selectedUnit();
    if (!unit || !canPlan() || unit.team !== state.planningTeam) return;
    if (!actionEnabled(unit, type)) return;
    state.selectedAction = type;
    const existing = currentPlans()[unit.id];
    if (existing && !existing.implicitStay) {
      if (isPassLike(type) && isPassLike(existing.type) && existing.passTo) {
        assignPass(unit, existing.passTo.r, existing.passTo.c, type);
      } else if (isShotLike(type) && isShotLike(existing.type) && existing.shotTarget) {
        setPlan(unit, {
          type: type,
          dest: { r: unit.r, c: unit.c },
          shotTarget: existing.shotTarget,
          curveDir: needsCurveDir(type) ? existing.curveDir || state.pendingCurveDir || CURVE_DIR.LEFT : undefined,
        });
      }
    }
    render();
  }

  function assignTravel(unit, r, c) {
    if (state.selectedAction === ACTION.SPRINT) {
      if (!isLegalSprint(unit, r, c, currentPlans())) return;
      setPlan(unit, { type: ACTION.SPRINT, dest: { r, c } });
      return;
    }
    if (!isLegalDest(unit, r, c, currentPlans())) return;
    const type = state.selectedAction === ACTION.DRIBBLE ? ACTION.DRIBBLE : ACTION.MOVE;
    if (type === ACTION.DRIBBLE && !hasBall(unit)) return;
    setPlan(unit, { type, dest: { r, c } });
  }

  function assignPass(unit, r, c, type) {
    const passType = type || state.selectedAction;
    if (!isLegalPassSquare(unit, r, c)) return;
    const occupant = state.units.find((u) => u.r === r && u.c === c && u.id !== unit.id);
    const existing = currentPlans()[unit.id];
    const curveDir =
      needsCurveDir(passType)
        ? (existing && existing.curveDir) || state.pendingCurveDir || CURVE_DIR.LEFT
        : undefined;
    const plan = {
      type: passType,
      dest: { r: unit.r, c: unit.c },
      passTo: { r, c },
      targetId: occupant ? occupant.id : null,
    };
    if (curveDir) plan.curveDir = curveDir;
    setPlan(unit, plan);
  }

  function setCurveDir(dir) {
    const unit = selectedUnit();
    if (!unit || !canPlan() || !needsCurveDir(state.selectedAction)) return;
    const existing = currentPlans()[unit.id];
    if (existing && isPassLike(existing.type) && existing.passTo) {
      existing.curveDir = dir;
      existing.type = state.selectedAction;
      setPlan(unit, existing);
    } else if (existing && isShotLike(existing.type) && existing.shotTarget) {
      existing.curveDir = dir;
      existing.type = state.selectedAction;
      setPlan(unit, existing);
    } else {
      state.pendingCurveDir = dir;
    }
    render();
  }

  function handleCellClick(r, c) {
    if (!canPlan()) return;
    const unit = selectedUnit();
    if (!unit || unit.team !== state.planningTeam) return;

    if (
      state.selectedAction === ACTION.MOVE ||
      state.selectedAction === ACTION.DRIBBLE ||
      state.selectedAction === ACTION.SPRINT
    ) {
      assignTravel(unit, r, c);
      render();
      return;
    }

    if (isPassLike(state.selectedAction)) {
      assignPass(unit, r, c, state.selectedAction);
      render();
      return;
    }

    if (isShotLike(state.selectedAction)) {
      if (reachableGoalSquares(unit).some((g) => g.r === r && g.c === c)) {
        const existing = currentPlans()[unit.id];
        setPlan(unit, {
          type: state.selectedAction,
          dest: { r: unit.r, c: unit.c },
          shotTarget: { r, c },
          curveDir: needsCurveDir(state.selectedAction)
            ? (existing && existing.curveDir) || state.pendingCurveDir || CURVE_DIR.LEFT
            : undefined,
        });
        render();
      }
      return;
    }

    if (state.selectedAction === ACTION.DEFEND) {
      const dir = dirFromDelta(r - unit.r, c - unit.c);
      if (!dir || chebyshev(unit, { r, c }) !== 1) return;
      setPlan(unit, { type: ACTION.DEFEND, dir: dir.key, dest: { r: unit.r, c: unit.c } });
      render();
      return;
    }

    const occupant = state.units.find((u) => u.r === r && u.c === c);
    if (occupant) handleUnitClick(occupant);
  }

  function handleUnitClick(unit) {
    if (!canPlan()) return;

    const selected = selectedUnit();
    if (selected && selected.team === state.planningTeam) {
      if (isPassLike(state.selectedAction) && unit.id !== selected.id) {
        if (isLegalPassSquare(selected, unit.r, unit.c)) {
          assignPass(selected, unit.r, unit.c, state.selectedAction);
          render();
          return;
        }
      }
      if (state.selectedAction === ACTION.TACKLE && unit.team !== selected.team) {
        if (tackleTargets(selected).some((t) => t.id === unit.id)) {
          setPlan(selected, {
            type: ACTION.TACKLE,
            targetId: unit.id,
            dest: { r: selected.r, c: selected.c },
          });
          render();
          return;
        }
      }
      if (
        (state.selectedAction === ACTION.MOVE || state.selectedAction === ACTION.DRIBBLE) &&
        isLegalDest(selected, unit.r, unit.c, currentPlans())
      ) {
        assignTravel(selected, unit.r, unit.c);
        render();
        return;
      }
      if (state.selectedAction === ACTION.SPRINT && isLegalSprint(selected, unit.r, unit.c, currentPlans())) {
        assignTravel(selected, unit.r, unit.c);
        render();
        return;
      }
    }

    if (unit.team === state.planningTeam) {
      selectOwnUnit(unit);
      render();
    }
  }

  function highlightCells() {
    const cells = [];
    const extra = { pass: [], zone: [] };
    if (!canPlan()) return { cells, extra };
    const unit = selectedUnit();
    if (!unit || unit.team !== state.planningTeam) return { cells, extra };

    if (state.selectedAction === ACTION.MOVE || state.selectedAction === ACTION.DRIBBLE) {
      extra.legal = legalMoveDests(unit, currentPlans());
    } else if (state.selectedAction === ACTION.SPRINT) {
      extra.legal = legalSprintDests(unit, currentPlans());
    } else if (state.selectedAction === ACTION.DEFEND) {
      extra.legal = Object.values(DIRECTIONS)
        .map((d) => ({ r: unit.r + d.dr, c: unit.c + d.dc }))
        .filter((p) => inBounds(p.r, p.c));
      const plan = currentPlans()[unit.id];
      if (plan && plan.type === ACTION.DEFEND && plan.dir) {
        extra.zone = defensiveZone(unit, plan.dir);
      }
    } else if (isPassLike(state.selectedAction)) {
      extra.legal = passSquares(unit);
      extra.pass = passTargets(unit);
    } else if (isShotLike(state.selectedAction)) {
      extra.legal = reachableGoalSquares(unit);
    } else if (state.selectedAction === ACTION.TACKLE) {
      extra.pass = tackleTargets(unit);
    }
    extra.legal = extra.legal || [];
    return extra;
  }

  function visiblePlans() {
    if (state.phase === "planning") return currentPlans();
    if (state.phase === "cpu") return state.plans[humanTeam()] || {};
    if (
      state.phase === "reveal" ||
      state.phase === "frozen" ||
      state.phase === "gameover" ||
      state.phase === "goal"
    ) {
      return state.revealPlans || Object.assign({}, state.plans.blue, state.plans.orange);
    }
    return {};
  }

  function unitsForArrows() {
    if (
      (state.phase === "reveal" ||
        state.phase === "frozen" ||
        state.phase === "gameover" ||
        state.phase === "goal") &&
      state.revealFrom
    ) {
      return state.revealFrom;
    }
    return state.units;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function phaseLabel() {
    if (state.phase === "menu") return "MENU";
    if (state.phase === "planning") return "PLANNING";
    if (state.phase === "handoff") return "LOCKED";
    if (state.phase === "cpu") return "LOCKED";
    if (state.phase === "reveal") return "REVEAL";
    if (state.phase === "frozen") return "REVEAL";
    if (state.phase === "goal") return "GOAL";
    if (state.phase === "gameover") return "GAME OVER";
    return String(state.phase || "").toUpperCase();
  }

  function turnLabel() {
    if (state.phase === "menu") return "Choose mode";
    if (state.phase === "planning" || state.phase === "handoff") return teamName(state.planningTeam) + " Team";
    if (state.phase === "cpu") return "Both sides locked";
    if (state.phase === "reveal") return "Both teams";
    if (state.phase === "frozen") return "Round resolved";
    if (state.phase === "goal") return "Goal";
    if (state.phase === "gameover") return teamName(state.winner) + " wins";
    return "—";
  }

  function buildBoard() {
    els.board.innerHTML = "";
    els.board.style.gridTemplateColumns = "repeat(" + SIZE + ", var(--cell))";
    els.board.style.gridTemplateRows = "repeat(" + SIZE + ", var(--cell))";
    els.pitch.style.width = "calc(var(--cell) * " + SIZE + ")";
    els.pitch.style.height = "calc(var(--cell) * " + SIZE + ")";
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        cell.setAttribute("role", "button");
        cell.setAttribute("aria-label", "Square " + squareName(r, c));
        cell.addEventListener("click", function () {
          handleCellClick(r, c);
        });
        els.board.appendChild(cell);
      }
    }
  }

  function renderHighlights() {
    const hi = highlightCells();
    const legal = new Set((hi.legal || []).map((p) => cellKey(p.r, p.c)));
    const pass = new Set((hi.pass || []).map((p) => cellKey(p.r, p.c)));
    const contests = new Set((state.contestCells || []).map((p) => cellKey(p.r, p.c)));
    const ownZones = [];

    if (canPlan()) {
      teamUnits(state.planningTeam).forEach(function (unit) {
        const plan = currentPlans()[unit.id];
        if (plan && plan.type === ACTION.DEFEND && plan.dir) {
          defensiveZone(unit, plan.dir).forEach(function (p) {
            ownZones.push({ r: p.r, c: p.c, team: unit.team });
          });
        }
      });
    }

    els.board.querySelectorAll(".cell").forEach(function (cell) {
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      const k = cellKey(r, c);
      cell.className = "cell";
      if (c >= CONFIG.GOAL_COL_START && c <= CONFIG.GOAL_COL_END) {
        if (r === 0) cell.classList.add("goal-square", "goal-end-top");
        if (r === SIZE - 1) cell.classList.add("goal-square", "goal-end-bottom");
      }
      if (legal.has(k)) cell.classList.add("legal");
      if (pass.has(k)) cell.classList.add("pass-target");
      if (canPlan() && selectedUnit() && isShotLike(state.selectedAction) && legal.has(k)) {
        cell.classList.add("shot-target");
      }
      if (canPlan()) {
        ownZones.forEach(function (z) {
          if (z.r === r && z.c === c) {
            cell.classList.add(z.team === "blue" ? "zone-blue" : "zone-orange");
          }
        });
      } else {
        (state.zoneCells || []).forEach(function (z) {
          if (z.cells.some((p) => p.r === r && p.c === c)) {
            cell.classList.add(z.team === "blue" ? "zone-blue" : "zone-orange");
          }
        });
      }
      if (
        (state.phase === "frozen" ||
          state.phase === "reveal" ||
          state.phase === "gameover" ||
          state.phase === "goal") &&
        contests.has(k)
      ) {
        cell.classList.add("contest");
      }
    });
  }

  function ensurePieceEl(unit) {
    let el = els.pieces.querySelector('.piece[data-id="' + unit.id + '"]');
    if (el) return el;
    el = document.createElement("div");
    el.className = "piece";
    el.dataset.id = unit.id;
    el.innerHTML = '<span class="role"></span>';
    el.addEventListener("pointerdown", function (e) {
      const current = getUnit(el.dataset.id);
      if (!current || !canPlan() || current.team !== state.planningTeam) return;
      e.preventDefault();
      selectOwnUnit(current);
      drag = {
        unitId: current.id,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        pointerId: e.pointerId,
      };
      render();
    });
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      const current = getUnit(el.dataset.id);
      if (current) handleUnitClick(current);
    });
    els.pieces.appendChild(el);
    return el;
  }

  function stackOn(r, c, units) {
    return (units || state.units).filter(function (u) {
      return u.r === r && u.c === c;
    });
  }

  function pieceOffset(unit, cell) {
    const stack = stackOn(unit.r, unit.c);
    const n = stack.length;
    const i = stack.findIndex(function (u) {
      return u.id === unit.id;
    });
    if (n < 2) {
      return { left: unit.c * cell, top: unit.r * cell, stacked: false, index: 0, count: 1 };
    }
    const slot = cell / n;
    return {
      left: unit.c * cell + i * slot + slot * 0.08,
      top: unit.r * cell + cell * 0.22,
      stacked: true,
      index: i,
      count: n,
    };
  }

  function renderPieces() {
    const cell = els.pitch.clientWidth / SIZE || 1;
    const seen = new Set();

    state.units.forEach(function (unit) {
      seen.add(unit.id);
      const el = ensurePieceEl(unit);
      const layout = pieceOffset(unit, cell);
      el.className = "piece " + unit.team + " " + unit.role;
      if (layout.stacked) el.classList.add("stacked");
      if (state.selectedId === unit.id) el.classList.add("selected");
      if (hasBall(unit) && !(state.fxBall && state.fxBall.flight)) el.classList.add("has-ball");
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", unitTitle(unit) + (hasBall(unit) ? " (has ball)" : ""));
      el.style.left = layout.left + "px";
      el.style.top = layout.top + "px";
      el.querySelector(".role").textContent = unit.label;
      el.title = unitTitle(unit);
    });

    els.pieces.querySelectorAll(".piece").forEach(function (el) {
      if (!seen.has(el.dataset.id)) el.remove();
    });

    let ball = document.getElementById("ball");
    if (!ball) {
      ball = document.createElement("div");
      ball.id = "ball";
      els.pieces.appendChild(ball);
    }
    ball.textContent = CONFIG.BALL_ICON || "⚽";
    ball.className =
      "ball" +
      (state.fxBall && state.fxBall.inNet
        ? " in-net"
        : state.fxBall && state.fxBall.flight
          ? state.fxBall.air
            ? " flight air"
            : " flight"
          : state.ball.holderId
            ? " held"
            : " loose");
    ball.setAttribute("aria-label", state.ball.holderId ? "Soccer ball in possession" : "Loose soccer ball");
    if (state.fxBall) {
      ball.style.left = state.fxBall.left + "px";
      ball.style.top = state.fxBall.top + "px";
    } else if (state.ball.holderId) {
      const holder = getUnit(state.ball.holderId);
      const layout = pieceOffset(holder, cell);
      if (layout.stacked) {
        ball.style.left = layout.left + cell * 0.18 + "px";
        ball.style.top = layout.top - 6 + "px";
      } else {
        ball.style.left = holder.c * cell + cell * 0.58 + "px";
        ball.style.top = holder.r * cell + cell * 0.08 + "px";
      }
    } else {
      ball.style.left = state.ball.c * cell + cell * 0.32 + "px";
      ball.style.top = state.ball.r * cell + cell * 0.28 + "px";
    }
  }

  function arrowColor(team) {
    return team === "blue" ? "#d6e8ff" : "#ffe0c2";
  }

  function renderArrows() {
    const svg = els.arrows;
    const w = els.pitch.clientWidth;
    const cell = w / SIZE;
    const plans = visiblePlans();
    const fromUnits = unitsForArrows();
    const parts = [
      '<defs>',
      '<marker id="head-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#d6e8ff"/></marker>',
      '<marker id="head-orange" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#ffe0c2"/></marker>',
      "</defs>",
    ];

    function center(r, c) {
      return { x: (c + 0.5) * cell, y: (r + 0.5) * cell };
    }

    function drawCurve(team, start, end, curveDir, dashed) {
      const a = center(start.r, start.c);
      const b = center(end.r, end.c);
      const ctrl = curveControl(start, end, curveDir || CURVE_DIR.LEFT);
      const q = center(ctrl.r, ctrl.c);
      parts.push(
        '<path d="M ' +
          a.x +
          " " +
          a.y +
          " Q " +
          q.x +
          " " +
          q.y +
          " " +
          b.x +
          " " +
          b.y +
          '" fill="none" stroke="' +
          arrowColor(team) +
          '" stroke-width="3" stroke-linecap="round"' +
          (dashed ? ' stroke-dasharray="7 6"' : "") +
          ' marker-end="url(#head-' +
          team +
          ')" />'
      );
    }

    function drawArc(team, start, end) {
      const a = center(start.r, start.c);
      const b = center(end.r, end.c);
      const lift = Math.max(24, Math.hypot(b.x - a.x, b.y - a.y) * 0.35);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 - lift;
      parts.push(
        '<path d="M ' +
          a.x +
          " " +
          a.y +
          " Q " +
          mx +
          " " +
          my +
          " " +
          b.x +
          " " +
          b.y +
          '" fill="none" stroke="' +
          arrowColor(team) +
          '" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 6" marker-end="url(#head-' +
          team +
          ')" />'
      );
    }
    function drawLine(team, x1, y1, x2, y2, dashed) {
      parts.push(
        '<line x1="' +
          x1 +
          '" y1="' +
          y1 +
          '" x2="' +
          x2 +
          '" y2="' +
          y2 +
          '" stroke="' +
          arrowColor(team) +
          '" stroke-width="3" stroke-linecap="round"' +
          (dashed ? ' stroke-dasharray="7 6"' : "") +
          ' marker-end="url(#head-' +
          team +
          ')" />'
      );
    }

    Object.keys(plans).forEach(function (id) {
      const plan = plans[id];
      const unit = fromUnits.find((u) => u.id === id) || getUnit(id);
      if (!unit || !plan) return;
      const a = center(unit.r, unit.c);

      if (plan.type === ACTION.MOVE || plan.type === ACTION.DRIBBLE || plan.type === ACTION.SPRINT) {
        if (plan.dest && (plan.dest.r !== unit.r || plan.dest.c !== unit.c)) {
          const b = center(plan.dest.r, plan.dest.c);
          drawLine(unit.team, a.x, a.y, b.x, b.y, plan.type !== ACTION.MOVE);
        } else {
          parts.push(
            '<circle cx="' +
              a.x +
              '" cy="' +
              a.y +
              '" r="10" fill="none" stroke="' +
              arrowColor(unit.team) +
              '" stroke-width="2" />'
          );
        }
      } else if (isPassLike(plan.type)) {
        const dest = plan.passTo
          ? plan.passTo
          : (function () {
              const target = fromUnits.find((u) => u.id === plan.targetId) || getUnit(plan.targetId);
              return target ? plannedDest(target, plans) : null;
            })();
        if (dest) {
          if (plan.type === ACTION.AIR_BALL) drawArc(unit.team, unit, dest);
          else if (plan.type === ACTION.CURVE_PASS) drawCurve(unit.team, unit, dest, plan.curveDir, true);
          else {
            const b = center(dest.r, dest.c);
            drawLine(unit.team, a.x, a.y, b.x, b.y, true);
          }
        }
      } else if (plan.type === ACTION.DEFEND && plan.dir) {
        const dir = DIRECTIONS[plan.dir];
        const b = center(unit.r + dir.dr * 0.85, unit.c + dir.dc * 0.85);
        drawLine(unit.team, a.x, a.y, b.x, b.y, false);
      } else if (plan.type === ACTION.TACKLE) {
        const target = fromUnits.find((u) => u.id === plan.targetId) || getUnit(plan.targetId);
        if (target) {
          const b = center(target.r, target.c);
          drawLine(unit.team, a.x, a.y, b.x, b.y, false);
        }
      } else if (isShotLike(plan.type)) {
        const t = shotTargetSquare(unit, plan);
        if (plan.type === ACTION.CURVE_SHOT) {
          drawCurve(unit.team, unit, t, plan.curveDir, false);
        } else {
          const b = center(t.r, t.c);
          const endY = unit.team === "blue" ? b.y - cell * 0.45 : b.y + cell * 0.45;
          drawLine(unit.team, a.x, a.y, b.x, endY, false);
        }
      }
    });

    if (drag && state.previewDest) {
      const unit = getUnit(drag.unitId);
      if (unit) {
        const a = center(unit.r, unit.c);
        const b = center(state.previewDest.r, state.previewDest.c);
        drawLine(unit.team, a.x, a.y, b.x, b.y, state.selectedAction !== ACTION.MOVE);
      }
    }

    svg.innerHTML = parts.join("");
    svg.setAttribute("viewBox", "0 0 " + w + " " + w);
  }

  function renderSidebar() {
    const unit = selectedUnit();
    const help = els.help;
    const actionsEl = els.actions;
    actionsEl.innerHTML = "";

    if (state.phase === "frozen") {
      help.textContent = "Round frozen. Read the result, then start the next planning phase.";
    } else if (state.phase === "reveal") {
      help.textContent = "Both sets of orders are revealed. Actions are resolving…";
    } else if (state.phase === "goal") {
      help.textContent = "Goal! Play is locked until the ball is in the net.";
    } else if (state.phase === "cpu") {
      help.textContent = "Locked in. The other side’s orders stay hidden until reveal.";
    } else if (state.phase === "menu") {
      help.textContent = "Choose a game mode to start.";
    } else if (state.phase === "gameover") {
      help.textContent = "Match over. Play again with the same mode, or return to the main menu.";
    } else if (state.phase === "handoff") {
      help.textContent = "Waiting for the next player to start planning.";
    } else if (state.gameMode === "PVCPU" && (!unit || unit.team !== state.planningTeam)) {
      help.textContent = "You are Blue. Give orders, then lock in. The CPU plans in secret.";
    } else if (!unit || unit.team !== state.planningTeam) {
      help.textContent = "Click one of your players to give an order. You can change orders until you lock in.";
    } else if (state.selectedAction === ACTION.MOVE) {
      help.textContent = "Click a highlighted square, or drag an arrow. Click the player again to stay.";
    } else if (state.selectedAction === ACTION.SPRINT) {
      help.textContent = "Sprint exactly 2 squares in one of the 8 directions. Carrying the ball is riskier near opponents.";
    } else if (state.selectedAction === ACTION.DRIBBLE) {
      help.textContent = "Dribble one square with the ball. Nearby defending players can nick it.";
    } else if (state.selectedAction === ACTION.PASS) {
      help.textContent = "Click any square within 3 (including empty space). Defenders on the lane can intercept. Reliable.";
    } else if (state.selectedAction === ACTION.CURVE_PASS) {
      help.textContent = "Click a target, then choose LEFT or RIGHT. Bends around a lane. Odds are shown below.";
    } else if (state.selectedAction === ACTION.AIR_BALL) {
      help.textContent = "Click a target. The ball lofts over the ground. Odds are shown below before you lock in.";
    } else if (state.selectedAction === ACTION.DEFEND) {
      help.textContent = "Click an adjacent square to face that way. Your zone stays hidden until reveal.";
    } else if (state.selectedAction === ACTION.TACKLE) {
      help.textContent = "Click the adjacent ball carrier. If they still have the ball next to you after movement, you win it.";
    } else if (state.selectedAction === ACTION.SHOOT) {
      help.textContent = "Click a highlighted goal square. Attackers shoot from 3, defenders from 2.";
    } else if (state.selectedAction === ACTION.CURVE_SHOT) {
      help.textContent = "Click a goal square, then LEFT or RIGHT. Odds are shown below before you lock in.";
    }

    if (canPlan() && unit && unit.team === state.planningTeam) {
      const types =
        unit.role === "attacker"
          ? [
              ACTION.MOVE,
              ACTION.SPRINT,
              ACTION.DRIBBLE,
              ACTION.PASS,
              ACTION.CURVE_PASS,
              ACTION.AIR_BALL,
              ACTION.SHOOT,
              ACTION.CURVE_SHOT,
            ]
          : [
              ACTION.MOVE,
              ACTION.SPRINT,
              ACTION.DRIBBLE,
              ACTION.PASS,
              ACTION.CURVE_PASS,
              ACTION.AIR_BALL,
              ACTION.DEFEND,
              ACTION.TACKLE,
              ACTION.SHOOT,
              ACTION.CURVE_SHOT,
            ];
      types.forEach(function (type) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = actionTitle(type);
        if (riskTableFor(type)) btn.classList.add("risk-action");
        if (state.selectedAction === type) btn.classList.add("active");
        btn.setAttribute("aria-pressed", state.selectedAction === type ? "true" : "false");
        btn.disabled = !actionEnabled(unit, type);
        btn.addEventListener("click", function () {
          chooseAction(type);
        });
        actionsEl.appendChild(btn);
      });
      const plan = currentPlans()[unit.id];
      els.clear.hidden = !plan || !!plan.implicitStay;
    } else {
      els.clear.hidden = true;
    }

    const risk = els.riskPanel;
    const curveRow = els.curveDirRow;
    const table = riskTableFor(state.selectedAction);
    const showRisk =
      !!table &&
      ((canPlan() && unit && unit.team === state.planningTeam) ||
        ((state.phase === "reveal" || state.phase === "frozen" || state.phase === "goal") &&
          state.revealPlans &&
          Object.keys(state.revealPlans).some(function (id) {
            return riskTableFor((state.revealPlans[id] || {}).type);
          })));
    if (risk) {
      if (canPlan() && unit && unit.team === state.planningTeam && table) {
        const plan = currentPlans()[unit.id];
        const target =
          plan && plan.passTo
            ? squareName(plan.passTo.r, plan.passTo.c)
            : plan && plan.shotTarget
              ? squareName(plan.shotTarget.r, plan.shotTarget.c)
              : "—";
        risk.hidden = false;
        risk.innerHTML =
          '<div class="risk-title">' +
          actionTitle(state.selectedAction) +
          (needsCurveDir(state.selectedAction)
            ? " · " + ((plan && plan.curveDir) || state.pendingCurveDir || CURVE_DIR.LEFT)
            : "") +
          "</div>" +
          (target !== "—" ? "<div>Target: " + target + "</div>" : "") +
          table
            .map(function (row, i) {
              const cls = i === 0 ? "risk-ok" : "risk-warn";
              const mark = i === 0 ? "✓" : "⚠";
              return (
                '<div class="' +
                cls +
                '">' +
                mark +
                " " +
                Math.round(row.chance * 100) +
                "% " +
                row.label.toUpperCase() +
                "</div>"
              );
            })
            .join("");
      } else if (
        (state.phase === "reveal" || state.phase === "frozen" || state.phase === "goal") &&
        state.revealPlans
      ) {
        const risky = [];
        Object.keys(state.revealPlans).forEach(function (id) {
          const p = state.revealPlans[id];
          const t = riskTableFor(p && p.type);
          if (!t) return;
          const from = (state.revealFrom || []).find(function (x) {
            return x.id === id;
          }) || getUnit(id);
          risky.push({ from: from, plan: p, table: t });
        });
        if (risky.length) {
          risk.hidden = false;
          risk.innerHTML = risky
            .map(function (item) {
              return (
                '<div class="risk-title">' +
                (item.from ? unitTitle(item.from) : "Player") +
                " · " +
                actionTitle(item.plan.type) +
                "</div>" +
                item.table
                  .map(function (row, i) {
                    return (
                      '<div class="' +
                      (i === 0 ? "risk-ok" : "risk-warn") +
                      '">' +
                      Math.round(row.chance * 100) +
                      "% " +
                      row.label.toUpperCase() +
                      "</div>"
                    );
                  })
                  .join("")
              );
            })
            .join("");
        } else {
          risk.hidden = true;
          risk.innerHTML = "";
        }
      } else {
        risk.hidden = true;
        risk.innerHTML = "";
      }
    }

    if (curveRow) {
      if (canPlan() && unit && unit.team === state.planningTeam && needsCurveDir(state.selectedAction)) {
        const plan = currentPlans()[unit.id];
        const currentDir = (plan && plan.curveDir) || state.pendingCurveDir || CURVE_DIR.LEFT;
        curveRow.hidden = false;
        curveRow.innerHTML = "";
        [CURVE_DIR.LEFT, CURVE_DIR.RIGHT].forEach(function (dir) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = "CURVE " + dir;
          if (currentDir === dir) btn.classList.add("active");
          btn.addEventListener("click", function () {
            state.pendingCurveDir = dir;
            setCurveDir(dir);
          });
          curveRow.appendChild(btn);
        });
      } else {
        curveRow.hidden = true;
        curveRow.innerHTML = "";
      }
    }

    const list = els.planList;
    list.innerHTML = "";
    if (state.phase === "planning" || state.phase === "cpu") {
      const team = state.phase === "cpu" ? humanTeam() : state.planningTeam;
      teamUnits(team).forEach(function (u) {
        const li = document.createElement("li");
        li.textContent = planLabel(u, state.plans[team][u.id]);
        list.appendChild(li);
      });
    } else if (state.revealPlans) {
      state.units.forEach(function (u) {
        const from = (state.revealFrom || []).find((x) => x.id === u.id) || u;
        const li = document.createElement("li");
        li.textContent = planLabel(from, state.revealPlans[u.id]);
        list.appendChild(li);
      });
    }

    const log = els.log;
    log.innerHTML = "";
    (state.events || []).forEach(function (text, i) {
      const li = document.createElement("li");
      li.textContent = text;
      const kind = (state.eventKinds || [])[i];
      if (kind) li.className = kind;
      log.appendChild(li);
    });

    const lock = els.lock;
    lock.disabled = false;
    if (state.phase === "planning") {
      lock.textContent = "LOCK IN";
      lock.disabled = false;
    } else if (state.phase === "frozen") {
      lock.textContent = "NEXT ROUND";
      lock.disabled = false;
    } else if (state.phase === "gameover") {
      lock.textContent = "PLAY AGAIN";
      lock.disabled = false;
    } else {
      lock.textContent = "LOCK IN";
      lock.disabled = true;
    }
  }

  function renderHud() {
    const phase = phaseLabel();
    const turn = turnLabel();
    els.phase.textContent = phase === "PLANNING" || phase === "LOCKED" ? phase + " · " + turn.toUpperCase() : phase;
    els.turn.textContent = turn;
    els.scoreBlue.textContent = String(state.score.blue);
    els.scoreOrange.textContent = String(state.score.orange);
  }

  function render() {
    if (!state) return;
    renderHud();
    renderHighlights();
    renderPieces();
    renderArrows();
    renderSidebar();
  }

  function showOverlay(title, body, btn, onClick, altBtn, altClick, menuMode) {
    els.overlayTitle.textContent = title;
    els.overlayBody.textContent = body || "";
    els.overlayBtn.textContent = btn;
    els.overlay.dataset.mode = title;
    els.overlay.classList.toggle("menu-mode", !!menuMode);
    els.overlay.classList.remove("hidden");
    els.overlay.removeAttribute("hidden");
    els.overlay.setAttribute("aria-hidden", "false");
    els.overlayBtn.onclick = onClick;
    if (els.overlayBtnAlt) {
      if (altBtn && altClick) {
        els.overlayBtnAlt.hidden = false;
        els.overlayBtnAlt.textContent = altBtn;
        els.overlayBtnAlt.onclick = altClick;
      } else {
        els.overlayBtnAlt.hidden = true;
        els.overlayBtnAlt.onclick = null;
      }
    }
  }

  function hideOverlay() {
    els.overlay.classList.add("hidden");
    els.overlay.classList.remove("menu-mode");
    els.overlay.setAttribute("hidden", "");
    els.overlay.setAttribute("aria-hidden", "true");
    els.overlayBtn.onclick = null;
    if (els.overlayBtnAlt) {
      els.overlayBtnAlt.hidden = true;
      els.overlayBtnAlt.onclick = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer drag (draw an arrow toward a destination)
  // ---------------------------------------------------------------------------

  function cellFromEvent(e) {
    const rect = els.pitch.getBoundingClientRect();
    const cell = rect.width / SIZE;
    const c = Math.floor((e.clientX - rect.left) / cell);
    const r = Math.floor((e.clientY - rect.top) / cell);
    if (!inBounds(r, c)) return null;
    return { r, c };
  }

  function onPointerMove(e) {
    if (!drag || !canPlan()) return;
    const unit = getUnit(drag.unitId);
    if (!unit) return;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 8) drag.moved = true;
    if (!drag.moved) return;
    if (state.selectedAction !== ACTION.MOVE && state.selectedAction !== ACTION.DRIBBLE && state.selectedAction !== ACTION.SPRINT) return;
    const cell = cellFromEvent(e);
    if (!cell) {
      state.previewDest = null;
      renderArrows();
      return;
    }
    const legal =
      state.selectedAction === ACTION.SPRINT
        ? isLegalSprint(unit, cell.r, cell.c, currentPlans())
        : isLegalDest(unit, cell.r, cell.c, currentPlans());
    state.previewDest = legal ? cell : null;
    renderArrows();
  }

  function onPointerUp(e) {
    if (!drag) return;
    const unit = getUnit(drag.unitId);
    const moved = drag.moved;
    const action = state.selectedAction;
    drag = null;
    if (!unit || !canPlan()) {
      state.previewDest = null;
      render();
      return;
    }
    if (moved && (action === ACTION.MOVE || action === ACTION.DRIBBLE || action === ACTION.SPRINT)) {
      const cell = cellFromEvent(e);
      if (cell) assignTravel(unit, cell.r, cell.c);
    }
    state.previewDest = null;
    render();
  }

  function bindUi() {
    els.lock.addEventListener("click", function () {
      if (state.phase === "planning") lockIn();
      else if (state.phase === "frozen") nextRound();
      else if (state.phase === "gameover") resetMatch();
    });
    els.clear.addEventListener("click", function () {
      const unit = selectedUnit();
      if (!unit || !canPlan()) return;
      clearPlan(unit);
      render();
    });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", render);
  }

  function cacheEls() {
    els.board = document.getElementById("board");
    els.pitch = document.getElementById("pitch");
    els.pieces = document.getElementById("pieces");
    els.arrows = document.getElementById("arrows");
    els.phase = document.getElementById("hud-phase");
    els.turn = document.getElementById("hud-turn");
    els.scoreBlue = document.getElementById("score-blue");
    els.scoreOrange = document.getElementById("score-orange");
    els.help = document.getElementById("selected-help");
    els.actions = document.getElementById("action-buttons");
    els.clear = document.getElementById("btn-clear");
    els.planList = document.getElementById("plan-list");
    els.log = document.getElementById("event-log");
    els.lock = document.getElementById("btn-lock");
    els.overlay = document.getElementById("overlay");
    els.overlayTitle = document.getElementById("overlay-title");
    els.overlayBody = document.getElementById("overlay-body");
    els.overlayBtn = document.getElementById("overlay-btn");
    els.overlayBtnAlt = document.getElementById("overlay-btn-alt");
    els.goalBanner = document.getElementById("goal-banner");
    els.riskPanel = document.getElementById("risk-panel");
    els.curveDirRow = document.getElementById("curve-dir-row");
  }

  function init() {
    cacheEls();
    buildBoard();
    bindUi();
    assertRiskTables();
    showMainMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
