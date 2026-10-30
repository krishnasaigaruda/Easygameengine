/** The skeletons models can be rigged with, and their free (CC0) animation packs from Mesh2Motion. */
export enum SkeletonType {
  Human = 'human',
  Fox = 'fox',
  Horse = 'horse',
  Bird = 'bird',
  Dragon = 'dragon',
  Kaiju = 'kaiju',
  Spider = 'spider',
  Snake = 'snake',
  Fish = 'fish',
}

/** Pinned so the files never change under a project. CC0 art from Mesh2Motion. */
const BASE = 'https://cdn.jsdelivr.net/gh/Mesh2Motion/mesh2motion-app@eef2de986dab53283cb636f860d502d64b8073e7/static/animations/';

export interface SkeletonInfo {
  type: SkeletonType;
  label: string;
  /** Bone used to find the crotch (keeps leg vertices off the hips) — and the one that may move. */
  trackingBone: string;
  /** Animation packs: each holds the skeleton and its clips. The first one is the rig. */
  packs: string[];
}

export const SKELETONS: SkeletonInfo[] = [
  { type: SkeletonType.Human, label: 'Human', trackingBone: 'pelvis', packs: ['human-base-animations.glb', 'human-addon-animations.glb', 'human-mocap-animations.glb'] },
  { type: SkeletonType.Fox, label: 'Four legs (fox, dog, cat)', trackingBone: 'hips', packs: ['fox-animations.glb'] },
  { type: SkeletonType.Horse, label: 'Horse', trackingBone: 'hips', packs: ['horse-animations.glb'] },
  { type: SkeletonType.Bird, label: 'Bird', trackingBone: 'hips', packs: ['bird-animations.glb'] },
  { type: SkeletonType.Dragon, label: 'Dragon', trackingBone: 'hips', packs: ['dragon-animations.glb'] },
  { type: SkeletonType.Kaiju, label: 'Monster (kaiju)', trackingBone: 'hips', packs: ['kaiju-animations.glb'] },
  { type: SkeletonType.Spider, label: 'Spider', trackingBone: 'hips', packs: ['spider-animations.glb'] },
  { type: SkeletonType.Snake, label: 'Snake', trackingBone: 'head', packs: ['snake-animations.glb'] },
  { type: SkeletonType.Fish, label: 'Fish (shark)', trackingBone: 'pelvis', packs: ['shark-animations.glb'] },
].map((s) => ({ ...s, packs: s.packs.map((p) => BASE + p) }));

export function skeletonInfo(type: SkeletonType): SkeletonInfo | undefined {
  return SKELETONS.find((s) => s.type === type);
}

export function positionTrackingBone(type: SkeletonType): string {
  return skeletonInfo(type)?.trackingBone ?? 'hips';
}
