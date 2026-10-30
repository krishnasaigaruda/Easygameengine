/**
 * Tracks frame timing. Physics runs on a fixed step; rendering runs every frame.
 */
export class Time {
  /** Seconds since the last rendered frame (clamped so a tab switch doesn't explode physics). */
  delta = 0;
  /** Seconds since the engine started. */
  elapsed = 0;
  /** Fixed physics step in seconds. */
  readonly fixedDelta: number;
  /** Leftover time not yet consumed by fixed steps. */
  private accumulator = 0;
  private static readonly MAX_DELTA = 0.1;

  constructor(fixedDelta = 1 / 60) {
    this.fixedDelta = fixedDelta;
  }

  /** Advance the clock by `seconds`; returns how many fixed steps to run this frame. */
  tick(seconds: number): number {
    this.delta = Math.min(Math.max(seconds, 0), Time.MAX_DELTA);
    this.elapsed += this.delta;
    this.accumulator += this.delta;
    let steps = 0;
    while (this.accumulator >= this.fixedDelta) {
      this.accumulator -= this.fixedDelta;
      steps++;
    }
    return steps;
  }

  /** 0..1 — how far we are between the last and next fixed step (for interpolation). */
  get alpha(): number {
    return this.accumulator / this.fixedDelta;
  }
}
