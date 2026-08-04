"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { EffectComposer } from "@react-three/postprocessing";
import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { ACTION_ANIMATION, ANIMATIONS, CHARACTERS, type CharacterDefinition } from "../game/config";
import {
  FIXED_STEP,
  KNOCKDOWN_DURATION,
  createGame,
  setPaused,
  tickGame,
  type FighterAction,
  type FighterState,
  type GameState,
  type HitEffect,
  type HitRegion,
  type InputFrame,
} from "../game/simulation";

const EMPTY_INPUT: InputFrame = {};
const clipCache = new Map<string, Promise<THREE.AnimationClip>>();

function loadClip(url: string) {
  const cached = clipCache.get(url);
  if (cached) return cached;
  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Animationen kunde inte laddas: ${url}`);
      return response.json();
    })
    .then((json) => THREE.AnimationClip.parse(json as Parameters<typeof THREE.AnimationClip.parse>[0]));
  clipCache.set(url, promise);
  return promise;
}

if (typeof window !== "undefined") {
  for (const character of CHARACTERS) useGLTF.preload(character.modelUrl);
  for (const animation of ANIMATIONS) void loadClip(animation.url);
}

export default function OfficeKarate() {
  const [selectedId, setSelectedId] = useState(CHARACTERS[0].id);
  const [game, setGame] = useState<GameState | null>(null);
  const [muted, setMuted] = useState(false);
  const keys = useRef(new Set<string>());
  const gameRef = useRef<GameState | null>(null);
  const audio = useArcadeAudio(muted);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSelectedId(readStoredCharacter());
      setMuted(readStoredMuted());
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s", "j", "k", "l", "escape"].includes(key)) {
        event.preventDefault();
      }
      if (key === "escape" && !event.repeat) {
        setGame((current) => current ? setPaused(current, current.phase !== "paused") : current);
        return;
      }
      keys.current.add(key);
    };
    const onKeyUp = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const onBlur = () => keys.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const gamePhase = game?.phase;
  useEffect(() => {
    if (gamePhase !== "playing") return;
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;

    const loop = (now: number) => {
      accumulator += Math.min((now - previous) / 1000, 0.1);
      previous = now;
      let current = gameRef.current;
      while (current && current.phase === "playing" && accumulator >= FIXED_STEP) {
        current = tickGame(current, FIXED_STEP, readInput(keys.current));
        accumulator -= FIXED_STEP;
      }
      if (current && current !== gameRef.current) {
        gameRef.current = current;
        setGame(current);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [gamePhase]);

  const newestHit = game?.hitEffects.at(-1);
  const newestHitId = newestHit?.id ?? 0;
  const newestHitRegion = newestHit?.region;
  const previousHitId = useRef(0);
  useEffect(() => {
    if (newestHitRegion && newestHitId > previousHitId.current) audio.hit(newestHitRegion);
    previousHitId.current = newestHitId;
  }, [audio, newestHitId, newestHitRegion]);

  const chooseCharacter = (id: string) => {
    setSelectedId(id);
    window.localStorage.setItem("office-karate-character", id);
    audio.select();
  };

  const startGame = useCallback(() => {
    const opponents = shuffle(CHARACTERS.filter((character) => character.id !== selectedId)).slice(0, 2);
    const nextGame = createGame([selectedId, ...opponents.map((character) => character.id)], selectedId, Date.now() >>> 0);
    previousHitId.current = 0;
    gameRef.current = nextGame;
    setGame(nextGame);
    audio.start();
    audio.select();
  }, [audio, selectedId]);

  const returnToMenu = () => {
    setGame(null);
    gameRef.current = null;
    keys.current.clear();
    audio.select();
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    window.localStorage.setItem("office-karate-muted", String(next));
  };

  const selectedCharacter = CHARACTERS.find((character) => character.id === selectedId) ?? CHARACTERS[0];
  const winner = game?.fighters.find((fighter) => fighter.id === game.winnerId);
  const winnerCharacter = winner ? CHARACTERS.find((character) => character.id === winner.characterId) : null;

  return (
    <main className="game-shell">
      <div className="mobile-gate" role="status">
        <span className="mobile-gate__kanji">空手</span>
        <h1>STÖRRE SKÄRM.<br />STÖRRE SLAG.</h1>
        <p>Office Karate spelas med tangentbord. Öppna sidan på en dator och utmana kontoret.</p>
      </div>

      <div className="crt" aria-hidden="true" />
      <header className="topbar">
        <div className="brand-chip">SIMMA LUGNT / 2026</div>
        <div className="topbar__right">
          <span className="status-dot" /> WEB ARCADE
          <button className="icon-button" type="button" onClick={toggleMute} aria-label={muted ? "Slå på ljud" : "Stäng av ljud"}>
            {muted ? "MUTE" : "SOUND"}
          </button>
        </div>
      </header>

      <section className="stage" aria-label="Office Karate spelplan">
        <GameCanvas game={game} previewCharacter={selectedCharacter} />

        {game && <HitFeedback effects={game.hitEffects} />}
        {game && <Scoreboard game={game} />}

        {!game && (
          <div className="menu-layer">
            <div className="title-lockup">
              <span className="eyebrow">SIMMA LUGNT PRESENTS</span>
              <h1><span>OFFICE</span><br />KARATE</h1>
              <p className="title-lockup__plus">+3</p>
              <p className="tagline">TRE KOLLEGOR. SEXTIO SEKUNDER.<br />NOLL VÄRDIGHET.</p>
            </div>

            <div className="select-panel">
              <div className="select-panel__heading">
                <span>SELECT PLAYER</span>
                <span>1P</span>
              </div>
              <div className="roster" role="list" aria-label="Välj karaktär">
                {CHARACTERS.map((character, index) => (
                  <button
                    key={character.id}
                    type="button"
                    className={`fighter-card ${character.id === selectedId ? "is-selected" : ""}`}
                    onClick={() => chooseCharacter(character.id)}
                    style={{ "--fighter-color": character.color } as React.CSSProperties}
                    aria-pressed={character.id === selectedId}
                  >
                    <span className="fighter-card__number">0{index + 1}</span>
                    <span className="fighter-card__name">{character.name}</span>
                  </button>
                ))}
              </div>
              <button className="start-button" type="button" onClick={startGame}>
                <span>START MATCH</span><span>▶</span>
              </button>
              <p className="match-note">Två motståndare väljs slumpmässigt.</p>
            </div>

            <Controls />
          </div>
        )}

        {game?.phase === "paused" && (
          <div className="modal-layer">
            <div className="arcade-modal">
              <span className="eyebrow">TIME OUT</span>
              <h2>PAUS</h2>
              <button type="button" className="start-button" onClick={() => setGame((current) => current ? setPaused(current, false) : current)}>
                <span>FORTSÄTT</span><span>▶</span>
              </button>
              <button type="button" className="text-button" onClick={returnToMenu}>AVSLUTA MATCH</button>
            </div>
          </div>
        )}

        {game?.phase === "result" && (
          <div className="modal-layer">
            <div className="arcade-modal result-modal">
              <span className="eyebrow">MATCH COMPLETE</span>
              <h2>{winnerCharacter?.name ?? "OAVGJORT"} WINS!</h2>
              <div className="final-scores">
                {[...game.fighters].sort((a, b) => b.score - a.score).map((fighter) => {
                  const character = CHARACTERS.find((entry) => entry.id === fighter.characterId);
                  return <span key={fighter.id}>{character?.name} <strong>{fighter.score}</strong></span>;
                })}
              </div>
              <button type="button" className="start-button" onClick={startGame}><span>REMATCH</span><span>↻</span></button>
              <button type="button" className="text-button" onClick={returnToMenu}>VÄLJ NY SPELARE</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function GameCanvas({ game, previewCharacter }: { game: GameState | null; previewCharacter: CharacterDefinition }) {
  const previewFighter: FighterState = {
    id: "preview",
    characterId: previewCharacter.id,
    control: "player",
    x: 2.7,
    y: 0,
    velocityY: 0,
    facing: -1,
    score: 0,
    action: "idle",
    actionTime: 0,
    cooldown: 0,
    invulnerable: 0,
    attackConnected: false,
    knockbackVelocity: 0,
    knockdownVariant: "back",
    lastHitRegion: null,
    aiThink: 0,
    aiTargetId: null,
    aiIntent: "approach",
  };
  const fighters = game?.fighters ?? [previewFighter];

  return (
    <Canvas
      className="game-canvas"
      camera={{ position: [0, 2.8, 11], fov: 36, near: 0.1, far: 60 }}
      dpr={[1, 1.25]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      shadows
    >
      <color attach="background" args={["#10142d"]} />
      <fog attach="fog" args={["#11152c", 13, 25]} />
      <ambientLight intensity={1.55} color="#8ea8ff" />
      <directionalLight position={[-4, 8, 7]} intensity={3.2} color="#ffe8b6" castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[5, 4, 3]} intensity={8} distance={10} color="#ee4e9b" />
      <Arena />
      <Suspense fallback={null}>
        {fighters.map((fighter) => (
          <FighterModel key={`${fighter.id}-${fighter.characterId}`} fighter={fighter} preview={!game} />
        ))}
      </Suspense>
      <EffectComposer multisampling={0}>
        <RetroEffect />
      </EffectComposer>
    </Canvas>
  );
}

function Arena() {
  return (
    <group>
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[13.5, 0.4, 4]} />
        <meshStandardMaterial color="#d8a557" roughness={0.82} />
      </mesh>
      {Array.from({ length: 13 }, (_, index) => (
        <mesh key={index} position={[-6 + index, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.035, 3.9]} />
          <meshBasicMaterial color="#8e5e3f" />
        </mesh>
      ))}
      <mesh position={[0, 2.65, -2.2]}>
        <planeGeometry args={[15, 5.6]} />
        <meshStandardMaterial color="#30265f" roughness={1} />
      </mesh>
      <mesh position={[0, 3.1, -2.1]}>
        <circleGeometry args={[1.15, 32]} />
        <meshBasicMaterial color="#ec467b" />
      </mesh>
      <mesh position={[0, 3.1, -2.04]}>
        <ringGeometry args={[0.56, 0.68, 32]} />
        <meshBasicMaterial color="#ffcf55" />
      </mesh>
      <mesh position={[-5.25, 1.3, -1.85]}>
        <boxGeometry args={[0.18, 2.7, 0.18]} />
        <meshStandardMaterial color="#161a39" />
      </mesh>
      <mesh position={[5.25, 1.3, -1.85]}>
        <boxGeometry args={[0.18, 2.7, 0.18]} />
        <meshStandardMaterial color="#161a39" />
      </mesh>
      <mesh position={[-5.25, 2.55, -1.75]}>
        <boxGeometry args={[1.15, 0.12, 0.12]} />
        <meshStandardMaterial color="#67d5d2" emissive="#0b5755" />
      </mesh>
      <mesh position={[5.25, 2.55, -1.75]}>
        <boxGeometry args={[1.15, 0.12, 0.12]} />
        <meshStandardMaterial color="#67d5d2" emissive="#0b5755" />
      </mesh>
    </group>
  );
}

function FighterModel({ fighter, preview }: { fighter: FighterState; preview: boolean }) {
  const definition = CHARACTERS.find((character) => character.id === fighter.characterId) ?? CHARACTERS[0];
  const { scene } = useGLTF(definition.modelUrl);
  const model = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const prepared = materials.map((sourceMaterial) => {
        const material = sourceMaterial.clone();
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissive.set("#2a2c42");
          material.emissiveIntensity = 0.72;
        }
        return material;
      });
      mesh.material = Array.isArray(mesh.material) ? prepared : prepared[0];
    });
    return clone;
  }, [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const actions = useRef(new Map<string, THREE.AnimationAction>());
  const currentAnimation = useRef<string | null>(null);
  const group = useRef<THREE.Group>(null);
  const fighterAction = useRef(fighter.action);

  useEffect(() => {
    fighterAction.current = fighter.action;
  }, [fighter.action]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(ANIMATIONS.map(async (animation) => {
      const source = await loadClip(animation.url);
      if (cancelled) return;
      const clip = prepareClipForModel(source, model);
      const action = mixer.clipAction(clip, model);
      action.setLoop(animation.loop ? THREE.LoopRepeat : THREE.LoopOnce, animation.loop ? Infinity : 1);
      action.clampWhenFinished = !animation.loop;
      actions.current.set(animation.id, action);
    })).then(() => {
      if (cancelled) return;
      const animationId = ACTION_ANIMATION[fighterAction.current];
      playAnimation(animationId, fighterAction.current, actions.current, currentAnimation);
    });
    return () => {
      cancelled = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [mixer, model]);

  useEffect(() => {
    const animationId = ACTION_ANIMATION[fighter.action];
    playAnimation(animationId, fighter.action, actions.current, currentAnimation);
  }, [fighter.action]);

  useFrame((_, delta) => {
    mixer.update(Math.min(delta, 0.05));
    if (!group.current) return;
    const pulse = Math.sin(performance.now() * 0.025);
    const knockdown = getKnockdownPose(fighter);
    group.current.rotation.set(knockdown.rotationX, knockdown.rotationY, knockdown.rotationZ);
    group.current.rotation.z += fighter.action === "hit" ? pulse * 0.045 : 0;
    group.current.position.set(knockdown.offsetX, fighter.action === "crouch" ? -0.34 : knockdown.offsetY, knockdown.offsetZ);
    group.current.scale.set(1, fighter.action === "crouch" ? 0.86 : 1, 1);
  });

  const facingRotation = fighter.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  return (
    <group position={[fighter.x, fighter.y, 0]}>
      <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.62, 24]} />
        <meshBasicMaterial color={definition.color} transparent opacity={preview ? 0.7 : 0.42} />
      </mesh>
      {fighter.action === "block" && (
        <mesh position={[fighter.facing * 0.62, 1.05, 0.05]} rotation={[0, 0, Math.PI / 2]}>
          <ringGeometry args={[0.28, 0.34, 12]} />
          <meshBasicMaterial color="#fff06a" transparent opacity={0.86} />
        </mesh>
      )}
      <group ref={group}>
        <primitive
          object={model}
          position={[0, definition.groundOffset, 0]}
          rotation={[0, facingRotation, 0]}
          scale={definition.scale}
        />
      </group>
    </group>
  );
}

function getKnockdownPose(fighter: FighterState) {
  const empty = { rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0 };
  if (fighter.action !== "knockdown") return empty;
  const fall = easeOutCubic(Math.min(fighter.actionTime / 0.42, 1));
  const settle = Math.sin(Math.min(fighter.actionTime / KNOCKDOWN_DURATION, 1) * Math.PI) * 0.08;

  switch (fighter.knockdownVariant) {
    case "back":
      return { ...empty, rotationZ: -fighter.facing * 1.18 * fall, offsetX: -fighter.facing * 0.2 * fall, offsetY: 0.14 * fall + settle };
    case "spin":
      return { ...empty, rotationY: fighter.facing * 2.45 * fall, rotationZ: -fighter.facing * 0.88 * fall, offsetZ: 0.26 * fall, offsetY: 0.2 * fall + settle };
    case "sweep":
      return { ...empty, rotationX: fighter.facing * 0.2 * fall, rotationZ: fighter.facing * 1.48 * fall, offsetX: fighter.facing * 0.16 * fall, offsetY: -0.08 * fall + settle };
  }
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function prepareClipForModel(source: THREE.AnimationClip, model: THREE.Object3D) {
  const clip = source.clone();
  clip.tracks = clip.tracks
    .filter((track) => model.getObjectByName(track.name.split(".")[0]))
    .map((track) => track.clone());
  const hips = model.getObjectByName("Hips");
  const hipTrack = clip.tracks.find((track) => track.name === "Hips.position") as THREE.VectorKeyframeTrack | undefined;
  if (hips && hipTrack) {
    const values = hipTrack.values;
    const startX = values[0];
    const startY = values[1];
    const startZ = values[2];
    for (let index = 0; index < values.length; index += 3) {
      values[index] = hips.position.x + (values[index] - startX) * 0.08;
      values[index + 1] = hips.position.y + (values[index + 1] - startY);
      values[index + 2] = hips.position.z + (values[index + 2] - startZ) * 0.08;
    }
  }
  return clip;
}

function playAnimation(
  animationId: string,
  fighterAction: FighterAction,
  actions: Map<string, THREE.AnimationAction>,
  current: React.MutableRefObject<string | null>,
) {
  if (current.current === animationId) return;
  const next = actions.get(animationId);
  if (!next) return;
  const previous = current.current ? actions.get(current.current) : undefined;
  previous?.fadeOut(0.1);
  next.reset().fadeIn(0.1).play();
  const targetDuration = fighterAction === "punch"
    ? 0.58
    : fighterAction === "kick"
      ? 0.82
      : fighterAction === "knockdown"
        ? KNOCKDOWN_DURATION
        : null;
  next.timeScale = targetDuration ? next.getClip().duration / targetDuration : 1;
  current.current = animationId;
}

function Scoreboard({ game }: { game: GameState }) {
  return (
    <div className="scoreboard">
      <div className="scoreboard__players">
        {game.fighters.map((fighter) => {
          const character = CHARACTERS.find((entry) => entry.id === fighter.characterId);
          const scoring = game.hitEffects.some((effect) => effect.attackerId === fighter.id);
          return (
            <div key={fighter.id} className={`score-pill ${fighter.control === "player" ? "is-player" : ""} ${scoring ? "is-scoring" : ""}`} style={{ "--fighter-color": character?.color } as React.CSSProperties}>
              <span>{fighter.control === "player" ? "1P" : "CPU"}</span>
              <strong>{character?.name}</strong>
              <b>{String(fighter.score).padStart(2, "0")}</b>
            </div>
          );
        })}
      </div>
      <div className={`timer ${game.suddenDeath ? "is-danger" : ""}`}>
        <span>{game.suddenDeath ? "SUDDEN" : "TIME"}</span>
        <strong>{game.suddenDeath ? "DEATH" : Math.ceil(game.timeLeft).toString().padStart(2, "0")}</strong>
      </div>
    </div>
  );
}

function HitFeedback({ effects }: { effects: HitEffect[] }) {
  return (
    <div className="hit-feedback-layer" aria-live="polite">
      {effects.map((effect) => {
        const left = 8 + ((effect.x + 5.6) / 11.2) * 84;
        const top = effect.region === "high" ? 43 : effect.region === "mid" ? 51 : 60;
        const label = effect.region === "high" ? "BONK!" : effect.region === "mid" ? "POW!" : "SWEEP!";
        return (
          <div
            key={effect.id}
            className={`hit-feedback hit-feedback--${effect.region}`}
            style={{
              "--hit-left": `${left}%`,
              "--hit-top": `${top}%`,
            } as React.CSSProperties}
          >
            <span className="hit-feedback__burst" />
            <strong>+1</strong>
            <small>{label}</small>
          </div>
        );
      })}
    </div>
  );
}

function Controls() {
  return (
    <div className="controls-panel">
      <span className="controls-panel__label">CONTROLS</span>
      <div><kbd>A</kbd><kbd>D</kbd><span>MOVE</span></div>
      <div><kbd>W</kbd><span>JUMP</span></div>
      <div><kbd>S</kbd><span>DUCK</span></div>
      <div><kbd>J</kbd><span>PUNCH</span></div>
      <div><kbd>K</kbd><span>KICK</span></div>
      <div><kbd>L</kbd><span>BLOCK</span></div>
      <div><kbd>ESC</kbd><span>PAUSE</span></div>
    </div>
  );
}

class PixelEffectImpl extends Effect {
  constructor() {
    super("OfficeKarateRetro", `
      const float levels = 7.0;
      const float matrix[16] = float[16](
        0.0, 8.0, 2.0, 10.0,
        12.0, 4.0, 14.0, 6.0,
        3.0, 11.0, 1.0, 9.0,
        15.0, 7.0, 13.0, 5.0
      );
      void mainImage(const in vec4 color, const in vec2 uv, out vec4 outputColor) {
        vec2 lowRes = vec2(480.0, 270.0);
        vec2 pixelUv = floor(uv * lowRes) / lowRes;
        vec3 sampled = texture2D(inputBuffer, pixelUv).rgb;
        int x = int(mod(gl_FragCoord.x, 4.0));
        int y = int(mod(gl_FragCoord.y, 4.0));
        float threshold = (matrix[y * 4 + x] / 16.0 - 0.5) * 0.08;
        sampled = pow(sampled, vec3(0.82)) * 1.08 + 0.025;
        sampled = floor(clamp(sampled + threshold, 0.0, 1.0) * levels) / levels;
        float scan = 0.94 + 0.06 * step(1.0, mod(gl_FragCoord.y, 2.0));
        outputColor = vec4(sampled * scan, 1.0);
      }
    `, { blendFunction: BlendFunction.NORMAL });
  }
}

function RetroEffect() {
  const effect = useMemo(() => new PixelEffectImpl(), []);
  return <primitive object={effect} />;
}

function readInput(keys: Set<string>): InputFrame {
  if (!keys.size) return EMPTY_INPUT;
  return {
    left: keys.has("a") || keys.has("arrowleft"),
    right: keys.has("d") || keys.has("arrowright"),
    jump: keys.has("w") || keys.has("arrowup"),
    crouch: keys.has("s") || keys.has("arrowdown"),
    punch: keys.has("j"),
    kick: keys.has("k"),
    block: keys.has("l"),
  };
}

function readStoredCharacter() {
  if (typeof window === "undefined") return CHARACTERS[0].id;
  const stored = window.localStorage.getItem("office-karate-character");
  return stored && CHARACTERS.some((character) => character.id === stored)
    ? stored
    : CHARACTERS[0].id;
}

function readStoredMuted() {
  return typeof window !== "undefined"
    && window.localStorage.getItem("office-karate-muted") === "true";
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

function useArcadeAudio(muted: boolean) {
  const context = useRef<AudioContext | null>(null);
  const master = useRef<GainNode | null>(null);
  const musicTimer = useRef<number | null>(null);
  const step = useRef(0);

  const ensure = useCallback(() => {
    if (!context.current) {
      context.current = new AudioContext();
      master.current = context.current.createGain();
      master.current.gain.value = muted ? 0 : 0.16;
      master.current.connect(context.current.destination);
    }
    void context.current.resume();
    return context.current;
  }, [muted]);

  useEffect(() => {
    if (master.current) master.current.gain.value = muted ? 0 : 0.16;
  }, [muted]);

  useEffect(() => () => {
    if (musicTimer.current) window.clearInterval(musicTimer.current);
    void context.current?.close();
  }, []);

  const tone = useCallback((frequency: number, duration: number, type: OscillatorType, gain = 0.28) => {
    if (muted) return;
    const ctx = ensure();
    if (!master.current) return;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    envelope.gain.setValueAtTime(gain, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.connect(envelope);
    envelope.connect(master.current);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  }, [ensure, muted]);

  const start = useCallback(() => {
    ensure();
    if (musicTimer.current) return;
    const notes = [110, 130.81, 146.83, 164.81, 146.83, 196, 164.81, 130.81];
    musicTimer.current = window.setInterval(() => {
      tone(notes[step.current % notes.length], 0.13, "square", 0.16);
      if (step.current % 4 === 0) tone(55, 0.08, "triangle", 0.22);
      step.current += 1;
    }, 180);
  }, [ensure, tone]);

  return useMemo(() => ({
    start,
    select: () => tone(440, 0.055, "square", 0.2),
    hit: (region: HitRegion) => {
      const first = region === "high" ? 126 : region === "mid" ? 92 : 68;
      const second = region === "high" ? 74 : region === "mid" ? 58 : 44;
      tone(first, 0.14, "sawtooth", 0.42);
      window.setTimeout(() => tone(second, 0.13, "square", 0.3), 35);
    },
  }), [start, tone]);
}
