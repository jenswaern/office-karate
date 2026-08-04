export const MATCH_SECONDS = 60;
export const MATCH_INTRO_DURATION = 2.4;
export const PUNCH_ACTION_DURATION = 0.46;
export const KICK_ACTION_DURATION = 0.66;
export const ARENA_LIMIT = 5.6;
export const FIXED_STEP = 1 / 60;
export const KNOCKDOWN_DURATION = 2;
export const BLOCK_DURATION = 1;
export const HIT_EFFECT_DURATION = 0.68;
export const JUMP_VELOCITY = 5.1;
export const JUMP_GRAVITY = 12.4;
export const JUMP_DURATION = (JUMP_VELOCITY * 2) / JUMP_GRAVITY;
export const MAX_LIVES = 3;

export type HitRegion = "high" | "mid" | "low";
export type KnockdownVariant = "back" | "dying" | "sweep";

export type FighterAction =
  | "idle"
  | "bow"
  | "walk"
  | "jump"
  | "crouch"
  | "punch"
  | "kick"
  | "block"
  | "hit"
  | "knockdown"
  | "victory";

export type InputFrame = {
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  crouch?: boolean;
  punch?: boolean;
  kick?: boolean;
  block?: boolean;
};

type AiIntent = "approach" | "retreat" | "punch" | "kick" | "block";

export type FighterState = {
  id: string;
  characterId: string;
  control: "player" | "ai";
  x: number;
  y: number;
  velocityY: number;
  facing: -1 | 1;
  score: number;
  lives: number;
  knockedOut: boolean;
  action: FighterAction;
  actionTime: number;
  cooldown: number;
  invulnerable: number;
  attackConnected: boolean;
  blockInputHeld: boolean;
  knockbackVelocity: number;
  knockdownVariant: KnockdownVariant;
  lastHitRegion: HitRegion | null;
  aiThink: number;
  aiTargetId: string | null;
  aiIntent: AiIntent;
};

export type HitEffect = {
  id: number;
  kind: "hit" | "blocked" | "ko";
  attack?: "punch" | "kick";
  attackerFacing?: -1 | 1;
  attackerId: string;
  targetId: string;
  x: number;
  region: HitRegion;
  age: number;
};

export type GameState = {
  phase: "playing" | "paused" | "result";
  introTime: number;
  timeLeft: number;
  winnerId: string | null;
  fighters: FighterState[];
  hitEffects: HitEffect[];
  nextHitEffectId: number;
  seed: number;
};

const ACTION_DURATION: Partial<Record<FighterAction, number>> = {
  punch: PUNCH_ACTION_DURATION,
  kick: KICK_ACTION_DURATION,
  block: BLOCK_DURATION,
  hit: 0.42,
  knockdown: KNOCKDOWN_DURATION,
};

const ATTACKS = {
  punch: { from: 0.2, to: 0.32, reach: 1.22 },
  kick: { from: 0.34, to: 0.5, reach: 1.68 },
} as const;

export function createGame(characterIds: string[], playerCharacterId: string, seed = 8675309): GameState {
  const ordered = [
    playerCharacterId,
    ...characterIds.filter((id) => id !== playerCharacterId),
  ].slice(0, 3);
  const positions = [-3.1, 0, 3.1];

  return {
    phase: "playing",
    introTime: MATCH_INTRO_DURATION,
    timeLeft: MATCH_SECONDS,
    winnerId: null,
    seed,
    hitEffects: [],
    nextHitEffectId: 1,
    fighters: ordered.map((characterId, index) => ({
      id: index === 0 ? "player" : `cpu-${index}`,
      characterId,
      control: index === 0 ? "player" : "ai",
      x: positions[index],
      y: 0,
      velocityY: 0,
      facing: index === 2 ? -1 : 1,
      score: 0,
      lives: MAX_LIVES,
      knockedOut: false,
      action: "bow",
      actionTime: 0,
      cooldown: index * 0.15,
      invulnerable: 0,
      attackConnected: false,
      blockInputHeld: false,
      knockbackVelocity: 0,
      knockdownVariant: "back",
      lastHitRegion: null,
      aiThink: 0.15 + index * 0.12,
      aiTargetId: index === 1 ? "cpu-2" : "cpu-1",
      aiIntent: "approach",
    })),
  };
}

