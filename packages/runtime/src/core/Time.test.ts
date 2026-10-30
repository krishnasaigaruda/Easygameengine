import { describe, expect, it } from 'vitest';
import { Time } from './Time';

describe('Time', () => {
  it('runs one fixed step per fixedDelta of elapsed time', () => {
    const t = new Time(0.01);
    expect(t.tick(0.035)).toBe(3);
    expect(t.alpha).toBeCloseTo(0.5);
    expect(t.tick(0.005)).toBe(1);
  });

  it('clamps huge deltas so a background tab does not spiral', () => {
    const t = new Time(1 / 60);
    t.tick(5);
    expect(t.delta).toBe(0.1);
  });

  it('ignores negative deltas', () => {
    const t = new Time();
    expect(t.tick(-1)).toBe(0);
    expect(t.delta).toBe(0);
  });
});
