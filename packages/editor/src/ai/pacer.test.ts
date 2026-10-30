import { describe, expect, it } from 'vitest';
import { pace, setLimit, releasePause } from './pacer';

describe('pacer', () => {
  it('rests for the share of time it may not work', async () => {
    setLimit(0.5);
    let t = performance.now();
    await pace(80);
    expect(performance.now() - t).toBeGreaterThan(70); // worked 80 ms: rests about as long
    setLimit(1);
    t = performance.now();
    await pace(80);
    expect(performance.now() - t).toBeLessThan(20);
  });

  it('Stop lets it go at once', async () => {
    setLimit(0.25);
    releasePause();
    const t = performance.now();
    await pace(200);
    expect(performance.now() - t).toBeLessThan(20);
  });
});
