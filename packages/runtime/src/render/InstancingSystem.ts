import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { ModelSystem } from './ModelSystem';
import type { RenderSystem } from './RenderSystem';

/** This many copies of one model (or more) are drawn together. */
const MIN_COPIES = 4;
/** Seconds between looks for new / removed copies (models load a moment after Play). */
const RESCAN = 0.5;
/** Copies just off screen still cast shadows into view: keep them within this margin (metres). */
const SHADOW_MARGIN = 20;

interface Member {
  entityId: string;
  meshes: THREE.Mesh[];
}
interface Group {
  members: Member[];
  /** One InstancedMesh per part of the model. */
  parts: THREE.InstancedMesh[];
}

const sphere = new THREE.Sphere();
const frustum = new THREE.Frustum();
const viewProj = new THREE.Matrix4();
const local = new THREE.Matrix4();
const rootInverse = new THREE.Matrix4();

/**
 * While the game runs: many copies of the same still model (no animation, no skinning) are drawn
 * with one GPU-instanced mesh per part instead of one draw per copy. The copies stay in the scene,
 * hidden, so physics, clicking and scripts still use them; every frame the instances follow them
 * (moved, scaled, hidden, off screen). Stop puts everything back.
 */
export class InstancingSystem implements System {
  readonly name = 'instancing';
  readonly order = 1005;
  private world: World | null = null;
  private running = false;
  private readonly groups = new Map<string, Group>();
  private sinceScan = Infinity;

  constructor(
    private readonly render: RenderSystem,
    private readonly models: ModelSystem,
    private readonly camera: () => THREE.Camera,
  ) {}

  attach(world: World): void {
    this.world = world;
  }

  detach(): void {
    this.clearAll();
    this.world = null;
  }

  setRunning(on: boolean): void {
    this.running = on;
    this.sinceScan = Infinity;
    if (!on) this.clearAll();
  }

  /** How many copies are currently drawn instanced (for tests and the profiler). */
  instancedCopies(): number {
    let n = 0;
    for (const g of this.groups.values()) n += g.members.length;
    return n;
  }

  update(dt: number): void {
    if (!this.running || !this.world) return;
    this.sinceScan += dt;
    if (this.sinceScan >= RESCAN) {
      this.sinceScan = 0;
      this.scan();
    }
    const cam = this.camera();
    cam.updateMatrixWorld();
    viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    this.render.root.updateWorldMatrix(true, false);
    rootInverse.copy(this.render.root.matrixWorld).invert();
    for (const g of this.groups.values()) this.sync(g);
  }

  /** Group the still models by what they draw; (re)build groups whose copies changed. */
  private scan(): void {
    const bySignature = new Map<string, Member[]>();
    for (const { entityId, assetId, object } of this.models.stillModels()) {
      const meshes: THREE.Mesh[] = [];
      let usable = true;
      object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if ((m as THREE.SkinnedMesh).isSkinnedMesh || m.morphTargetInfluences?.length || (m as THREE.InstancedMesh).isInstancedMesh) usable = false;
        // Parts the model itself hides stay hidden (ours are marked).
        else if (m.visible || m.userData.egeInstanced) meshes.push(m);
      });
      if (!usable || !meshes.length) continue;
      const sig = `${assetId}|${meshes.map((m) => `${m.geometry.uuid}:${materialKey(m.material)}:${+m.castShadow}${+m.receiveShadow}`).join(',')}`;
      let list = bySignature.get(sig);
      if (!list) bySignature.set(sig, (list = []));
      list.push({ entityId, meshes });
    }

    for (const [sig, g] of this.groups) {
      const now = bySignature.get(sig);
      if (!now || now.length < MIN_COPIES || !sameMembers(g, now)) {
        this.dispose(g);
        this.groups.delete(sig);
      }
    }
    for (const [sig, members] of bySignature) {
      if (members.length < MIN_COPIES || this.groups.has(sig)) continue;
      this.groups.set(sig, this.build(members));
    }
  }

  private build(members: Member[]): Group {
    const parts = members[0].meshes.map((m) => {
      const inst = new THREE.InstancedMesh(m.geometry, m.material, members.length);
      inst.name = `instanced ${m.name}`;
      inst.castShadow = m.castShadow;
      inst.receiveShadow = m.receiveShadow;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Culled per copy below; the whole batch is never skipped by three.js.
      inst.frustumCulled = false;
      inst.count = 0;
      this.render.root.add(inst);
      return inst;
    });
    for (const member of members)
      for (const m of member.meshes) {
        m.visible = false;
        m.userData.egeInstanced = true;
      }
    return { members, parts };
  }

  /** Copy every visible, on-screen copy's placement into the instances. */
  private sync(g: Group): void {
    for (const p of g.parts) p.count = 0;
    for (const member of g.members) {
      const first = member.meshes[0];
      // Shown? (hidden objects, inactive parents)
      let shown = true;
      for (let o: THREE.Object3D | null = first.parent; o && o !== this.render.root; o = o.parent) if (!o.visible) shown = false;
      if (!shown) continue;
      // A script swapped a material or mesh: rebuild at the next look.
      if (member.meshes.some((m, i) => m.material !== g.parts[i].material || m.geometry !== g.parts[i].geometry)) {
        this.sinceScan = RESCAN;
        continue;
      }
      first.parent?.updateWorldMatrix(true, true);
      member.meshes.forEach((m, i) => {
        const geo = m.geometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        sphere.copy(geo.boundingSphere!).applyMatrix4(m.matrixWorld);
        sphere.radius += SHADOW_MARGIN;
        if (!frustum.intersectsSphere(sphere)) return;
        const p = g.parts[i];
        local.multiplyMatrices(rootInverse, m.matrixWorld);
        p.setMatrixAt(p.count++, local);
      });
    }
    for (const p of g.parts) p.instanceMatrix.needsUpdate = true;
  }

  private dispose(g: Group): void {
    // Geometry and materials belong to the model: only the batches go.
    for (const p of g.parts) {
      p.removeFromParent();
      p.dispose();
    }
    for (const member of g.members)
      for (const m of member.meshes) {
        m.visible = true;
        delete m.userData.egeInstanced;
      }
  }

  private clearAll(): void {
    for (const g of this.groups.values()) this.dispose(g);
    this.groups.clear();
  }
}

function materialKey(m: THREE.Material | THREE.Material[]): string {
  return Array.isArray(m) ? m.map((x) => x.uuid).join('+') : m.uuid;
}

function sameMembers(g: Group, now: Member[]): boolean {
  if (g.members.length !== now.length) return false;
  for (let i = 0; i < now.length; i++) {
    const a = g.members[i];
    const b = now[i];
    if (a.entityId !== b.entityId || a.meshes.length !== b.meshes.length || a.meshes.some((m, j) => m !== b.meshes[j])) return false;
  }
  return true;
}