export function setPaused(state: GameState, paused: boolean): GameState {
  if (state.phase === "result") return state;
  return { ...state, phase: paused ? "paused" : "playing" };
}

export function tickGame(
  state: GameState,
  dt: number,
  playerInput: InputFrame = {},
): GameState {
  if (state.phase !== "playing") return state;

  const next = structuredClone(state);
  const step = Math.min(dt, 0.05);

  if (next.introTime > 0) {
    next.introTime = Math.max(0, next.introTime - step);
    for (const fighter of next.fighters) {
      fighter.action = next.introTime > 0 ? "bow" : "idle";
      fighter.actionTime = next.introTime > 0 ? fighter.actionTime + step : 0;
    }
    return next;
  }

  next.hitEffects = next.hitEffects
    .map((effect) => ({ ...effect, age: effect.age + step }))
    .filter((effect) => effect.age < HIT_EFFECT_DURATION);

  next.timeLeft = Math.max(0, next.timeLeft - step);

  for (const fighter of next.fighters) {
    if (fighter.knockedOut) {
      fighter.action = "knockdown";
      fighter.actionTime = Math.min(fighter.actionTime + step, KNOCKDOWN_DURATION);
      fighter.velocityY = 0;
      fighter.knockbackVelocity = 0;
      continue;
    }
    fighter.cooldown = Math.max(0, fighter.cooldown - step);
    fighter.invulnerable = Math.max(0, fighter.invulnerable - step);
    fighter.actionTime += step;
    updateFacing(fighter, next.fighters);

    const input = fighter.control === "player"
      ? playerInput
      : updateAiAndGetInput(fighter, next, step);
    updateFighter(fighter, input, step);
  }

  resolveAttacks(next);
  if (next.phase !== "playing") return next;

  if (next.timeLeft <= 0) {
    finishGame(next, winnerAtTime(next.fighters));
  }

  return next;
}

function updateFighter(fighter: FighterState, input: InputFrame, dt: number) {
  const blockPressed = Boolean(input.block) && !fighter.blockInputHeld;
  fighter.blockInputHeld = Boolean(input.block);

  const duration = ACTION_DURATION[fighter.action];
  if (duration && fighter.actionTime >= duration) {
    const completedAction = fighter.action;
    fighter.action = "idle";
    fighter.actionTime = 0;
    fighter.attackConnected = false;
    if ((completedAction === "punch" || completedAction === "kick") && fighter.control === "ai") {
      fighter.cooldown = Math.max(fighter.cooldown, 1.6);
    }
  }

  const locked = fighter.action === "punch"
    || fighter.action === "kick"
    || fighter.action === "block"
    || fighter.action === "hit"
    || fighter.action === "knockdown"
    || fighter.action === "victory";

  if (Math.abs(fighter.knockbackVelocity) > 0.01) {
    fighter.x += fighter.knockbackVelocity * dt;
    fighter.knockbackVelocity *= Math.pow(0.055, dt);
  } else {
    fighter.knockbackVelocity = 0;
  }

  if (!locked) {
    if (input.punch && fighter.cooldown <= 0) beginAction(fighter, "punch", 0.12);
    else if (input.kick && fighter.cooldown <= 0) beginAction(fighter, "kick", 0.18);
    else if (input.jump && fighter.y <= 0.001) {
      fighter.velocityY = JUMP_VELOCITY;
      beginAction(fighter, "jump", 0.08);
    } else if (blockPressed) beginAction(fighter, "block");
    else if (input.crouch && fighter.y <= 0.001) beginAction(fighter, "crouch");
    else {
      const direction = Number(Boolean(input.right)) - Number(Boolean(input.left));
      if (direction !== 0) {
        fighter.x += direction * 2.65 * dt;
        fighter.facing = direction > 0 ? 1 : -1;
        if (fighter.y <= 0.001) beginAction(fighter, "walk");
      } else if (fighter.y <= 0.001) beginAction(fighter, "idle");
    }
  }

  if (fighter.y > 0 || fighter.velocityY > 0) {
    fighter.velocityY -= JUMP_GRAVITY * dt;
    fighter.y += fighter.velocityY * dt;
    if (fighter.y <= 0) {
      fighter.y = 0;
      fighter.velocityY = 0;
      if (fighter.action === "jump") beginAction(fighter, "idle");
    } else if (!locked) {
      fighter.action = "jump";
    }
  }

  fighter.x = clamp(fighter.x, -ARENA_LIMIT, ARENA_LIMIT);
}

