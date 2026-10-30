import { describe, expect, it } from 'vitest';
import { searchItems, words, type StoreItem } from './catalog';

const item = (name: string, tags = '', category = ''): StoreItem => ({
  key: name,
  provider: 'objaverse',
  kind: 'model',
  id: name,
  name,
  author: 'someone',
  license: 'CC0-1.0',
  thumbs: [],
  animations: 0,
  categories: category ? [category] : [],
  nameWords: words(name),
  tagWords: words(`${tags} ${category}`),
  authorText: 'someone',
  pageUrl: '',
});

describe('store search', () => {
  const items = [
    item('Jacaranda Tree'),
    item('Carrot Cake'),
    item('Cardboard Box 01'),
    item('BTRGAZ', 'btr,gaz,car', 'cars-vehicles'),
    item('80s Generic midsize sedan', 'ford,sedan,transport', 'cars-vehicles'),
    item('Covered Car'),
    item('Old Van', 'van,rusty'),
  ];
  const names = (q: string) => searchItems(items, q).map((i) => i.name);

  it('ranks whole-word matches first and does not match inside other words', () => {
    const r = names('car');
    expect(r[0]).toBe('Covered Car'); // in the name
    expect(r[1]).toBe('BTRGAZ'); // tagged car
    expect(r).toContain('80s Generic midsize sedan'); // a vehicle, via the category / synonyms
    expect(r).toContain('Old Van');
    expect(r).not.toContain('Jacaranda Tree');
    expect(r.indexOf('Carrot Cake')).toBeGreaterThan(r.indexOf('Old Van')); // prefix match ranks last
  });

  it('accepts plurals; full matches first, then most of the words', () => {
    expect(names('cars')).toContain('Covered Car');
    expect(names('old van')).toEqual(['Old Van']);
    // Two of three words still finds it (nothing has all three).
    expect(names('rusty old spaceship')).toEqual(['Old Van']);
    // One of three is not enough.
    expect(names('rusty spaceship rocket')).toEqual([]);
    expect(names('')).toHaveLength(items.length);
  });

  it('splits words in names and categories', () => {
    expect(words('SportsCar2 cars-vehicles low_poly')).toEqual(['sports', 'car2', 'cars', 'vehicles', 'low', 'poly']);
  });
});
