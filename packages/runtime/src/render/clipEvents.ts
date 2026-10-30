import type * as THREE from 'three';
import type { PoseKey } from '../rigging/poses';

/** A code point: when the animation reaches `time` (seconds), the object gets `message` (on.message). */
export interface ClipEvent {
  time: number;
  message: string;
}

/** What a model asset keeps about its animations besides the file: code points per clip name. */
export interface ModelAnimationData {
  clipEvents?: Record<string, ClipEvent[]>;
  /** Animations made in the Animation Studio, kept as their poses so they stay editable. */
  poseClips?: Record<string, { keys: PoseKey[]; loop: boolean; length: number }>;
}

/** Attach a model asset's code points to its clips (clip.userData.events). */
export function applyClipEvents(clips: THREE.AnimationClip[], data: unknown): void {
  const events = (data as ModelAnimationData | undefined)?.clipEvents ?? {};
  for (const c of clips) c.userData = { ...c.userData, events: (events[c.name] ?? []).slice().sort((a, b) => a.time - b.time) };
}

export function clipEventsOf(clip: THREE.AnimationClip | undefined): ClipEvent[] {
  return (clip?.userData?.events as ClipEvent[] | undefined) ?? [];
}

/**
 * Code points passed when an animation moved from `from` to `to` seconds. Looping clips wrap
 * around (end → start); `reverse` plays them backwards.
 */
export function eventsCrossed(events: ClipEvent[], from: number, to: number, reverse = false): ClipEvent[] {
  if (!events.length || from === to) return [];
  if (!reverse) return to > from ? events.filter((e) => e.time > from && e.time <= to) : events.filter((e) => e.time > from || e.time <= to);
  return to < from ? events.filter((e) => e.time < from && e.time >= to) : events.filter((e) => e.time < from || e.time >= to);
}
