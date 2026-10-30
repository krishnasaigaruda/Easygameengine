import { describe, expect, it } from 'vitest';
import { thingOf } from './realModels';

describe('which shapes get a real model', () => {
  it('real things, with their pieces joining them', () => {
    expect(thingOf('Dog')).toBe('dog');
    expect(thingOf('Cabin Roof')).toBe('cabin');
    expect(thingOf('Pine Tree 3')).toBe('pine tree');
    expect(thingOf('Tree Trunk')).toBe('tree');
    expect(thingOf('Old Car')).toBe('car');
    // Where it is, its color and its label don't say what it is.
    expect(thingOf('Fence North')).toBe('fence');
    expect(thingOf('Red Barn Roof')).toBe('barn');
    expect(thingOf('Crop B')).toBe('crop');
  });

  it('game pieces keep their shapes', () => {
    for (const name of ['Platform 4', 'Ground', 'Coin 2', 'Finish', 'Lava Floor', 'Step 3', 'Player', 'Wall', 'Jump Pad', 'Checkpoint', 'Meadow', 'Grass Field', 'Lake']) expect(thingOf(name)).toBeNull();
  });
});
