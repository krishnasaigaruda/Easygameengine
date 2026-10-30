import type { Entity } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { describePicture } from './pictures';

/*
 * The check before it says it's done: the scene as it is now, in words (and, when you gave a
 * picture, a picture of the scene put into words the same way), so the model can compare it with
 * what you asked for and keep building what's missing.
 */

export const checkSchema = {
  type: 'object',
  properties: { missing: { type: 'array', maxItems: 4, items: { type: 'string' } } },
  required: ['missing'],
};

export function checkSystem(dimension: '3d' | '2d'): string {
  return [
    `You check a ${dimension === '2d' ? '2D' : '3D'} scene being made in Easy Game Engine against what the user asked for, before telling them it is done.`,
    'Compare carefully, thing by thing: every object, building, animal, person, plant, effect (fire, smoke, rain…), the ground, water, sky, time of day, colors and where things are.',
    'missing: what is still missing or clearly wrong, as up to 4 short build instructions in the same style as a plan ("A wooden fence along the path", "Smoke rising from the chimney", "Make the sky a sunset"). Only things the request (or its picture) has. An empty list when the scene has everything.',
    'Never add again something the scene already has (look at its names: a House is there, so no "small house"). To fix something there, say what to change ("Make the house wooden", "Move the horse onto the path").',
  ].join('\n');
}

export function checkPrompt(ask: string, scene: string, looks: string, built: string[]): string {
  return [
    `The user asked for:\n${ask}`,
    `\nAlready built: ${built.join('; ')}.`,
    `\nThe scene now has: ${scene}.`,
    looks ? `\nA picture of the scene now shows: ${looks}` : '',
    '\nWhat is still missing or wrong?',
  ].join('');
}

const kindOf = (e: Entity): string => {
  const scatter = e.get('Scatter') as { shape?: string; count?: number } | undefined;
  if (scatter) return `${scatter.count ?? ''} ${scatter.shape === 'model' ? 'plant models' : `${scatter.shape}s`}`.trim();
  const terrain = e.get('Terrain') as { preset?: string } | undefined;
  if (terrain) return `ground shaped as ${terrain.preset ?? 'land'}${e.has('Grass') ? ', with grass' : ''}`;
  const sky = e.get('Sky') as { hour?: number; clouds?: number } | undefined;
  if (sky) return `sky at hour ${sky.hour ?? 12}, clouds ${sky.clouds ?? 0}`;
  if (e.has('ParticleSystem')) return 'effect';
  if (e.has('ModelRenderer')) return '3D model';
  const mesh = e.get('MeshRenderer') as { shape?: string; color?: string } | undefined;
  if (mesh) return `${mesh.shape ?? 'shape'}${mesh.color ? ` ${mesh.color}` : ''}`;
  return e.componentTypes().filter((c) => c !== 'Transform')[0] ?? 'empty';
};

/** Everything in the scene, short: copies of one thing ("Fence Post 1…12") as one line. */
export function describeScene(): string {
  const engine = useEditor.getState().engine;
  if (!engine) return 'nothing';
  const groups = new Map<string, { kind: string; n: number }>();
  for (const e of engine.world.all()) {
    if (e.has('Camera')) continue;
    const base = e.name.replace(/\s*\d+$/, '') || e.name;
    const kind = kindOf(e);
    const key = `${base}|${kind}`;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { kind, n: 1 });
  }
  const lines = [...groups].map(([key, g]) => `${g.n > 1 ? `${g.n} × ` : ''}${key.split('|')[0]} (${g.kind})`);
  return lines.slice(0, 60).join('; ') + (lines.length > 60 ? `; and ${lines.length - 60} more` : '') || 'nothing';
}

/** What the scene looks like from the view, in words (the picture reader). '' when it can't. */
export async function lookAtScene(): Promise<string> {
  const engine = useEditor.getState().engine;
  if (!engine) return '';
  try {
    // One fresh frame, read straight away (the canvas clears after it's shown).
    engine.renderer.render(engine.scene, engine.activeCamera);
    const shot = await new Promise<Blob | null>((res) => engine.renderer.domElement.toBlob(res, 'image/jpeg', 0.9));
    return shot ? await describePicture(shot) : '';
  } catch {
    return '';
  }
}
