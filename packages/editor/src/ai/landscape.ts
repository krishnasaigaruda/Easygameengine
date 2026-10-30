/*
 * Scenery tips. The assistant's model is good at games but weak at scenery (a field of spikes for
 * "mountains", trees up on the peaks, a valley for everything), so when a part it builds is about
 * the land, its trees, flowers, water or sky, it is told how to make what this request describes
 * well in this engine. It still writes and builds every step itself.
 */

const W = {
  ground: /terrain|ground|\bland\b|landscape|scenery|mountain|\bpeaks?\b|\bhills?\b|valley|meadow|\bfields?\b|desert|dunes?|island|canyon|plains?\b|prairie/,
  trees: /\btrees?\b|forest|\bwoods\b|\bpines?\b|\bfirs?\b|spruce|evergreen|\boaks?\b|birch|\bpalms?\b|jungle/,
  flowers: /flower|lupin|popp(y|ies)|dais(y|ies)|tulip|blossom|meadow/,
  grass: /grass|meadow|\bfields?\b|lawn|prairie|savann?ah?/,
  rocks: /\brocks?\b|boulder|\bstones\b/,
  water: /\blake\b|\bpond\b|\briver\b|\bstream\b|\bsea\b|\bocean\b|water|oasis/,
  sky: /\bsky\b|\bclouds?\b|cloudy|sunset|sunrise|\bdusk\b|\bdawn\b|evening|\bnight\b|daytime|\bday\b|\bsun\b|\bmoon\b/,
  fog: /\bfog\b|\bmist|\bhaze|\bhazy\b/,
};

/** Words that say what kind of land it is. */
const LAND = {
  island: /\bisland\b|\bbeach\b|\bocean\b|\bsea\b|coast|tropical|lagoon/,
  desert: /desert|\bdunes?\b|sahara|\bsandy\b/,
  plateaus: /canyon|\bmesas?\b|plateau|cliffs|badlands/,
  valley: /valley|between (the )?mountains|surrounded by (the )?mountains|mountains (all )?around/,
  mountains: /mountain|\bpeaks?\b|\balps\b|summit/,
  hills: /\bhills?\b|hilly|rolling|countryside/,
  gentle: /meadow|\bfields?\b|plains?\b|prairie|grassland|farm|\bpark\b|garden|lawn|savann?ah?/,
  woods: /forest|\bwoods\b|jungle/,
  winter: /winter|snowy|snow-covered|arctic|tundra|\bicy\b|frozen/,
};
/** Mountains seen from somewhere flat (a meadow, a village, a lake in front of them): a valley. */
const BACKDROP = /behind|background|distance|in the back|far away|around|surround/;
const FLAT_PLACE = /meadow|field|village|town|lake|farm|cabin|house|path|road|camp/;

/** The land a request describes: its shape and how to set it up. */
export interface Land {
  kind: 'island' | 'desert' | 'plateaus' | 'valley' | 'mountains' | 'hills' | 'meadow' | 'woods';
  preset: 'island' | 'hills' | 'plateaus' | 'valley' | 'mountains';
  /** In words, for the tip. */
  looks: string;
  /** Terrain settings after the preset (setting the preset resets height and snow). */
  set: [field: string, value: string][];
  /** Grass grows on it. */
  grass: boolean;
  /** Highest spot (fraction of the height) trees and flowers grow at. */
  treeLine: number;
  flowerLine: number;
}

/** A number from the request: the same request gets the same land, another gets another. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 9000) + 1;
}

const anyLand = (text: string) => Object.values(LAND).some((re) => re.test(text));

/**
 * The land this request (with what its picture shows) describes. `fallback` (the part's own
 * words) only counts when the request says nothing about the land, and never for a valley: the
 * model learned to put one everywhere.
 */
export function landFor(request: string, fallback = ''): Land {
  const r = request.toLowerCase();
  const f = anyLand(r) ? '' : fallback.toLowerCase().replace(/valley/g, '');
  const said = (re: RegExp) => re.test(r) || re.test(f);
  const seed: [string, string] = ['seed', String(seedOf(r))];
  const winter = said(LAND.winter);
  const snow: [string, string][] = winter ? [['snowLine', '0']] : [];
  if (said(LAND.island))
    return { kind: 'island', preset: 'island', looks: 'an island in the sea', set: [seed, ...snow], grass: !winter, treeLine: 0.9, flowerLine: 0.6 };
  if (said(LAND.desert))
    return {
      kind: 'desert',
      preset: 'hills',
      looks: 'low sandy dunes',
      set: [seed, ['maxHeight', '9'], ['roughness', '0.25'], ['layer1Color', '#d8bd85'], ['rockSlope', '30']],
      grass: false,
      treeLine: 1,
      flowerLine: 1,
    };
  if (said(LAND.plateaus))
    return { kind: 'plateaus', preset: 'plateaus', looks: 'flat-topped rock steps and cliffs', set: [seed, ...snow], grass: !winter, treeLine: 0.8, flowerLine: 0.8 };
  const mountains = said(LAND.mountains);
  if (said(LAND.valley) || (mountains && said(BACKDROP) && said(FLAT_PLACE)))
    return {
      kind: 'valley',
      preset: 'valley',
      looks: 'a flat valley floor you can walk on, with mountains around it',
      set: [seed, ['snowLine', winter ? '0' : /snow/.test(r) ? '0.55' : '0.68']],
      grass: !winter,
      treeLine: 0.6,
      flowerLine: 0.2,
    };
  if (mountains)
    return {
      kind: 'mountains',
      preset: 'mountains',
      looks: 'mountains with ridges and snowy tops',
      // Smoother ridges and bigger shapes (mountains, not a field of spikes), green on the lower slopes.
      set: [seed, ['roughness', '0.2'], ['features', '1'], ['maxHeight', '45'], ['rockSlope', '44'], ...snow],
      grass: !winter,
      treeLine: 0.55,
      flowerLine: 0.3,
    };
  const base = { set: [seed, ...snow] as [string, string][], grass: !winter, treeLine: 1, flowerLine: 1 };
  if (said(LAND.hills)) return { ...base, kind: 'hills', preset: 'hills', looks: 'rolling green hills' };
  if (said(LAND.gentle))
    return { ...base, kind: 'meadow', preset: 'hills', looks: 'gently rolling, nearly flat land', set: [...base.set, ['maxHeight', '5'], ['roughness', '0.3']] };
  if (said(LAND.woods)) return { ...base, kind: 'woods', preset: 'hills', looks: 'low wooded hills', set: [...base.set, ['maxHeight', '12']] };
  return { ...base, kind: 'hills', preset: 'hills', looks: 'rolling green hills' };
}

