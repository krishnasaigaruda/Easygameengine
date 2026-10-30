import * as THREE from 'three';
import type { System, World } from '../core/World';
import type { Entity } from '../core/Entity';
import { AudioSource, Music, type AudioSourceData } from '../components/audio';
import { CharacterController } from '../components/physics';
import type { AssetManager } from '../assets/AssetManager';
import type { RenderSystem } from '../render/RenderSystem';

interface Voice {
  sound: THREE.Audio | THREE.PositionalAudio;
  clip: string;
  spatial: boolean;
}

/**
 * Plays AudioSource components while the game runs. The listener (the "ears") follows the active
 * camera. Audio only exists in browsers; everything here is created lazily on first Play.
 */
export class AudioSystem implements System {
  readonly name = 'audio';
  readonly order = 1050;
  private world: World | null = null;
  private listener: THREE.AudioListener | null = null;
  private readonly voices = new Map<string, Voice>();
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private running = false;
  /** The one music track playing (background, not positional). */
  private music: { entityId: string; sound: THREE.Audio } | null = null;
  private unsubscribers: (() => void)[] = [];
  private readonly render: RenderSystem;
  private readonly assets: AssetManager;
  private readonly camera: () => THREE.Camera;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, render: RenderSystem, assets: AssetManager, camera: () => THREE.Camera) {
    this.scene = scene;
    this.render = render;
    this.assets = assets;
    this.camera = camera;
  }

  attach(world: World): void {
    this.world = world;
    this.unsubscribers = [
      world.events.on('entityDestroyed', ({ entity }) => this.release(entity.id)),
      world.events.on('componentRemoved', ({ entity, type }) => type === AudioSource.type && this.release(entity.id)),
      world.events.on('componentChanged', ({ entity, type }) => {
        if (type !== AudioSource.type || !this.running) return;
        const v = this.voices.get(entity.id);
        if (v) this.configure(v, entity.require(AudioSource));
      }),
      this.assets.events.on('changed', ({ id }) => this.buffers.delete(id)),
    ];
  }

  detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.setRunning(false);
    this.world = null;
  }

  setRunning(on: boolean): void {
    this.running = on;
    if (!on) {
      for (const id of [...this.voices.keys()]) this.release(id);
      if (this.music?.sound.isPlaying) this.music.sound.stop();
      this.music = null;
      for (const s of this.steps.values()) {
        if (s.sound.isPlaying) s.sound.stop();
        s.sound.removeFromParent();
      }
      this.steps.clear();
      this.underfoot.clear();
      this.lastPos.clear();
      return;
    }
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    if (!this.listener) {
      this.listener = new THREE.AudioListener();
      this.scene.add(this.listener);
    }
    void this.listener.context.resume?.();
    for (const e of this.world?.query(AudioSource) ?? []) {
      if (e.activeInHierarchy && e.require(AudioSource).playOnStart) void this.play(e);
    }
    const first = [...(this.world?.query(Music) ?? [])].find((e) => e.activeInHierarchy && e.require(Music).playOnStart);
    if (first) void this.playMusic(first);
  }

  /**
   * A one-shot sound (weapons, footsteps…): at a world position (3D) or everywhere (no position).
   * Fire-and-forget; plays only while the game runs.
   */
  async playClip(assetId: string, at?: THREE.Vector3 | null, volume = 1, rate = 1): Promise<void> {
    if (!this.running || !this.listener || !assetId) return;
    let buffer: AudioBuffer;
    try {
      buffer = await this.buffer(assetId);
    } catch {
      return;
    }
    if (!this.running || !this.listener) return;
    const sound = at ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener);
    sound.setBuffer(buffer);
    sound.setVolume(volume);
    sound.setPlaybackRate(rate);
    if (sound instanceof THREE.PositionalAudio && at) {
      sound.setRefDistance(4);
      sound.position.copy(at);
    }
    this.scene.add(sound);
    sound.onEnded = () => {
      sound.removeFromParent();
      sound.disconnect?.();
    };
    sound.play();
  }

  /**
   * Footsteps: a looping sound while a character walks on the ground. What it walks on picks the
   * sound (a Surface, a terrain layer); otherwise the character's own. The player gets surface
   * sounds even without one of its own; other characters are heard where they are.
   */
  private updateFootsteps(): void {
    for (const e of this.world?.query(CharacterController) ?? []) {
      const cc = e.require(CharacterController);
      const prev = this.lastPos.get(e.id);
      const node = this.render.nodeOf(e);
      const now = new THREE.Vector3().setFromMatrixPosition(node?.matrixWorld ?? new THREE.Matrix4());
      this.lastPos.set(e.id, now);
      if (!this.listener) continue;
      const dt = this.listener.context.currentTime - (this.lastTime.get(e.id) ?? 0);
      this.lastTime.set(e.id, this.listener.context.currentTime);
      const speed = prev && dt > 0 ? Math.hypot(now.x - prev.x, now.z - prev.z) / dt : 0;
      const walking = speed > 0.6 && Math.abs(now.y - (prev?.y ?? now.y)) / Math.max(dt, 1e-3) < 3 && (this.grounded?.(e) ?? true);
      // What's underfoot (undefined: not known this frame, keep the last).
      const under = this.surfaceSound?.(e);
      if (under !== undefined) this.underfoot.set(e.id, under);
      const surface = this.underfoot.get(e.id) ?? null;
      const clip = surface?.clip || (cc.footsteps || '');
      const heard = !!clip && (!!cc.footsteps || cc.playerControlled);
      let steps = this.steps.get(e.id);
      if (steps && (!heard || steps.clip !== clip)) {
        if (steps.sound.isPlaying) steps.sound.stop();
        steps.sound.removeFromParent();
        this.steps.delete(e.id);
        steps = undefined;
      }
      if (!heard) continue;
      if (!steps) {
        const key = `${e.id}:${clip}`;
        if (!walking || this.loadingSteps.has(key)) continue;
        this.loadingSteps.add(key);
        void this.buffer(clip).then(
          (b) => {
            this.loadingSteps.delete(key);
            if (!this.listener || !this.running || this.steps.has(e.id)) return;
            // Other characters' steps come from where they are.
            const sound = cc.playerControlled ? new THREE.Audio(this.listener) : new THREE.PositionalAudio(this.listener);
            if (sound instanceof THREE.PositionalAudio) {
              sound.setRefDistance(3);
              this.render.nodeOf(e)?.add(sound);
            }
            sound.setBuffer(b);
            sound.setLoop(true);
            this.steps.set(e.id, { sound, clip });
          },
          () => this.loadingSteps.delete(key),
        );
        continue;
      }
      steps.sound.setVolume(cc.footstepVolume * (surface?.clip ? surface.volume : 1));
      steps.sound.setPlaybackRate(THREE.MathUtils.clamp(speed / Math.max(1, cc.speed), 0.7, 1.6));
      if (walking && !steps.sound.isPlaying) steps.sound.play();
      else if (!walking && steps.sound.isPlaying) steps.sound.pause();
    }
  }

  private readonly steps = new Map<string, { sound: THREE.Audio | THREE.PositionalAudio; clip: string }>();
  private readonly loadingSteps = new Set<string>();
  private readonly underfoot = new Map<string, { clip: string; volume: number } | null>();
  private readonly lastPos = new Map<string, THREE.Vector3>();
  private readonly lastTime = new Map<string, number>();
  /** Optional: the footsteps sound of what a character stands on (null: nothing special; undefined: unknown). */
  surfaceSound?: (e: Entity) => { clip: string; volume: number } | null | undefined;
  /** Optional: is this character standing on something (from physics). */
  grounded?: (e: Entity) => boolean;

  /** Switch the background music to this object's Music (cross-fading). */
  async playMusic(e: Entity): Promise<void> {
    const data = e.get(Music);
    if (!this.running || !this.listener || !data?.track) return;
    if (this.music?.entityId === e.id && this.music.sound.isPlaying) return;
    const previous = this.music;
    const sound = new THREE.Audio(this.listener);
    this.music = { entityId: e.id, sound };
    try {
      sound.setBuffer(await this.buffer(data.track));
    } catch (err) {
      console.error(`[EGE] Music for "${e.name}" failed to load:`, err instanceof Error ? err.message : err);
      return;
    }
    if (this.music?.sound !== sound || !this.running) return;
    const ctx = this.listener.context;
    const now = ctx.currentTime;
    const fade = Math.max(0.01, data.fade);
    sound.setLoop(data.loop);
    sound.gain.gain.setValueAtTime(0, now);
    sound.gain.gain.linearRampToValueAtTime(data.volume, now + fade);
    sound.play();
    if (previous) this.fadeOut(previous.sound, fade);
  }

  /** Fade the music out (and stop it). */
  stopMusic(fade = 1.5): void {
    if (!this.music) return;
    this.fadeOut(this.music.sound, fade);
    this.music = null;
  }

  /** Which object's music is playing (tests, scripts). */
  get musicPlaying(): string | null {
    return this.music?.entityId ?? null;
  }

  private fadeOut(sound: THREE.Audio, seconds: number): void {
    if (!this.listener || !sound.isPlaying) return;
    const ctx = this.listener.context;
    const g = sound.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + seconds);
    setTimeout(() => {
      if (sound.isPlaying) sound.stop();
      sound.disconnect?.();
    }, seconds * 1000 + 50);
  }

  /** Play an object's Audio Source (from the start). */
  async play(e: Entity): Promise<void> {
    const data = e.get(AudioSource);
    if (!this.running || !this.listener || !data?.clip) return;
    let v = this.voices.get(e.id);
    if (!v || v.clip !== data.clip || v.spatial !== data.spatial) {
      this.release(e.id);
      const sound = data.spatial ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener);
      v = { sound, clip: data.clip, spatial: data.spatial };
      this.voices.set(e.id, v);
      this.render.nodeOf(e)?.add(sound);
      try {
        sound.setBuffer(await this.buffer(data.clip));
      } catch (err) {
        console.error(`[EGE] Sound for "${e.name}" failed to load:`, err instanceof Error ? err.message : err);
        return;
      }
      if (this.voices.get(e.id) !== v) return; // replaced or stopped while loading
    }
    this.configure(v, data);
    if (v.sound.isPlaying) v.sound.stop();
    v.sound.play();
  }

  stop(e: Entity): void {
    const v = this.voices.get(e.id);
    if (v?.sound.isPlaying) v.sound.stop();
  }

  isPlaying(e: Entity): boolean {
    return this.voices.get(e.id)?.sound.isPlaying ?? false;
  }

  lateUpdate(): void {
    if (!this.listener || !this.running) return;
    // The ears go wherever the camera is.
    const cam = this.camera();
    cam.updateWorldMatrix(true, false);
    cam.matrixWorld.decompose(this.listener.position, this.listener.quaternion, this.listener.scale);
    this.listener.scale.set(1, 1, 1);
    this.updateFootsteps();
  }

  private configure(v: Voice, data: AudioSourceData): void {
    v.sound.setVolume(data.volume);
    v.sound.setPlaybackRate(data.pitch);
    v.sound.setLoop(data.loop);
    if (v.sound instanceof THREE.PositionalAudio) {
      v.sound.setRefDistance(data.range);
      v.sound.setRolloffFactor(1.2);
      v.sound.setDistanceModel('inverse');
    }
  }

  private buffer(id: string): Promise<AudioBuffer> {
    let p = this.buffers.get(id);
    if (!p) {
      p = this.assets.resolve(id).then((a) => {
        const url = a.url(a.main);
        if (!url) throw new Error(`"${a.name}" has no file`);
        return new THREE.AudioLoader().loadAsync(url);
      });
      this.buffers.set(id, p);
      p.catch(() => this.buffers.delete(id));
    }
    return p;
  }

  private release(id: string): void {
    const v = this.voices.get(id);
    if (!v) return;
    if (v.sound.isPlaying) v.sound.stop();
    v.sound.removeFromParent();
    v.sound.disconnect?.();
    this.voices.delete(id);
  }
}
