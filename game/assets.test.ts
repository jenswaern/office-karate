import { readFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";
import { ANIMATIONS, CHARACTERS } from "./config";

const requiredBones = [
  "Hips",
  "Spine",
  "Head",
  "LeftArm",
  "RightArm",
  "LeftLeg",
  "RightLeg",
  "LeftFoot",
  "RightFoot",
];

describe("fighter assets", () => {
  it.each(CHARACTERS)("validates $name as a skinned Mixamo-compatible GLB", async (character) => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const document = await io.read(`public${character.modelUrl}`);
    const root = document.getRoot();
    const names = new Set(root.listNodes().map((node) => node.getName()));
    expect(root.listSkins().length).toBeGreaterThan(0);
    for (const bone of requiredBones) expect(names.has(bone)).toBe(true);
  });

  it.each(ANIMATIONS)("validates the shared $id animation clip", async (animation) => {
    const json = JSON.parse(await readFile(`public${animation.url}`, "utf8"));
    expect(json.tracks.length).toBeGreaterThan(15);
    expect(json.tracks.some((track: { name: string }) => track.name === "Hips.position")).toBe(true);
    expect(json.tracks.every((track: { name: string }) => !track.name.endsWith(".scale"))).toBe(true);
  });
});
