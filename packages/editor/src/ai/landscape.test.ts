import { describe, expect, it } from 'vitest';
import { landFor, sceneryTips } from './landscape';

describe('the land a request describes', () => {
  it('is not a valley for everything', () => {
    expect(landFor('a treasure island').preset).toBe('island');
    expect(landFor('a desert with a pyramid').kind).toBe('desert');
    expect(landFor('a grand canyon').preset).toBe('plateaus');
    expect(landFor('climb the snowy mountains').preset).toBe('mountains');
    expect(landFor('a farm with cows').kind).toBe('meadow');
    expect(landFor('rolling hills and a windmill').kind).toBe('hills');
    expect(landFor('a dark forest').kind).toBe('woods');
  });

  it('is a valley when it says so, or for mountains behind a flat place', () => {
    expect(landFor('a river valley').preset).toBe('valley');
    expect(landFor('The attached picture shows: a cabin in a meadow with mountains in the background').preset).toBe('valley');
  });

  it('follows the request, not the model’s own words for the part', () => {
    expect(landFor('a farm with cows', 'Shape the ground into a valley').preset).toBe('hills');
    // Nothing about the land in the request: not the model's habit of a valley.
    expect(landFor('add a tiger', 'Shape the ground into a valley').preset).toBe('hills');
    expect(landFor('add a tiger', 'Shape the ground into mountains').preset).toBe('mountains');
  });

  it('makes each landscape its own (a seed from the request)', () => {
    const seed = (r: string) => landFor(r).set.find(([f]) => f === 'seed')?.[1];
    expect(seed('rolling hills')).toBe(seed('rolling hills'));
    expect(seed('rolling hills')).not.toBe(seed('rolling hills at night'));
  });
});

describe('scenery tips', () => {
  it('tell the model the land to make, and not a valley', () => {
    const t = sceneryTips('Shape the ground into a valley', 'a farm with cows and a barn', { defaultGround: true });
    expect(t).toContain('Delete the flat "Ground" first');
    expect(t).toContain('preset to "hills" (not "valley")');
    expect(t).toContain('maxHeight 5');
  });

  it('give the tips the part is about, fitting the land', () => {
    const t = sceneryTips('Pine trees on the slopes and a sunset sky', 'snowy mountains');
    expect(t).toContain('maxHeight to 0.55');
    expect(t).toContain('18.6 for sunset');
    expect(t).not.toContain('Wildflowers');
    expect(sceneryTips('Shape the land', 'a treasure island')).toContain('"Sea" at [0,1.5,0]');
    expect(sceneryTips('Trees and a lake', 'rolling hills')).toContain('fills the hollows');
    expect(sceneryTips('Trees around', 'a desert oasis')).toContain('"Palm Trees" with count 12');
  });

  it('say nothing for parts that are not scenery', () => {
    expect(sceneryTips('A dog that follows the player', 'a dog in a meadow')).toBe('');
    expect(sceneryTips('Coins and a score on screen', 'an obby')).toBe('');
  });
});
