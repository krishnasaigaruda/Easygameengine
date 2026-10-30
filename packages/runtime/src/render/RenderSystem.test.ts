import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../core/World';
import { RenderSystem } from './RenderSystem';
import { Camera, Light, MeshRenderer, Transform } from '../components/builtin';

function setup() {
  const scene = new THREE.Scene();
  const world = new World();
  const render = new RenderSystem(scene);
  world.addSystem(render);
  return { scene, world, render };
}

describe('RenderSystem', () => {
  it('creates nodes mirroring the hierarchy and syncs transforms', () => {
    const { world, render } = setup();
    const parent = world.createEntity({ name: 'P' });
    parent.add(Transform, { position: [1, 0, 0], rotation: [0, 90, 0] });
    const child = world.createEntity({ name: 'C', parent });
    child.add(Transform, { position: [0, 2, 0] });
    world.update(0);
    const pn = render.nodeOf(parent)!;
    const cn = render.nodeOf(child)!;
    expect(cn.parent).toBe(pn);
    expect(pn.parent).toBe(render.root);
    expect(pn.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(cn.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([1, 2, 0]);

    child.require(Transform).position[1] = 5; // direct mutation, like scripts do
    world.update(0);
    expect(cn.position.y).toBe(5);
  });

  it('adds, updates and removes meshes; maps objects back to entities', () => {
    const { world, render } = setup();
    const e = world.createEntity();
    e.add(Transform);
    e.add(MeshRenderer, { shape: 'sphere', color: '#ff0000' });
    const mesh = render.nodeOf(e)!.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
    expect(mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    expect(render.entityFromObject(mesh)).toBe(e);

    e.set(MeshRenderer, { shape: 'box' });
    expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
    e.remove(MeshRenderer);
    expect(render.nodeOf(e)!.children.some((c) => c instanceof THREE.Mesh)).toBe(false);
  });

  it('rebuilds a light when its kind changes', () => {
    const { world, render } = setup();
    const e = world.createEntity();
    e.add(Light, { kind: 'point' });
    const node = render.nodeOf(e)!;
    expect(node.children.some((c) => c instanceof THREE.PointLight)).toBe(true);
    e.set(Light, { kind: 'directional', castShadow: true });
    expect(node.children.some((c) => c instanceof THREE.PointLight)).toBe(false);
    const sun = node.children.find((c) => c instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    expect(sun.castShadow).toBe(true);
  });

  it('reparents nodes, hides disabled entities, and cleans up on destroy', () => {
    const { world, render } = setup();
    const a = world.createEntity();
    const b = world.createEntity();
    world.setParent(b, a);
    expect(render.nodeOf(b)!.parent).toBe(render.nodeOf(a));
    a.enabled = false;
    expect(render.nodeOf(a)!.visible).toBe(false);
    world.destroyEntity(a);
    expect(render.nodeOf(a)).toBeUndefined();
    expect(render.nodeOf(b)).toBeUndefined();
    expect(render.root.children).toHaveLength(0);
  });

  it('prefers the primary camera of an active entity', () => {
    const { world, render } = setup();
    expect(render.sceneCamera()).toBeUndefined();
    const a = world.createEntity();
    a.add(Camera, { primary: false });
    const b = world.createEntity();
    b.add(Camera, { primary: true, fov: 40 });
    expect(render.sceneCamera()?.fov).toBe(40);
    b.enabled = false;
    expect(render.sceneCamera()).toBe(render.nodeOf(a)!.children[0]);
  });

  it('builds visuals for entities that existed before attach', () => {
    const scene = new THREE.Scene();
    const world = new World();
    const e = world.createEntity();
    e.add(MeshRenderer);
    const render = new RenderSystem(scene);
    world.addSystem(render);
    expect(render.nodeOf(e)!.children[0]).toBeInstanceOf(THREE.Mesh);
  });
});
