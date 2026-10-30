import { defineComponent } from '../core/Component';

export interface AudioSourceData {
  /** Audio asset (.mp3 .ogg .wav). */
  clip: string;
  volume: number;
  pitch: number;
  loop: boolean;
  /** Start playing when the game starts. */
  playOnStart: boolean;
  /** 3D sound: quieter with distance, panned left/right. Off = same everywhere (music). */
  spatial: boolean;
  /** Distance (m) at which it starts getting quieter. */
  range: number;
}

export const AudioSource = defineComponent<AudioSourceData>({
  type: 'AudioSource',
  label: 'Audio Source',
  icon: 'volume',
  category: 'Audio',
  description: 'Plays a sound: music, footsteps, waterfalls. 3D sounds get quieter with distance.',
  defaults: () => ({ clip: '', volume: 1, pitch: 1, loop: false, playOnStart: true, spatial: true, range: 6 }),
  fields: {
    clip: { kind: 'asset', label: 'Sound', assetType: 'audio' },
    volume: { kind: 'number', label: 'Volume', min: 0, max: 2, step: 0.01 },
    pitch: { kind: 'number', label: 'Pitch', min: 0.25, max: 4, step: 0.01 },
    loop: { kind: 'boolean', label: 'Loop' },
    playOnStart: { kind: 'boolean', label: 'Play on start' },
    spatial: { kind: 'boolean', label: '3D sound' },
    range: { kind: 'number', label: 'Range (m)', min: 0.1, max: 200, step: 0.5 },
  },
});

export interface MusicData {
  /** Music file (.mp3 .ogg .wav), e.g. from the Asset Store's Music tab. */
  track: string;
  volume: number;
  /** Start when the game starts (otherwise a script plays it: { playMusic: "Battle Music" }). */
  playOnStart: boolean;
  loop: boolean;
  /** Seconds to fade in, and to cross-fade from the music that was playing. */
  fade: number;
}

export const Music = defineComponent<MusicData>({
  type: 'Music',
  label: 'Music',
  icon: 'music',
  category: 'Audio',
  description: 'Background music (same volume everywhere). Only one plays at a time; switching cross-fades.',
  defaults: () => ({ track: '', volume: 0.55, playOnStart: true, loop: true, fade: 2 }),
  fields: {
    track: { kind: 'asset', label: 'Track', assetType: 'audio' },
    volume: { kind: 'number', label: 'Volume', min: 0, max: 1, step: 0.01 },
    playOnStart: { kind: 'boolean', label: 'Play when the game starts' },
    loop: { kind: 'boolean', label: 'Loop' },
    fade: { kind: 'number', label: 'Fade (s)', min: 0, max: 10, step: 0.1 },
  },
});

export interface SurfaceData {
  /** What walking on it sounds like (looping steps: wood, stone, gravel…). */
  footsteps: string;
  volume: number;
}

export const Surface = defineComponent<SurfaceData>({
  type: 'Surface',
  label: 'Surface',
  icon: 'footprints',
  category: 'Audio',
  description: 'What walking on this sounds like: a wooden bridge, a stone floor. Characters\' footsteps change when they step on it. (On a terrain, each layer can have its own sound too.)',
  defaults: () => ({ footsteps: '', volume: 1 }),
  fields: {
    footsteps: { kind: 'asset', label: 'Footsteps sound', assetType: 'audio' },
    volume: { kind: 'number', label: 'Volume', min: 0, max: 2, step: 0.01 },
  },
});
