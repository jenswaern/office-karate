import { describe, expect, it } from "vitest";
import { ARENA_LIMIT, BLOCK_DURATION, HIT_EFFECT_DURATION, MATCH_INTRO_DURATION, createGame, setPaused, tickGame } from "./simulation";

function inertGame() {
  const game = createGame(["jens", "fia", "peter"], "jens", 42);
  game.introTime = 0;
  for (const fighter of game.fighters) {
    fighter.control = "player";
    fighter.action = "knockdown";
    fighter.actionTime = 0;
  }
  return game;
}

describe("Office Karate simulation", () => {
  it("creates one player and two unique CPU fighters", () => {
    const game = createGame(["jens", "fia", "peter"], "jens");
    expect(game.fighters.map((fighter) => fighter.characterId)).toEqual(["jens", "fia", "peter"]);
    expect(game.fighters.filter((fighter) => fighter.control === "player")).toHaveLength(1);
    expect(game.fighters.filter((fighter) => fighter.control === "ai")).toHaveLength(2);
  });

  it("bows before enabling controls and starting the match timer", () => {
    const game = createGame(["jens", "fia", "peter"], "jens", 42);
    const startingPositions = game.fighters.map((fighter) => fighter.x);
    expect(game.introTime).toBe(MATCH_INTRO_DURATION);
    expect(game.fighters.every((fighter) => fighter.action === "bow")).toBe(true);

    let intro = tickGame(game, 0.5, { right: true, punch: true });
    expect(intro.timeLeft).toBe(60);
    expect(intro.fighters.map((fighter) => fighter.x)).toEqual(startingPositions);
    expect(intro.fighters.every((fighter) => fighter.action === "bow")).toBe(true);

    while (intro.introTime > 0) intro = tickGame(intro, 0.05, { right: true, punch: true });
    expect(intro.timeLeft).toBe(60);
    expect(intro.fighters.every((fighter) => fighter.action === "idle")).toBe(true);

    const playing = tickGame(intro, 1 / 60, { right: true });
    expect(playing.timeLeft).toBeLessThan(60);
    expect(playing.fighters[0].x).toBeGreaterThan(startingPositions[0]);
  });

  it("scores only once during a connected attack", () => {
    const game = inertGame();
    const attacker = game.fighters[0];
    const target = game.fighters[1];
    attacker.action = "punch";
    attacker.actionTime = 0.195;
    attacker.x = 0;
    attacker.facing = 1;
    target.x = 0.9;
    target.invulnerable = 0;

    const afterHit = tickGame(game, 1 / 60);
    expect(afterHit.fighters[0].score).toBe(1);
    expect(afterHit.fighters[0].attackConnected).toBe(true);
    expect(afterHit.fighters[1].action).toBe("knockdown");
    expect(afterHit.fighters[1].lives).toBe(2);
    expect(afterHit.fighters[1].knockedOut).toBe(false);
    expect(afterHit.fighters[1].knockdownVariant).toBe("back");
    expect(afterHit.fighters[1].lastHitRegion).toBe("high");
    expect(afterHit.hitEffects).toMatchObject([
      { kind: "hit", attackerId: "player", targetId: "cpu-1", region: "high", age: 0 },
    ]);

    const afterSecondTick = tickGame(afterHit, 1 / 60);
    expect(afterSecondTick.fighters[0].score).toBe(1);
  });

  it("uses different falls for body and low hits", () => {
    const bodyGame = inertGame();
    bodyGame.fighters[0].action = "kick";
    bodyGame.fighters[0].actionTime = 0.335;
    bodyGame.fighters[0].x = 0;
    bodyGame.fighters[1].x = 1;
    const bodyHit = tickGame(bodyGame, 1 / 60);
    expect(bodyHit.fighters[1].lastHitRegion).toBe("mid");
    expect(bodyHit.fighters[1].knockdownVariant).toBe("dying");

    const lowGame = inertGame();
    lowGame.fighters[0].action = "kick";
    lowGame.fighters[0].actionTime = 0.335;
    lowGame.fighters[0].x = 0;
    lowGame.fighters[1].action = "crouch";
    lowGame.fighters[1].x = 1;
    const lowHit = tickGame(lowGame, 1 / 60, { crouch: true });
    expect(lowHit.fighters[1].lastHitRegion).toBe("low");
    expect(lowHit.fighters[1].knockdownVariant).toBe("sweep");
  });

  it("expires hit feedback and keeps a fallen fighter action-locked", () => {
    const game = inertGame();
    const target = game.fighters[1];
    target.action = "knockdown";
    target.actionTime = 0.1;
    game.hitEffects.push({ id: 1, kind: "hit", attackerId: "player", targetId: target.id, x: 0, region: "mid", age: 0 });

    const locked = tickGame(game, 1 / 60, { punch: true, right: true });
    expect(locked.fighters[1].action).toBe("knockdown");

    let expired = locked;
    for (let elapsed = 0; elapsed < HIT_EFFECT_DURATION + 0.1; elapsed += 1 / 60) {
      expired = tickGame(expired, 1 / 60);
    }
    expect(expired.hitEffects).toHaveLength(0);
  });

  it("does not score through a correctly faced block", () => {
    const game = inertGame();
    const attacker = game.fighters[0];
    const target = game.fighters[1];
    attacker.action = "punch";
    attacker.actionTime = 0.195;
    attacker.x = 0;
    target.action = "block";
    target.x = 0.9;
    target.facing = -1;

    const next = tickGame(game, 1 / 60, { block: true });
    expect(next.fighters[0].score).toBe(0);
    expect(next.fighters[0].attackConnected).toBe(true);
    expect(next.hitEffects).toMatchObject([
      { kind: "blocked", attackerId: "player", targetId: "cpu-1" },
    ]);
  });

  it("limits block to one second and requires a new button press", () => {
    const game = inertGame();
    game.fighters[0].action = "idle";

    let next = tickGame(game, 1 / 60, { block: true });
    expect(next.fighters[0].action).toBe("block");

    for (let elapsed = 0; elapsed < BLOCK_DURATION + 0.1; elapsed += 1 / 60) {
      next = tickGame(next, 1 / 60, { block: true });
    }
    expect(next.fighters[0].action).toBe("idle");

    next = tickGame(next, 1 / 60, { block: false });
    next = tickGame(next, 1 / 60, { block: true });
    expect(next.fighters[0].action).toBe("block");
  });

  it("plays one jump action for the full airborne arc", () => {
    const game = inertGame();
    game.fighters[0].action = "idle";

    let next = tickGame(game, 1 / 60, { jump: true });
    expect(next.fighters[0].action).toBe("jump");
    expect(next.fighters[0].y).toBeGreaterThan(0);

    for (let elapsed = 0; elapsed < 1; elapsed += 1 / 60) {
      next = tickGame(next, 1 / 60);
    }
    expect(next.fighters[0].action).toBe("idle");
    expect(next.fighters[0].y).toBe(0);
  });

  it("keeps a knocked-out fighter down and ends when only one fighter remains", () => {
    const game = inertGame();
    const attacker = game.fighters[0];
    const target = game.fighters[1];
    const alreadyOut = game.fighters[2];
    attacker.action = "punch";
    attacker.actionTime = 0.195;
    attacker.x = 0;
    target.action = "idle";
    target.x = 0.9;
    target.lives = 1;
    alreadyOut.lives = 0;
    alreadyOut.knockedOut = true;

    const result = tickGame(game, 1 / 60);
    expect(result.phase).toBe("result");
    expect(result.winnerId).toBe(attacker.id);
    expect(result.fighters[1]).toMatchObject({ lives: 0, knockedOut: true, action: "knockdown" });
    expect(result.fighters[2]).toMatchObject({ lives: 0, knockedOut: true, action: "knockdown" });
    expect(result.hitEffects.at(-1)?.kind).toBe("ko");

    const frozen = tickGame(result, 5, { punch: true });
    expect(frozen).toBe(result);
    expect(frozen.fighters[1].action).toBe("knockdown");
  });

  it("continues after the first KO while two fighters remain", () => {
    const game = inertGame();
    const attacker = game.fighters[0];
    const target = game.fighters[1];
    attacker.action = "kick";
    attacker.actionTime = 0.335;
    attacker.x = 0;
    target.action = "idle";
    target.x = 1;
    target.lives = 1;

    const next = tickGame(game, 1 / 60);
    expect(next.phase).toBe("playing");
    expect(next.fighters[1].knockedOut).toBe(true);
    expect(next.fighters.filter((fighter) => !fighter.knockedOut)).toHaveLength(2);
  });

  it("ignores KO fighters when choosing an attack target", () => {
    const game = inertGame();
    const attacker = game.fighters[0];
    const knockedOut = game.fighters[1];
    const active = game.fighters[2];
    attacker.action = "punch";
    attacker.actionTime = 0.195;
    attacker.x = 0;
    knockedOut.x = 0.5;
    knockedOut.lives = 0;
    knockedOut.knockedOut = true;
    active.x = 1;

    const next = tickGame(game, 1 / 60);
    expect(next.fighters[1].lives).toBe(0);
    expect(next.fighters[2].lives).toBe(2);
  });

  it("ends when time runs out and uses remaining lives as the score tiebreaker", () => {
    const game = inertGame();
    game.fighters[0].score = 2;
    game.fighters[0].lives = 1;
    game.fighters[1].score = 2;
    game.fighters[1].lives = 2;
    game.timeLeft = 0.005;
    const result = tickGame(game, 1 / 60);
    expect(result.phase).toBe("result");
    expect(result.timeLeft).toBe(0);
    expect(result.winnerId).toBe("cpu-1");
  });

  it("freezes while paused", () => {
    const game = setPaused(createGame(["jens", "fia", "peter"], "jens"), true);
    const next = tickGame(game, 1, { right: true, punch: true });
    expect(next).toBe(game);
    expect(next.timeLeft).toBe(60);
  });

  it("keeps fighters inside the arena but allows them to pass through each other", () => {
    const game = inertGame();
    game.fighters[0].x = ARENA_LIMIT + 4;
    game.fighters[1].x = 0;
    game.fighters[2].x = 0;
    const next = tickGame(game, 1 / 60);
    expect(next.fighters[0].x).toBeLessThanOrEqual(ARENA_LIMIT);
    expect(next.fighters[1].x).toBe(next.fighters[2].x);
  });

  it("lets a moving fighter cross an opponent's position", () => {
    const game = inertGame();
    game.fighters[0].action = "idle";
    game.fighters[0].x = -0.04;
    game.fighters[1].x = 0;
    game.fighters[2].x = 4;
    const crossed = tickGame(game, 0.05, { right: true });
    expect(crossed.fighters[0].x).toBeGreaterThan(crossed.fighters[1].x);
  });
});
