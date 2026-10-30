import { openRemoveBackground } from '../assets/RemoveBackgroundDialog';
import { Animator, Camera, CharacterController, Collider, FollowCamera, LOOK_PRESETS, ModelRenderer, PARTICLE_PRESETS, ParticleSystem, PostProcessing, THREE, Traits, type Entity, type Vec3 } from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { AddComponentCommand } from '../commands/commands';
import { editComponent, runCommand } from './actions';
import { openAnimationStudio } from '../rigging/AnimationStudio';

export interface ComponentAction {
  label: string;
  icon: string;
  title: string;
  run: (entity: Entity) => void;
}

/**
 * Bounds of everything visible under the entity, in the entity's own (unscaled) space —
 * exactly the units Collider/CharacterController sizes use.
 */
function localBounds(entity: Entity): THREE.Box3 | null {
  const engine = useEditor.getState().engine;
  const node = engine?.render.nodeOf(entity);
  if (!node) return null;
  node.updateWorldMatrix(true, true);
  const toLocal = node.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.editorOnly) return;
    for (let p: THREE.Object3D | null = mesh; p && p !== node; p = p.parent) if (p.userData.entityId) return;
    mesh.geometry.computeBoundingBox();
    tmp.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld).applyMatrix4(toLocal);
    box.union(tmp);
  });
  return box.isEmpty() ? null : box;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const vec = (v: THREE.Vector3): Vec3 => [round(v.x), round(v.y), round(v.z)];

function fitCollider(entity: Entity): void {
  const box = localBounds(entity);
  if (!box) {
    useEditor.getState().log('warn', `${entity.name} has nothing visible to fit a collider to (is the model still loading?).`);
    return;
  }
  editComponent(
    entity,
    Collider.type,
    { shape: 'box', size: vec(box.getSize(new THREE.Vector3())), offset: vec(box.getCenter(new THREE.Vector3())) },
    'Fit collider',
  );
}

function fitCharacter(entity: Entity): void {
  const box = localBounds(entity);
  if (!box) {
    useEditor.getState().log('warn', `${entity.name} has nothing visible to fit to.`);
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const radius = round(Math.max(0.05, Math.min(Math.max(size.x, size.z) / 2, size.y / 2)));
  editComponent(
    entity,
    CharacterController.type,
    { height: round(size.y), radius, center: vec(box.getCenter(new THREE.Vector3())) },
    'Fit character',
  );
}

function ensure(entity: Entity, type: string, data?: object): void {
  if (entity.has(type)) {
    if (data) editComponent(entity, type, data);
  } else runCommand(new AddComponentCommand(entity, type, data));
}

/** Idle, walk and run by itself from how it moves. */
export function animate(entity: Entity): void {
  ensure(entity, Animator.type);
  const clips = useEditor.getState().engine?.models.clipsOf(entity) ?? [];
  useEditor
    .getState()
    .log('info', clips.length ? `${entity.name} now plays its idle / walk / run animations by itself.` : `Animator added. ${entity.name}'s model has no animations yet: pick an animated model (Asset Store, Animated tab).`);
}

/** A character that walks around (villager, enemy): animated, solid, moved by scripts and traits. */
function makeCharacter(entity: Entity, player: boolean): void {
  // Characters stand on their feet: models come in any size and pivot.
  const model = entity.get(ModelRenderer);
  const height = model?.fitHeight || 1.8;
  if (model && (!model.standOnGround || !model.fitHeight)) editComponent(entity, ModelRenderer.type, { standOnGround: true, fitHeight: height });
  ensure(entity, Animator.type);
  // A person-sized capsule from the feet up (measuring the model would include T-pose arms,
  // and the model may still be resizing).
  const radius = round(Math.min(0.45, Math.max(0.2, height * 0.17)));
  ensure(entity, CharacterController.type, { playerControlled: player, height: round(height), radius, center: [0, round(height / 2), 0] });
  if (!player) return;
  const traits = (entity.get(Traits) as { traits: string[] } | undefined)?.traits ?? [];
  ensure(entity, Traits.type, { traits: [...new Set([...traits, 'player'])] });
  // Point the game camera at it (third person; switch the mode to first person in the camera).
  const world = useEditor.getState().engine?.world;
  const cam = world ? [...world.query(Camera)].find((c) => (c.get(Camera) as { primary?: boolean }).primary) : undefined;
  if (cam) ensure(cam, FollowCamera.type, { target: entity.name });
  useEditor.getState().log('info', `${entity.name} is the player: WASD to walk, Shift to run, Space to jump.${cam ? ` ${cam.name} follows it.` : ''}`);
}

/** Extra buttons shown at the bottom of a component in the Inspector. */
export const COMPONENT_ACTIONS: Record<string, ComponentAction[]> = {
  Sprite: [
    {
      label: 'Remove background',
      icon: 'eraser',
      title: "Make the picture's background see-through",
      run: (e) => {
        const image = (e.get('Sprite') as { image?: string } | undefined)?.image;
        if (image) openRemoveBackground(image);
        else useEditor.getState().log('info', 'Give the sprite a picture first (Picture field), then remove its background.');
      },
    },
  ],
  [Collider.type]: [
    { label: 'Fit to object', icon: 'ruler', title: 'Make a box that tightly wraps what you see', run: fitCollider },
    {
      label: 'Auto shape',
      icon: 'wand',
      title: 'Match the visible shape automatically (exact mesh for imported models)',
      run: (e) => editComponent(e, Collider.type, { shape: 'auto', offset: [0, 0, 0] }, 'Auto collider'),
    },
  ],
  [PostProcessing.type]: Object.entries(LOOK_PRESETS).map(([name, values]) => ({
    label: name,
    icon: 'wand',
    title: `${name} look for the whole game`,
    run: (e: Entity) => editComponent(e, PostProcessing.type, values, `Look: ${name}`),
  })),
  [ParticleSystem.type]: Object.entries(PARTICLE_PRESETS).map(([name, values]) => ({
    label: name,
    icon: 'wand',
    title: `Make it look like ${name.toLowerCase()}`,
    run: (e: Entity) => editComponent(e, ParticleSystem.type, values, `Particles: ${name}`),
  })),
  [ModelRenderer.type]: [
    { label: 'Animation Studio', icon: 'activity', title: 'Give it a skeleton, pick free animations, make your own on a timeline, add code points', run: (e) => openAnimationStudio({ entityId: e.id }) },
    { label: 'Animate', icon: 'footprints', title: 'Add an Animator: plays idle, walk and run by itself from how it moves', run: animate },
    { label: 'Make it a character', icon: 'user', title: 'Animated, solid and able to walk (villagers, enemies)', run: (e) => makeCharacter(e, false) },
    { label: 'Make it the player', icon: 'gamepad', title: 'Walk with WASD; the game camera follows it', run: (e) => makeCharacter(e, true) },
  ],
  [CharacterController.type]: [
    { label: 'Fit to object', icon: 'ruler', title: 'Size the capsule to the character model', run: fitCharacter },
  ],
};
