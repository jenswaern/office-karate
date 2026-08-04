"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { EffectComposer } from "@react-three/postprocessing";
import { BlendFunction, Effect } from "postprocessing";
import * as THREE from "three";
import { SkeletonUtils } from "three-stdlib";
import { ACTION_ANIMATION, ANIMATIONS, CHARACTERS, type CharacterDefinition } from "../game/config";
import {
  FIXED_STEP,
  BLOCK_DURATION,
  KNOCKDOWN_DURATION,
  JUMP_DURATION,
  JUMP_GRAVITY,
  JUMP_VELOCITY,
  MATCH_INTRO_DURATION,
  MAX_LIVES,
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
const RESULT_REVEAL_DELAY_MS = 1600;
const clipCache = new Map<string, Promise<THREE.AnimationClip>>();

type ClipSampler = {
  target: THREE.Object3D;
  property: "position" | "quaternion";
  interpolant: THREE.Interpolant;
};

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
  const [resultVisible, setResultVisible] = useState(false);
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
    if (gamePhase !== "result") return;
    const timeout = window.setTimeout(() => setResultVisible(true), RESULT_REVEAL_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [gamePhase]);

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
  const newestHitKind = newestHit?.kind;
  const previousHitId = useRef(0);
  useEffect(() => {
    if (newestHitId > previousHitId.current) {
      if (newestHitKind === "blocked") audio.blocked();
      else if (newestHitRegion) audio.hit(newestHitRegion);
    }
    previousHitId.current = newestHitId;
  }, [audio, newestHitId, newestHitKind, newestHitRegion]);

  const chooseCharacter = (id: string) => {
    setSelectedId(id);
    window.localStorage.setItem("office-karate-character", id);
    audio.select();
  };

  const startGame = useCallback(() => {
    const opponents = shuffle(CHARACTERS.filter((character) => character.id !== selectedId)).slice(0, 2);
    const nextGame = createGame([selectedId, ...opponents.map((character) => character.id)], selectedId, Date.now() >>> 0);
    previousHitId.current = 0;
    setResultVisible(false);
    gameRef.current = nextGame;
    setGame(nextGame);
    audio.start();
    audio.select();
  }, [audio, selectedId]);

  const returnToMenu = () => {
    setResultVisible(false);
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

        {game && game.phase !== "result" && <HitFeedback effects={game.hitEffects} />}
        {game && game.phase !== "result" && <Scoreboard game={game} />}

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

        {game?.phase === "result" && resultVisible && (
          <div className="result-layer" role="status" aria-live="assertive">
            <div className="result-banner">
              <h2>{winnerCharacter ? `${winnerCharacter.name} WINS!` : "OAVGJORT!"}</h2>
              <button type="button" className="result-continue" onClick={returnToMenu}>CONTINUE</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

const HARNESS_ACTIONS: { value: FighterAction; label: string; duration: number }[] = [
  { value: "idle", label: "FIGHTING IDLE", duration: 2.5 },
  { value: "bow", label: "INTRO / QUICK FORMAL BOW", duration: MATCH_INTRO_DURATION },
  { value: "walk", label: "WALK / MEDIUM STEP FORWARD", duration: 2.5 },
  { value: "jump", label: "JUMP / JUMPING", duration: JUMP_DURATION },
  { value: "crouch", label: "CROUCH", duration: 2.5 },
  { value: "punch", label: "PUNCH / JAB CROSS", duration: 0.58 },
  { value: "kick", label: "KICK", duration: 0.82 },
  { value: "block", label: "BLOCK / OUTWARD", duration: BLOCK_DURATION },
  { value: "knockdown", label: "KNOCKDOWN", duration: KNOCKDOWN_DURATION },
  { value: "victory", label: "VICTORY", duration: 2.5 },
];

export function OfficeKarateHarness() {
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id);
  const [action, setAction] = useState<FighterAction>("knockdown");
  const [region, setRegion] = useState<HitRegion>("high");
  const [showKoStars, setShowKoStars] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const duration = HARNESS_ACTIONS.find((entry) => entry.value === action)?.duration ?? 2.5;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();
    const animate = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      setTime((current) => (current + delta) % duration);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [duration, playing]);

  const selectAction = (next: FighterAction) => {
    setAction(next);
    setTime(0);
  };

  return (
    <main className="harness-shell">
      <header className="harness-header">
        <div>
          <span className="eyebrow">OFFICE KARATE / LAB</span>
          <h1>ANIMATION HARNESS</h1>
        </div>
        <Link href="/">← TILL SPELET</Link>
      </header>

      <section className="harness-layout">
        <div className="harness-stage">
          <HarnessCanvas
            characterId={characterId}
            action={action}
            region={region}
            time={time}
            knockedOut={showKoStars && action === "knockdown"}
          />
          <div className="harness-stage__axis" aria-hidden="true" />
          <div className="harness-stage__readout">
            <span>{action.toUpperCase()}</span>
            <strong>{time.toFixed(2)}s</strong>
          </div>
        </div>

        <aside className="harness-controls">
          <div className="harness-control">
            <label htmlFor="harness-character">FIGHTER</label>
            <select id="harness-character" value={characterId} onChange={(event) => setCharacterId(event.target.value)}>
              {CHARACTERS.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
            </select>
          </div>

          <div className="harness-control">
            <label htmlFor="harness-action">ACTION</label>
            <select id="harness-action" value={action} onChange={(event) => selectAction(event.target.value as FighterAction)}>
              {HARNESS_ACTIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </div>

          <fieldset className="harness-control" disabled={action !== "knockdown"}>
            <legend>HIT REGION / FALL</legend>
            <div className="harness-segmented harness-segmented--three">
              {(["high", "mid", "low"] as HitRegion[]).map((value) => (
                <button key={value} type="button" className={region === value ? "is-active" : ""} onClick={() => { setRegion(value); setTime(0); }}>
                  {value === "high" ? "HIGH / KNOCKED OUT" : value === "mid" ? "MID / DYING" : "LOW / SWEEP FALL"}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="harness-toggle">
            <input type="checkbox" checked={showKoStars} onChange={(event) => setShowKoStars(event.target.checked)} />
            <span>VISA KO-STJÄRNOR</span>
          </label>

          <div className="harness-control">
            <div className="harness-control__row"><label htmlFor="harness-time">TIMELINE</label><span>{time.toFixed(2)} / {duration.toFixed(2)}</span></div>
            <input id="harness-time" type="range" min="0" max={duration} step="0.01" value={time} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }} />
          </div>

          <div className="harness-transport">
            <button type="button" onClick={() => setPlaying((current) => !current)}>{playing ? "Ⅱ PAUSE" : "▶ PLAY"}</button>
            <button type="button" onClick={() => { setPlaying(false); setTime(0); }}>↺ RESET</button>
          </div>

          <p className="harness-note">Den här sidan använder spelets riktiga modeller, klipp och posekod. Ändringar här är därför direkt representativa för matchen.</p>
        </aside>
      </section>
    </main>
  );
}

function HarnessCanvas({
  characterId,
  action,
  region,
  time,
  knockedOut,
}: {
  characterId: string;
  action: FighterAction;
  region: HitRegion;
  time: number;
  knockedOut: boolean;
}) {
  const variant = region === "high" ? "back" : region === "mid" ? "dying" : "sweep";
  const fighter = makeHarnessFighter({
    id: "harness",
    characterId,
    action,
    actionTime: time,
    region,
    variant,
  });
  fighter.knockedOut = knockedOut;
  if (action === "jump") {
    const jumpTime = Math.min(time, JUMP_DURATION);
    fighter.y = Math.max(0, JUMP_VELOCITY * jumpTime - (JUMP_GRAVITY * jumpTime * jumpTime) / 2);
  }

  return (
    <Canvas className="game-canvas" camera={{ position: [0, 2.8, 11], fov: 36, near: 0.1, far: 60 }} dpr={[1, 1.25]} gl={{ antialias: false, powerPreference: "high-performance" }} shadows>
      <color attach="background" args={["#10142d"]} />
      <fog attach="fog" args={["#11152c", 13, 25]} />
      <ambientLight intensity={1.55} color="#8ea8ff" />
      <directionalLight position={[-4, 8, 7]} intensity={3.2} color="#ffe8b6" castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[5, 4, 3]} intensity={8} distance={10} color="#ee4e9b" />
      <Arena />
      <Suspense fallback={null}>
        <FighterModel fighter={fighter} preview={false} animationTimeOverride={time} />
      </Suspense>
      <EffectComposer multisampling={0}><RetroEffect /></EffectComposer>
    </Canvas>
  );
}

function makeHarnessFighter({
  id,
  characterId,
  action,
  actionTime,
  region,
  variant,
}: {
  id: string;
  characterId: string;
  action: FighterAction;
  actionTime: number;
  region: HitRegion | null;
  variant: FighterState["knockdownVariant"];
}): FighterState {
  return {
    id,
    characterId,
    control: "player",
    x: 0,
    y: 0,
    velocityY: 0,
    facing: -1,
    score: 0,
    lives: MAX_LIVES,
    knockedOut: false,
    action,
    actionTime,
    cooldown: 0,
    invulnerable: 0,
    attackConnected: false,
    blockInputHeld: false,
    knockbackVelocity: 0,
    knockdownVariant: variant,
    lastHitRegion: region,
    aiThink: 0,
    aiTargetId: null,
    aiIntent: "approach",
  };
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
    lives: MAX_LIVES,
    knockedOut: false,
    action: "idle",
    actionTime: 0,
    cooldown: 0,
    invulnerable: 0,
    attackConnected: false,
    blockInputHeld: false,
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
  const officeBackground = useTexture("/assets/office-arena.png");

  return (
    <group>
      <mesh position={[0, 1.91, -2.2]}>
        <planeGeometry args={[15, 8.44]} />
        <meshBasicMaterial map={officeBackground} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.2, 0]} receiveShadow>
        <boxGeometry args={[13.5, 0.4, 4]} />
        <meshStandardMaterial color="#8d9299" roughness={0.88} />
      </mesh>
      {Array.from({ length: 13 }, (_, index) => (
        <mesh key={index} position={[-6 + index, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.035, 3.9]} />
          <meshBasicMaterial color="#4c5158" />
        </mesh>
      ))}
    </group>
  );
}

function FighterModel({
  fighter,
  preview,
  animationTimeOverride,
}: {
  fighter: FighterState;
  preview: boolean;
  animationTimeOverride?: number;
}) {
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
  const harnessClips = useRef(new Map<string, THREE.AnimationClip>());
  const harnessSamplers = useRef(new Map<string, ClipSampler[]>());
  const currentAnimation = useRef<string | null>(null);
  const group = useRef<THREE.Group>(null);
  const fighterAction = useRef(fighter.action);
  const fighterAnimationId = useRef(getFighterAnimationId(fighter.action, fighter.knockdownVariant));

  useEffect(() => {
    fighterAction.current = fighter.action;
    fighterAnimationId.current = getFighterAnimationId(fighter.action, fighter.knockdownVariant);
  }, [fighter.action, fighter.knockdownVariant]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(ANIMATIONS.map(async (animation) => {
      const source = await loadClip(animation.url);
      if (cancelled) return;
      const clip = prepareClipForModel(source, model, animation.id);
      harnessClips.current.set(animation.id, clip);
      harnessSamplers.current.set(animation.id, createClipSamplers(clip, model));
      const action = mixer.clipAction(clip, model);
      action.setLoop(animation.loop ? THREE.LoopRepeat : THREE.LoopOnce, animation.loop ? Infinity : 1);
      action.clampWhenFinished = !animation.loop;
      actions.current.set(animation.id, action);
    })).then(() => {
      if (cancelled) return;
      playAnimation(fighterAnimationId.current, fighterAction.current, actions.current, currentAnimation);
    });
    return () => {
      cancelled = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    };
  }, [mixer, model]);

  useEffect(() => {
    playAnimation(getFighterAnimationId(fighter.action, fighter.knockdownVariant), fighter.action, actions.current, currentAnimation);
  }, [fighter.action, fighter.knockdownVariant]);

  useFrame((_, delta) => {
    if (animationTimeOverride === undefined) {
      mixer.update(Math.min(delta, 0.05));
    } else {
      const activeId = currentAnimation.current;
      if (activeId) {
        const clip = harnessClips.current.get(activeId);
        const samplers = harnessSamplers.current.get(activeId);
        if (clip && samplers) sampleClipAtTime(clip, samplers, fighter.action, animationTimeOverride);
      }
    }
    if (!group.current) return;
    const pulse = Math.sin(performance.now() * 0.025);
    group.current.rotation.set(0, 0, fighter.action === "hit" ? pulse * 0.045 : 0);
    group.current.position.set(0, fighter.action === "crouch" ? -0.34 : 0, 0);
    group.current.scale.set(1, fighter.action === "crouch" ? 0.86 : 1, 1);
  });

  const facingRotation = fighter.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  return (
    <group position={[fighter.x, fighter.y, 0]}>
      <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.62, 24]} />
        <meshBasicMaterial color={definition.color} transparent opacity={preview ? 0.7 : 0.42} />
      </mesh>
      <group ref={group}>
        <primitive
          object={model}
          position={[0, definition.groundOffset, 0]}
          rotation={[0, facingRotation, 0]}
          scale={definition.scale}
        />
      </group>
      {fighter.knockedOut && <KnockoutStars model={model} />}
    </group>
  );
}