function beginAction(fighter: FighterState, action: FighterAction, cooldown = 0) {
  if (fighter.action !== action) fighter.actionTime = 0;
  fighter.action = action;
  fighter.cooldown = Math.max(fighter.cooldown, cooldown);
  if (action === "punch" || action === "kick") fighter.attackConnected = false;
}

function resolveAttacks(state: GameState) {
  for (const attacker of state.fighters) {
    if (attacker.knockedOut) continue;
    if (attacker.action !== "punch" && attacker.action !== "kick") continue;
    if (attacker.attackConnected) continue;
    const attack = ATTACKS[attacker.action];
    if (attacker.actionTime < attack.from || attacker.actionTime > attack.to) continue;

    const target = state.fighters
      .filter((fighter) => fighter.id !== attacker.id && !fighter.knockedOut && fighter.invulnerable <= 0)
      .filter((fighter) => Math.abs(fighter.x - attacker.x) <= attack.reach)
      .filter((fighter) => fighter.y < 1.15)
      .sort((a, b) => Math.abs(a.x - attacker.x) - Math.abs(b.x - attacker.x))[0];

    if (!target) continue;
    attacker.attackConnected = true;

    const targetIsFacing = Math.sign(attacker.x - target.x) === target.facing;
    if (target.action === "block" && targetIsFacing) {
      attacker.cooldown = Math.max(attacker.cooldown, 0.28);
      state.hitEffects.push({
        id: state.nextHitEffectId,
        kind: "blocked",
        attack: attacker.action === "kick" ? "kick" : "punch",
        attackerFacing: attacker.facing,
        attackerId: attacker.id,
        targetId: target.id,
        x: target.x,
        region: resolveHitRegion(attacker, target),
        age: 0,
      });
      state.nextHitEffectId += 1;
      continue;
    }

    const region = resolveHitRegion(attacker, target);
    const direction = target.x >= attacker.x ? 1 : -1;
    const response = hitResponse(region);

    attacker.score += 1;
    target.lives = Math.max(0, target.lives - 1);
    target.knockedOut = target.lives === 0;
    target.invulnerable = KNOCKDOWN_DURATION - 0.1;
    target.velocityY = response.lift;
    target.knockbackVelocity = direction * response.knockback;
    target.knockdownVariant = response.variant;
    target.lastHitRegion = region;
    beginAction(target, "knockdown", 0.34);
    state.hitEffects.push({
      id: state.nextHitEffectId,
      kind: target.knockedOut ? "ko" : "hit",
      attack: attacker.action === "kick" ? "kick" : "punch",
      attackerFacing: attacker.facing,
      attackerId: attacker.id,
      targetId: target.id,
      x: target.x - direction * 0.22,
      region,
      age: 0,
    });
    state.nextHitEffectId += 1;

    const active = state.fighters.filter((fighter) => !fighter.knockedOut);
    if (active.length === 1) {
      finishGame(state, active[0].id);
      return;
    }
  }
}

function updateFacing(fighter: FighterState, fighters: FighterState[]) {
  if (fighter.knockedOut) return;
  if (fighter.action === "punch"
    || fighter.action === "kick"
    || fighter.action === "hit"
    || fighter.action === "knockdown"
    || fighter.action === "victory") return;
  const target = nearestOpponent(fighter, fighters);
  if (target && Math.abs(target.x - fighter.x) > 0.08) {
    fighter.facing = target.x > fighter.x ? 1 : -1;
  }
}

