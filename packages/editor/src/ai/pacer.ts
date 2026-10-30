import { useSyncExternalStore } from 'react';

/*
 * Keeps the assistant from taking over the computer. The model writes one word piece at a time
 * on the graphics chip, and only when asked for the next one, so between pieces it can:
 *  - rest for part of the time (the "use up to" limit: 50% = it works half the time), and
 *  - pause altogether while the computer struggles: the processor is under heavy pressure (hot),
 *    the editor's frames are badly late (the graphics chip is overloaded), or memory is nearly
 *    full. It carries on by itself once that's over, and works more gently from then on.
 */

export type StrainReason = 'hot' | 'lagging' | 'memory';
type CpuState = 'nominal' | 'fair' | 'serious' | 'critical';

export interface PacerState {
  /** Share of the time it may work (0.25 – 1). */
  limit: number;
  /** Lowered by itself after the computer struggled. */
  lowered: boolean;
  paused: StrainReason | null;
  /** The processor's pressure, where the browser tells (Chrome). */
  cpu: CpuState | null;
  /** Editor frames per second while it works (0 = not measured). */
  fps: number;
  /** The page's own memory use and limit, in MB (Chrome). */
  memoryMB?: number;
  memoryLimitMB?: number;
}

export const LIMITS = [1, 0.75, 0.5, 0.25] as const;
const KEY = 'ege.ai.limit';
const stored = (() => {
  try {
    return Number(localStorage.getItem(KEY));
  } catch {
    return 0; // no storage here (tests, some private windows)
  }
})();

let state: PacerState = {
  limit: LIMITS.includes(stored as (typeof LIMITS)[number]) ? stored : 0.75,
  lowered: false,
  paused: null,
  cpu: null,
  fps: 0,
};
const listeners = new Set<() => void>();
function set(patch: Partial<PacerState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function usePacer(): PacerState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function setLimit(limit: number): void {
  try {
    localStorage.setItem(KEY, String(limit));
  } catch {
    // no storage: it just isn't remembered
  }
  set({ limit, lowered: false });
}

// ── watching the computer (only while the model works) ──

let working = 0;
let frames: number[] = [];
let raf = 0;
let lastFrame = 0;
let memoryTimer: ReturnType<typeof setInterval> | undefined;
let pressure: {
  observe(source: string, o?: { sampleInterval?: number }): Promise<void>;
  disconnect(): void;
} | null = null;
/** "Continue anyway": strain is ignored until then. */
let ignoreUntil = 0;

const hidden = () => typeof document !== 'undefined' && document.hidden;

function onFrame(now: number): void {
  if (lastFrame && !hidden()) frames.push(now - lastFrame);
  if (frames.length > 40) frames = frames.slice(-40);
  lastFrame = now;
  raf = requestAnimationFrame(onFrame);
}

/** Average frame gap over the last ~1.5 s (ms), or 0 without enough to go on. */
function frameGap(): number {
  if (hidden()) return 0;
  let sum = 0;
  let n = 0;
  for (let i = frames.length - 1; i >= 0 && sum < 1500; i--) {
    sum += frames[i];
    n++;
  }
  return n >= 6 && sum >= 800 ? sum / n : 0;
}

function readMemory(): void {
  const m = (
    performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
  ).memory;
  if (m)
    set({
      memoryMB: Math.round(m.usedJSHeapSize / 1048576),
      memoryLimitMB: Math.round(m.jsHeapSizeLimit / 1048576),
    });
  const gap = frameGap();
  if (gap) set({ fps: Math.round(1000 / gap) });
}

async function watch(): Promise<void> {
  frames = [];
  lastFrame = 0;
  raf = requestAnimationFrame(onFrame);
  memoryTimer = setInterval(readMemory, 1000);
  const Observer = (
    globalThis as unknown as {
      PressureObserver?: new (
        cb: (r: { state: CpuState }[]) => void,
      ) => NonNullable<typeof pressure>;
    }
  ).PressureObserver;
  if (Observer && !pressure) {
    try {
      pressure = new Observer((records) => {
        const last = records[records.length - 1];
        if (last) set({ cpu: last.state });
      });
      await pressure.observe('cpu', { sampleInterval: 1000 });
    } catch {
      pressure = null;
    }
  }
}

function unwatch(): void {
  cancelAnimationFrame(raf);
  clearInterval(memoryTimer);
  pressure?.disconnect();
  pressure = null;
  set({ paused: null, fps: 0, cpu: null });
}

/** What's wrong right now, if anything (with some slack before carrying on). */
function strain(resuming: boolean): StrainReason | null {
  if (Date.now() < ignoreUntil) return null;
  if (state.cpu === 'critical' || (resuming && state.cpu === 'serious')) return 'hot';
  const gap = frameGap();
  if (gap > (resuming ? 50 : 140)) return 'lagging';
  if (
    state.memoryMB &&
    state.memoryLimitMB &&
    state.memoryMB > state.memoryLimitMB * (resuming ? 0.8 : 0.9)
  )
    return 'memory';
  return null;
}

let stopped = false;

/** Call around one answer. */
export function beginWork(): void {
  stopped = false;
  if (working++ === 0) void watch();
}
export function endWork(): void {
  if (--working <= 0) {
    working = 0;
    unwatch();
  }
}

/** Stop pressed: let a paused answer go (it then ends). */
export function releasePause(): void {
  stopped = true;
}

/** Ignore the struggling for a while (the person chose to carry on). */
export function continueAnyway(): void {
  ignoreUntil = Date.now() + 60_000;
  set({ paused: null });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Between two word pieces: rest for the limit's share of `workedMs`, and wait out any
 * struggling. Struggling makes it gentler from then on (down to a quarter of the time).
 */
export async function pace(workedMs: number): Promise<void> {
  if (stopped) return;
  const why = strain(false);
  if (why) {
    set({ paused: why });
    const gentler = LIMITS.find((l) => l < state.limit);
    if (gentler) set({ limit: gentler, lowered: true });
    // Back to normal for 2 s in a row before carrying on.
    let calm = 0;
    while (!stopped && calm < 2000) {
      await sleep(250);
      calm = strain(true) ? 0 : calm + 250;
    }
    set({ paused: null });
    frames = [];
    return;
  }
  const rest = Math.min(600, workedMs * (1 / state.limit - 1));
  if (rest > 1) await sleep(rest);
}
