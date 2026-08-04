import { describe, expect, it } from "vitest";
import { ARENA_LIMIT, BLOCK_DURATION, HIT_EFFECT_DURATION, createGame, setPaused, tickGame } from "./simulation";

function inertGame() {
  const game = createGame(["jens", "fia", "peter"], "jens", 42);
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

  it("enters sudden death on a tied timer and ends on the next point", () => {
    const game = inertGame();
    game.timeLeft = 0.005;
    const suddenDeath = tickGame(game, 1 / 60);
    expect(suddenDeath.suddenDeath).toBe(true);
    expect(suddenDeath.phase).toBe("playing");

    suddenDeath.fighters[0].action = "kick";
    suddenDeath.fighters[0].actionTime = 0.335;
    suddenDeath.fighters[0].x = 0;
    suddenDeath.fighters[1].x = 1;
    suddenDeath.fighters[1].invulnerable = 0;
    const result = tickGame(suddenDeath, 1 / 60);
    expect(result.phase).toBe("result");
    expect(result.winnerId).toBe("player");
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