/** Water that fits the land: a river down the valley, lakes in the hollows, the sea round an island. */
function waterFor(land: Land, request: string): string {
  if (land.kind === 'island') return 'The sea: create water named "Sea" at [0,1.5,0] with size [400,1,400] (it makes the shore).';
  const river = /river|stream/.test(request);
  if (land.kind === 'valley')
    return `${river ? 'A river' : 'A lake'}: create water at [0,1.5,0] with size [${river ? '18,1,190' : '40,1,50'}] on the valley floor.`;
  // A wide sheet of water just above the lowest ground fills its hollows: lakes and ponds.
  const height = Number(land.set.find(([f]) => f === 'maxHeight')?.[1] ?? (land.preset === 'plateaus' ? 28 : 18));
  return `${river ? 'Water' : 'Lakes'}: create water at [0,${Math.round(height * 0.14 * 10) / 10},0] with size [220,1,220]: it fills the hollows of the land.`;
}

/**
 * Tips for one part of the build, or '' when the part isn't about scenery. `request`: the whole
 * request (with what an attached picture shows), for the kind of land. `defaultGround`: the new
 * project's flat Ground is still there. `terrain`: the land is already made (no ground tips).
 */
export function sceneryTips(
  part: string,
  request: string,
  opts: { defaultGround?: boolean; terrain?: boolean } = {},
): string {
  const p = part.toLowerCase();
  const r = request.toLowerCase();
  const all = `${p} ${r}`;
  const land = landFor(r, p);
  const tips: string[] = [];
  if (W.ground.test(p) && !opts.terrain) {
    const sets = land.set.map(([f, v]) => `${f} ${v}`).join(', ');
    tips.push(
      `The land here is ${land.looks}. ${opts.defaultGround ? 'Delete the flat "Ground" first, then create' : 'Create'} one terrain named "Land" and set its Terrain preset to "${land.preset}"${
        land.preset === 'valley' ? '' : ' (not "valley")'
      }, then set Terrain ${sets}.`,
    );
    if (land.kind === 'island') tips.push(waterFor(land, r));
  }
  if (W.grass.test(p) && land.grass) tips.push('Grass: create grass (it covers the terrain by itself).');
  if (W.trees.test(p)) {
    // The trees it asks for (or the picture shows): pines only when it says so, or up a mountain.
    const name = /\bpines?\b|\bfirs?\b|spruce|evergreen|conifer/.test(all)
      ? 'Pine Trees'
      : /\bpalms?\b|tropical|oasis/.test(all) || land.kind === 'island'
        ? 'Palm Trees'
        : land.kind === 'mountains'
          ? 'Pine Trees'
          : 'Trees';
    const count = land.kind === 'desert' ? 12 : LAND.woods.test(all) ? 300 : 140;
    tips.push(
      `Trees: create plants named "${name}" with count ${count}, then set its Scatter maxHeight to ${land.treeLine}${land.treeLine < 1 ? ' (below the bare tops)' : ''} and maxSlope to 34 (not on cliffs).`,
    );
  }
  if (W.flowers.test(p)) {
    const colors = [...new Set(all.match(/\b(purple|violet|orange|yellow|red|pink|blue|white)\b/g) ?? [])];
    tips.push(
      `Flowers: create plants named "Wildflowers" with count 12000, then set Scatter maxHeight ${land.flowerLine} and maxSlope 14${land.flowerLine < 1 ? ' (on the flat ground)' : ''}, minScale 1.4 and maxScale 2.4.${
        colors.length ? ` Their color: set Scatter color to the ${colors[0]} it says${colors.length > 1 ? ` (for ${colors.slice(1).join(' and ')} too, more Wildflowers with that color)` : ''}.` : ''
      }`,
    );
  }
  if (W.rocks.test(p)) tips.push(`Rocks: create plants named "Rocks" with count ${land.kind === 'desert' || land.kind === 'mountains' ? 80 : 40}.`);
  if (W.water.test(p) && !(land.kind === 'island' && W.ground.test(p))) tips.push(waterFor(land, r));
  if (W.sky.test(p))
    tips.push(
      'Sky: create sky, then set Sky hour (11 for day, 18.6 for sunset, 23 for night) and Sky clouds (0 to 1, about 0.45 for a cloudy sky). At night also set the exposure setting to 0.5.',
    );
  if (W.fog.test(p)) tips.push('Mist: create fog.');
  return tips.length ? `Tips for scenery in this engine:\n- ${tips.join('\n- ')}` : '';
}
