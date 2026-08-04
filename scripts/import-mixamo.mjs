import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AnimationClip } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const DISPLAY_NAMES = {
  hips: "Hips",
  spine: "Spine",
  spine1: "Spine1",
  spine2: "Spine2",
  neck: "Neck",
  head: "Head",
  leftupleg: "LeftUpLeg",
  leftleg: "LeftLeg",
  leftfoot: "LeftFoot",
  lefttoebase: "LeftToeBase",
  rightupleg: "RightUpLeg",
  rightleg: "RightLeg",
  rightfoot: "RightFoot",
  righttoebase: "RightToeBase",
  leftshoulder: "LeftShoulder",
  leftarm: "LeftArm",
  leftforearm: "LeftForeArm",
  lefthand: "LeftHand",
  rightshoulder: "RightShoulder",
  rightarm: "RightArm",
  rightforearm: "RightForeArm",
  righthand: "RightHand",
};

function canonicalBoneName(name) {
  const leaf = name.split(/[|/\\]/).at(-1) ?? name;
  const key = leaf
    .replace(/^mixamorig[:_]?/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

  if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];

  const finger = key.match(/^(left|right)hand(thumb|index|middle|ring|pinky)([123])$/);
  if (!finger) return null;
  const [, side, digit, segment] = finger;
  return `${side[0].toUpperCase()}${side.slice(1)}Hand${digit[0].toUpperCase()}${digit.slice(1)}${segment}`;
}

function normalizeClip(sourceClip, id) {
  const clip = sourceClip.clone();
  clip.name = id;
  clip.tracks = clip.tracks.flatMap((track) => {
    const property = track.name.split(".").at(-1);
    const target = track.name.slice(0, -(property.length + 1));
    if (property === "scale") return [];
    const canonical = canonicalBoneName(target);
    if (!canonical) return [];
    const normalized = track.clone();
    normalized.name = `${canonical}.${property}`;
    if (property === "position" && canonical === "Hips") {
      const maximum = Math.max(...normalized.values.map((value) => Math.abs(value)));
      if (maximum > 10) {
        for (let index = 0; index < normalized.values.length; index += 1) {
          normalized.values[index] *= 0.01;
        }
      }
    }
    return [normalized];
  });
  clip.resetDuration();
  return clip;
}

const [input, output, id] = process.argv.slice(2);
if (!input || !output || !id) {
  throw new Error("Usage: npm run assets:mixamo -- input.fbx output.json animationId");
}

const bytes = await readFile(input);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const fbx = new FBXLoader().parse(arrayBuffer, `${path.dirname(input)}/`);
const sourceClip = fbx.animations[0];
if (!sourceClip) throw new Error(`No animation clip found in ${input}`);

const clip = normalizeClip(sourceClip, id);
if (clip.tracks.length === 0) throw new Error(`No compatible Mixamo tracks found in ${input}`);

await writeFile(output, `${JSON.stringify(AnimationClip.toJSON(clip))}\n`);
console.log(`${id}: ${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s`);
