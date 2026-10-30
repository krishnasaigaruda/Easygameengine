import { create } from 'zustand';
import type { Engine, Entity } from '@ege/runtime';
import { useEditor } from '../state/editorStore';

/*
 * Guides: step-by-step tutorials shown over the editor. Each step says what to do and checks for
 * itself when it's done (an object selected, Play pressed, a coin collected…), then moves on.
 * Tutorial templates carry their steps (public/templates/templates.json).
 */

/** What finishes a step. Name tests match the start of an object's name ("Cube" matches "Cube 2"). */
export type GuideCheck =
  | { selected: string }
  | { tool: string }
  | { cameraMoved: true }
  | { played: true }
  | { stopped: true }
  | { scored: number }
  | { exists: string }
  | { moved: string }
  | { trait: { name: string; trait: string } }
  | { component: { name: string; component: string } };

export interface GuideStep {
  title: string;
  text: string;
  done?: GuideCheck;
}

export interface Guide {
  title: string;
  steps: GuideStep[];
}

interface GuideState {
  guide: Guide | null;
  projectId: string | null;
  step: number;
  /** Set when a step starts, to tell what changed since. */
  baseline: { plays: number; camera: string; positions: Record<string, string> };
  plays: number;
  bestScore: number;
}

export const useGuide = create<GuideState>(() => ({ guide: null, projectId: null, step: 0, baseline: { plays: 0, camera: '', positions: {} }, plays: 0, bestScore: 0 }));

const KEY = (projectId: string) => `ege.guide.${projectId}`;

/** Start a guide for a project (remembered in this browser, with how far it got). */
export function startGuide(projectId: string, guide: Guide): void {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify({ guide, step: 0 }));
  } catch {
    // storage blocked: the guide just won't come back after a reload
  }
  useGuide.setState({ guide, projectId, step: 0, plays: 0, bestScore: 0, baseline: snapshot(0) });
}

/** Bring back the guide of the open project, if it has one. */
export function resumeGuide(projectId: string | null): void {
  if (!projectId) return useGuide.setState({ guide: null, projectId: null });
  if (useGuide.getState().projectId === projectId) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY(projectId)) ?? 'null') as { guide: Guide; step: number } | null;
    if (saved?.guide) {
      useGuide.setState({ guide: saved.guide, projectId, step: saved.step, plays: 0, bestScore: 0, baseline: snapshot(0) });
      return;
    }
  } catch {
    // nothing saved
  }
  useGuide.setState({ guide: null, projectId });
}

export function closeGuide(): void {
  const { projectId } = useGuide.getState();
  try {
    if (projectId) localStorage.removeItem(KEY(projectId));
  } catch {
    // fine
  }
  useGuide.setState({ guide: null });
}

export function goToStep(step: number): void {
  const s = useGuide.getState();
  if (!s.guide) return;
  const n = Math.max(0, Math.min(step, s.guide.steps.length));
  useGuide.setState({ step: n, baseline: snapshot(s.plays) });
  try {
    if (s.projectId) localStorage.setItem(KEY(s.projectId), JSON.stringify({ guide: s.guide, step: n }));
  } catch {
    // fine
  }
}

function engine(): Engine | null {
  return useEditor.getState().engine;
}

const round = (v: number[]) => v.map((x) => Math.round(x * 20) / 20).join(',');

function snapshot(plays: number): GuideState['baseline'] {
  const e = engine();
  const positions: Record<string, string> = {};
  for (const ent of e?.world.all() ?? []) positions[ent.id] = round((ent.get('Transform') as { position: number[] } | undefined)?.position ?? []);
  const cam = e?.camera;
  return { plays, camera: cam ? round([...cam.position.toArray(), cam.zoom]) : '', positions };
}

function named(prefix: string): Entity[] {
  const p = prefix.toLowerCase();
  return [...(engine()?.world.all() ?? [])].filter((e) => e.name.toLowerCase().startsWith(p));
}

/** Is the current step done? */
export function stepDone(check: GuideCheck | undefined, s: GuideState): boolean {
  if (!check) return false;
  const ed = useEditor.getState();
  const e = engine();
  if ('selected' in check) {
    const sel = ed.selection ? e?.world.getById(ed.selection) : undefined;
    return !!sel && sel.name.toLowerCase().startsWith(check.selected.toLowerCase());
  }
  if ('tool' in check) return ed.tool === check.tool;
  if ('cameraMoved' in check) {
    const cam = e?.camera;
    return !!cam && round([...cam.position.toArray(), cam.zoom]) !== s.baseline.camera;
  }
  if ('played' in check) return s.plays > s.baseline.plays;
  if ('stopped' in check) return s.plays > 0 && !ed.playing;
  if ('scored' in check) return s.bestScore >= check.scored;
  if ('exists' in check) return named(check.exists).length > 0;
  if ('moved' in check) return named(check.moved).some((ent) => s.baseline.positions[ent.id] !== round((ent.get('Transform') as { position: number[] }).position));
  if ('trait' in check) return named(check.trait.name).some((ent) => ((ent.get('Traits') as { traits?: string[] } | undefined)?.traits ?? []).includes(check.trait.trait));
  if ('component' in check) return named(check.component.name).some((ent) => ent.has(check.component.component));
  return false;
}

/** Called a few times a second: counts plays and scores, and moves on when a step is done. */
export function tickGuide(): void {
  const s = useGuide.getState();
  if (!s.guide) return;
  const ed = useEditor.getState();
  const score = Number((ed.engine?.scripts as unknown as { game?: Record<string, unknown> } | undefined)?.game?.score ?? 0) || 0;
  if (score > s.bestScore) useGuide.setState({ bestScore: score });
  const step = s.guide.steps[s.step];
  if (step && stepDone(step.done, useGuide.getState())) goToStep(s.step + 1);
}

let wasPlaying = false;
/** Count each press of Play. */
useEditor.subscribe((st) => {
  if (st.playing && !wasPlaying) useGuide.setState((g) => ({ plays: g.plays + 1 }));
  wasPlaying = st.playing;
});