function KnockoutStars({ model }: { model: THREE.Object3D }) {
  const group = useRef<THREE.Group>(null);
  const head = useMemo(() => model.getObjectByName("Head"), [model]);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const points = [
      [0, 0.065], [0.018, 0.018], [0.065, 0], [0.018, -0.018],
      [0, -0.065], [-0.018, -0.018], [-0.065, 0], [-0.018, 0.018],
    ] as const;
    shape.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
    shape.closePath();
    return shape;
  }, []);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const phase = clock.elapsedTime * 3.6;
    if (head && group.current.parent) {
      head.getWorldPosition(worldPosition);
      group.current.parent.worldToLocal(worldPosition);
      group.current.position.set(worldPosition.x, worldPosition.y + 0.28, 0.58);
    }
    group.current.children.forEach((star, index) => {
      const angle = phase + (index * Math.PI * 2) / 3;
      star.position.set(Math.cos(angle) * 0.18, Math.sin(angle) * 0.045, index * 0.015);
      star.rotation.z = -phase * 0.7 + index * 0.7;
      const pulse = 0.82 + Math.sin(phase * 2 + index) * 0.16;
      star.scale.setScalar(pulse);
    });
  });

  return (
    <group ref={group} renderOrder={20}>
      {Array.from({ length: 3 }, (_, index) => (
        <mesh key={index}>
          <shapeGeometry args={[starShape]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function getFighterAnimationId(action: FighterAction, knockdownVariant: FighterState["knockdownVariant"]) {
  if (action !== "knockdown") return ACTION_ANIMATION[action];
  if (knockdownVariant === "sweep") return "sweepFall";
  if (knockdownVariant === "dying") return "dying";
  return "knockedOut";
}

function createClipSamplers(clip: THREE.AnimationClip, model: THREE.Object3D): ClipSampler[] {
  return clip.tracks.flatMap((track) => {
    const separator = track.name.lastIndexOf(".");
    const target = model.getObjectByName(track.name.slice(0, separator));
    const property = track.name.slice(separator + 1);
    if (!target || (property !== "position" && property !== "quaternion")) return [];
    const valueSize = track.getValueSize();
    const result = new Float32Array(valueSize);
    const interpolant = property === "quaternion"
      ? new THREE.QuaternionLinearInterpolant(track.times, track.values, valueSize, result)
      : new THREE.LinearInterpolant(track.times, track.values, valueSize, result);
    return [{
      target,
      property,
      interpolant,
    }];
  });
}

function sampleClipAtTime(clip: THREE.AnimationClip, samplers: ClipSampler[], action: FighterAction, actionTime: number) {
  const looping = action === "idle" || action === "walk" || action === "victory";
  const targetDuration = action === "punch"
    ? 0.58
    : action === "kick"
      ? 0.82
      : action === "knockdown"
        ? KNOCKDOWN_DURATION
        : action === "block"
          ? BLOCK_DURATION
          : action === "jump"
            ? JUMP_DURATION
            : action === "bow"
              ? MATCH_INTRO_DURATION
        : clip.duration;
  const clipTime = looping
    ? actionTime % clip.duration
    : Math.min(clip.duration, (actionTime / targetDuration) * clip.duration);
  for (const sampler of samplers) {
    const value = sampler.interpolant.evaluate(clipTime);
    if (sampler.property === "position") sampler.target.position.fromArray(value);
    else sampler.target.quaternion.fromArray(value);
  }
}

function prepareClipForModel(source: THREE.AnimationClip, model: THREE.Object3D, animationId: string) {
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
    const isFallClip = animationId === "knockedOut" || animationId === "dying" || animationId === "sweepFall";
    const verticalScale = isFallClip && Math.abs(startY) > 0.001
      ? Math.min(1, Math.abs(hips.position.y / startY))
      : 1;
    for (let index = 0; index < values.length; index += 3) {
      values[index] = animationId === "walk" ? hips.position.x : hips.position.x + (values[index] - startX) * 0.08;
      values[index + 1] = animationId === "jumping"
        ? hips.position.y
        : hips.position.y + (values[index + 1] - startY) * verticalScale;
      values[index + 2] = animationId === "walk" ? hips.position.z : hips.position.z + (values[index + 2] - startZ) * 0.08;
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
      : fighterAction === "block"
        ? BLOCK_DURATION
        : fighterAction === "jump"
          ? JUMP_DURATION
          : fighterAction === "bow"
            ? MATCH_INTRO_DURATION
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
          const scoring = game.hitEffects.some((effect) => effect.kind !== "blocked" && effect.attackerId === fighter.id);
          return (
            <div key={fighter.id} className={`score-pill ${fighter.control === "player" ? "is-player" : ""} ${scoring ? "is-scoring" : ""} ${fighter.knockedOut ? "is-ko" : ""}`} style={{ "--fighter-color": character?.color } as React.CSSProperties}>
              <span>{fighter.control === "player" ? "1P" : "CPU"}</span>
              <strong>{character?.name}</strong>
              <b>{String(fighter.score).padStart(2, "0")}</b>
              <div className="score-pill__lives" aria-label={`${fighter.lives} av ${MAX_LIVES} liv`}>
                {Array.from({ length: MAX_LIVES }, (_, index) => (
                  <i key={index} className={index < fighter.lives ? "is-full" : ""} />
                ))}
                {fighter.knockedOut && <em>KO</em>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="timer">
        <span>TIME</span>
        <strong>{Math.ceil(game.timeLeft).toString().padStart(2, "0")}</strong>
      </div>
    </div>
  );
}

function HitFeedback({ effects }: { effects: HitEffect[] }) {
  return (
    <div className="hit-feedback-layer" aria-live="polite">
      {effects.map((effect) => {
        const left = 8 + ((effect.x + 5.6) / 11.2) * 84;
        const top = effect.region === "low" ? 46 : effect.attack === "kick" || effect.region === "high" ? 29 : 37;
        const blocked = effect.kind === "blocked";
        const knockout = effect.kind === "ko";
        const label = blocked ? "NO POINT" : knockout ? "OUT!" : effect.region === "high" ? "BONK!" : effect.region === "mid" ? "POW!" : "SWEEP!";
        return (
          <div
            key={effect.id}
            className={`hit-feedback hit-feedback--${effect.region} ${blocked ? "hit-feedback--blocked" : ""} ${knockout ? "hit-feedback--ko" : ""}`}
            style={{
              "--hit-left": `${left}%`,
              "--hit-top": `${top}%`,
            } as React.CSSProperties}
          >
            <HitParticles effect={effect} />
            <span className="hit-feedback__label">
              <strong>{blocked ? "BLOCKED" : knockout ? "KO!" : "+1"}</strong>
              <small>{label}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

const SWEAT_PARTICLES = [
  { velocityX: 140, velocityY: -154, color: "#ffffff" },
  { velocityX: 175, velocityY: -188, color: "#d9ffff" },
  { velocityX: 210, velocityY: -138, color: "#ffffff" },
  { velocityX: 245, velocityY: -172, color: "#67d5d2" },
  { velocityX: 280, velocityY: -116, color: "#ffffff" },
  { velocityX: 320, velocityY: -148, color: "#d9ffff" },
  { velocityX: 155, velocityY: -168, color: "#ffffff" },
  { velocityX: 195, velocityY: -128, color: "#d9ffff" },
  { velocityX: 255, velocityY: -102, color: "#ffffff" },
  { velocityX: 360, velocityY: -96, color: "#ffffff" },
] as const;

function HitParticles({ effect }: { effect: HitEffect }) {
  const direction = effect.attackerFacing ?? (effect.x === 0 ? (effect.id % 2 ? 1 : -1) : Math.sign(effect.x));
  return (
    <span className="hit-feedback__particles" aria-hidden="true">
      {SWEAT_PARTICLES.map((particle, index) => {
        const jitter = ((effect.id * 7 + index * 11) % 9) - 4;
        const velocityX = particle.velocityX * direction + jitter * 4;
        const velocityY = particle.velocityY + jitter * 3;
        const position = (progress: number) => {
          const time = HIT_PARTICLE_DURATION * progress;
          return {
            x: Math.round(velocityX * time),
            y: Math.round(velocityY * time + 0.5 * HIT_PARTICLE_GRAVITY * time * time),
          };
        };
        const quarter = position(0.25);
        const half = position(0.5);
        const threeQuarters = position(0.75);
        const end = position(1);
        return (
          <i
            key={index}
            style={{
              "--particle-color": effect.kind === "blocked" ? "#67d5d2" : particle.color,
              "--particle-x25": `${quarter.x}px`,
              "--particle-y25": `${quarter.y}px`,
              "--particle-x50": `${half.x}px`,
              "--particle-y50": `${half.y}px`,
              "--particle-x75": `${threeQuarters.x}px`,
              "--particle-y75": `${threeQuarters.y}px`,
              "--particle-x100": `${end.x}px`,
              "--particle-y100": `${end.y}px`,
            } as React.CSSProperties}
          />
        );
      })}
    </span>
  );
}

const HIT_PARTICLE_DURATION = 0.68;
const HIT_PARTICLE_GRAVITY = 390;

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
    if (!context.current || context.current.state === "closed") {
      context.current = new AudioContext();
      master.current = context.current.createGain();
      master.current.gain.value = muted ? 0 : 0.16;
      master.current.connect(context.current.destination);
    }
    if (context.current.state === "suspended") {
      void context.current.resume().catch(() => undefined);
    }
    return context.current;
  }, [muted]);

  useEffect(() => {
    if (master.current) master.current.gain.value = muted ? 0 : 0.16;
  }, [muted]);

  useEffect(() => () => {
    if (musicTimer.current) {
      window.clearInterval(musicTimer.current);
      musicTimer.current = null;
    }
    const activeContext = context.current;
    context.current = null;
    master.current = null;
    if (activeContext && activeContext.state !== "closed") {
      void activeContext.close().catch(() => undefined);
    }
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
    blocked: () => {
      tone(680, 0.08, "square", 0.3);
      window.setTimeout(() => tone(420, 0.11, "triangle", 0.26), 38);
    },
    hit: (region: HitRegion) => {
      const first = region === "high" ? 126 : region === "mid" ? 92 : 68;
      const second = region === "high" ? 74 : region === "mid" ? 58 : 44;
      tone(first, 0.14, "sawtooth", 0.42);
      window.setTimeout(() => tone(second, 0.13, "square", 0.3), 35);
    },
  }), [start, tone]);
}
