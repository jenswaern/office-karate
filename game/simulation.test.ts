import { describe, expect, it } from "vitest";
import { ARENA_LIMIT, createGame, setPaused, tickGame } from "./simulation";

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

    const afterSecondTick = tickGame(afterHit, 1 / 60);
    expect(afterSecondTick.fighters[0].score).toBe(1);
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

  it("keeps fighters inside the arena and separates grounded overlaps", () => {
    const game = inertGame();
    game.fighters[0].x = ARENA_LIMIT + 4;
    game.fighters[1].x = 0;
    game.fighters[2].x = 0;
    const next = tickGame(game, 1 / 60);
    expect(next.fighters[0].x).toBeLessThanOrEqual(ARENA_LIMIT);
    expect(Math.abs(next.fighters[1].x - next.fighters[2].x)).toBeGreaterThanOrEqual(0.73);
  });
});