function updateAiAndGetInput(fighter: FighterState, state: GameState, dt: number): InputFrame {
  fighter.aiThink -= dt;
  let target = state.fighters.find((candidate) => candidate.id === fighter.aiTargetId && !candidate.knockedOut);

  if (fighter.aiThink <= 0 || !target) {
    const targetingPlayer = state.fighters.some(
      (candidate) => candidate.id !== fighter.id
        && !candidate.knockedOut
        && candidate.control === "ai"
        && candidate.aiTargetId === "player",
    );
    const candidates = state.fighters.filter((candidate) => candidate.id !== fighter.id && !candidate.knockedOut);
    target = candidates.sort((a, b) => {
      const scoreA = Math.abs(a.x - fighter.x) - a.score * 0.18
        + (a.id === "player" && targetingPlayer ? 1.4 : 0)
        + (a.action === "knockdown" ? 4 : 0);
      const scoreB = Math.abs(b.x - fighter.x) - b.score * 0.18
        + (b.id === "player" && targetingPlayer ? 1.4 : 0)
        + (b.action === "knockdown" ? 4 : 0);
      return scoreA - scoreB;
    })[0];
    fighter.aiTargetId = target.id;

    const distance = Math.abs(target.x - fighter.x);
    const random = nextRandom(state);
    fighter.aiIntent = distance > 1.55
      ? "approach"
      : distance < 0.68
        ? (random < 0.55 ? "retreat" : "block")
        : random < 0.42
          ? "punch"
          : random < 0.78
            ? "kick"
            : "block";
    fighter.aiThink = 0.24 + nextRandom(state) * 0.46;
  }

  if (!target) return {};
  const targetOnRight = target.x > fighter.x;
  switch (fighter.aiIntent) {
    case "approach": return targetOnRight ? { right: true } : { left: true };
    case "retreat": return targetOnRight ? { left: true } : { right: true };
    case "punch": return { punch: true };
    case "kick": return { kick: true };
    case "block": return { block: true };
  }
}

function finishGame(state: GameState, winnerId: string | null) {
  state.phase = "result";
  state.winnerId = winnerId;
  for (const fighter of state.fighters) {
    if (fighter.knockedOut) {
      fighter.action = "knockdown";
      continue;
    }
    fighter.action = fighter.id === winnerId ? "victory" : "idle";
    fighter.actionTime = 0;
  }
}

function winnerAtTime(fighters: FighterState[]) {
  const active = fighters.filter((fighter) => !fighter.knockedOut);
  const highScore = Math.max(...active.map((fighter) => fighter.score));
  const scoreLeaders = active.filter((fighter) => fighter.score === highScore);
  if (scoreLeaders.length === 1) return scoreLeaders[0].id;
  const mostLives = Math.max(...scoreLeaders.map((fighter) => fighter.lives));
  const lifeLeaders = scoreLeaders.filter((fighter) => fighter.lives === mostLives);
  return lifeLeaders.length === 1 ? lifeLeaders[0].id : null;
}

function resolveHitRegion(attacker: FighterState, target: FighterState): HitRegion {
  if (target.action === "crouch") return attacker.action === "kick" ? "low" : "mid";
  if (target.y > 0.45) return attacker.action === "kick" ? "low" : "mid";
  return attacker.action === "punch" ? "high" : "mid";
}

function hitResponse(region: HitRegion): { variant: KnockdownVariant; lift: number; knockback: number } {
  switch (region) {
    case "high": return { variant: "back", lift: 0, knockback: 1.9 };
    case "mid": return { variant: "dying", lift: 0, knockback: 1.35 };
    case "low": return { variant: "sweep", lift: 0, knockback: 2.15 };
  }
}

function nearestOpponent(fighter: FighterState, fighters: FighterState[]) {
  return fighters
    .filter((candidate) => candidate.id !== fighter.id && !candidate.knockedOut)
    .sort((a, b) => Math.abs(a.x - fighter.x) - Math.abs(b.x - fighter.x))[0];
}

function nextRandom(state: GameState) {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
