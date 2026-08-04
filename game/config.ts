import type { FighterAction } from "./simulation";

export type CharacterDefinition = {
  id: string;
  name: string;
  modelUrl: string;
  scale: number;
  groundOffset: number;
  color: string;
};

export type AnimationDefinition = {
  id: string;
  url: string;
  loop: boolean;
  blendTime: number;
  hitFrame?: number;
};

export const CHARACTERS: CharacterDefinition[] = [
  { id: "jens", name: "JENS", modelUrl: "/assets/characters/jens.glb", scale: 1.02, groundOffset: 0.03, color: "#f8b133" },
  { id: "fia", name: "FIA", modelUrl: "/assets/characters/fia.glb", scale: 1, groundOffset: 0.03, color: "#ef5da8" },
  { id: "peter", name: "PETER", modelUrl: "/assets/characters/peter.glb", scale: 1, groundOffset: 0.03, color: "#67d5d2" },
  { id: "john", name: "JOHN", modelUrl: "/assets/characters/john.glb", scale: 1, groundOffset: 0.03, color: "#f05b45" },
  { id: "ufuk", name: "UFUK", modelUrl: "/assets/characters/ufuk.glb", scale: 1.01, groundOffset: 0.03, color: "#a8e05f" },
];

export const ANIMATIONS: AnimationDefinition[] = [
  { id: "fightingIdle", url: "/assets/animations/fighting-idle.json", loop: true, blendTime: 0.18 },
  { id: "walk", url: "/assets/animations/medium-step-forward.json", loop: true, blendTime: 0.12 },
  { id: "jumping", url: "/assets/animations/jumping.json", loop: false, blendTime: 0.08 },
  { id: "punch", url: "/assets/animations/punch.json", loop: false, blendTime: 0.08, hitFrame: 0.26 },
  { id: "kick", url: "/assets/animations/kick.json", loop: false, blendTime: 0.08, hitFrame: 0.42 },
  { id: "outwardBlock", url: "/assets/animations/outward-block.json", loop: false, blendTime: 0.08 },
  { id: "knockedOut", url: "/assets/animations/knocked-out.json", loop: false, blendTime: 0.08 },
  { id: "dying", url: "/assets/animations/dying.json", loop: false, blendTime: 0.08 },
  { id: "sweepFall", url: "/assets/animations/sweep-fall.json", loop: false, blendTime: 0.08 },
  { id: "victory", url: "/assets/animations/victory.json", loop: true, blendTime: 0.18 },
];

export const ACTION_ANIMATION: Record<FighterAction, string> = {
  idle: "fightingIdle",
  walk: "walk",
  jump: "jumping",
  crouch: "fightingIdle",
  punch: "punch",
  kick: "kick",
  block: "outwardBlock",
  hit: "fightingIdle",
  knockdown: "knockedOut",
  victory: "victory",
};
