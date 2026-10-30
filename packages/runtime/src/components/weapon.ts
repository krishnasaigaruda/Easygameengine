import { defineComponent } from '../core/Component';

export const WEAPON_KINDS = ['gun', 'projectile', 'melee'] as const;
export const WEAPON_AIMS = ['auto', 'camera', 'facing'] as const;
export const WEAPON_LOOKS = ['none', 'pistol', 'rifle', 'shotgun', 'bow', 'sword', 'model'] as const;

export interface WeaponData {
  /** gun: hits instantly along a line. projectile: arrows, rockets, fireballs that fly (and fall). melee: hits what's in front. */
  kind: (typeof WEAPON_KINDS)[number];
  /** camera: where you look (first person). facing: where the character faces (third person, top-down). auto: picks for you. */
  aim: (typeof WEAPON_AIMS)[number];
  damage: number;
  /** Attacks per second. */
  fireRate: number;
  /** Keep firing while the button is held. */
  automatic: boolean;
  /** How far it reaches (meters). */
  range: number;
  /** Random spread in degrees (0 = perfectly accurate). */
  spread: number;
  /** Shots per pull (shotguns: 8). */
  pellets: number;
  /** Shots before reloading (0 = never reload). */
  magazine: number;
  /** Spare ammo (-1 = endless). */
  reserve: number;
  reloadTime: number;
  /** Projectile speed (m/s) and how much gravity pulls it (arrows ~1, rockets 0). */
  projectileSpeed: number;
  projectileGravity: number;
  projectileColor: string;
  /** Shove what it hits (m/s). */
  knockback: number;
  /** Camera kick per shot (degrees). */
  recoil: number;
  /** What you hold. In first person it's shown in your hands. */
  look: (typeof WEAPON_LOOKS)[number];
  model: string;
  /** Only the player fires with the mouse; others fire when a script says { fire: "self" }. */
  playerControlled: boolean;
  /** Sounds: when it fires / swings, and when it hits something. */
  fireSound: string;
  hitSound: string;
}

export const Weapon = defineComponent<WeaponData>({
  type: 'Weapon',
  label: 'Weapon',
  icon: 'crosshair',
  category: 'Gameplay',
  description: 'Guns, bows and swords: click to attack, R to reload. Hits call "takeDamage" on things with health. Ammo shows as self.ammo.',
  defaults: () => ({
    kind: 'gun',
    aim: 'auto',
    damage: 25,
    fireRate: 4,
    automatic: false,
    range: 120,
    spread: 1,
    pellets: 1,
    magazine: 12,
    reserve: 60,
    reloadTime: 1.4,
    projectileSpeed: 45,
    projectileGravity: 1,
    projectileColor: '#ffd27a',
    knockback: 2,
    recoil: 1.2,
    look: 'pistol',
    model: '',
    playerControlled: true,
    fireSound: '',
    hitSound: '',
  }),
  fields: {
    kind: { kind: 'enum', label: 'Kind', options: WEAPON_KINDS },
    look: { kind: 'enum', label: 'Looks like', options: WEAPON_LOOKS },
    model: { kind: 'asset', label: 'Model', assetType: 'model' },
    aim: { kind: 'enum', label: 'Aim', options: WEAPON_AIMS },
    damage: { kind: 'number', label: 'Damage', min: 0, max: 1000, step: 1 },
    fireRate: { kind: 'number', label: 'Attacks per second', min: 0.1, max: 30, step: 0.1 },
    automatic: { kind: 'boolean', label: 'Automatic' },
    range: { kind: 'number', label: 'Range (m)', min: 0.5, max: 2000, step: 0.5 },
    spread: { kind: 'number', label: 'Spread (°)', min: 0, max: 45, step: 0.1 },
    pellets: { kind: 'number', label: 'Pellets', min: 1, max: 30, step: 1 },
    magazine: { kind: 'number', label: 'Magazine (0 = no reload)', min: 0, max: 500, step: 1 },
    reserve: { kind: 'number', label: 'Spare ammo (-1 = endless)', min: -1, max: 9999, step: 1 },
    reloadTime: { kind: 'number', label: 'Reload time (s)', min: 0, max: 10, step: 0.05 },
    projectileSpeed: { kind: 'number', label: 'Projectile speed', min: 1, max: 500, step: 1 },
    projectileGravity: { kind: 'number', label: 'Projectile drop', min: 0, max: 5, step: 0.05 },
    projectileColor: { kind: 'color', label: 'Projectile color' },
    knockback: { kind: 'number', label: 'Knockback', min: 0, max: 50, step: 0.5 },
    recoil: { kind: 'number', label: 'Recoil (°)', min: 0, max: 20, step: 0.1 },
    playerControlled: { kind: 'boolean', label: 'Fire with the mouse' },
    fireSound: { kind: 'asset', label: 'Fire sound', assetType: 'audio' },
    hitSound: { kind: 'asset', label: 'Hit sound', assetType: 'audio' },
  },
});

/** Ready-made settings for common weapons. */
export const WEAPON_PRESETS: Record<string, Partial<WeaponData>> = {
  Pistol: { kind: 'gun', look: 'pistol', damage: 25, fireRate: 4, automatic: false, spread: 1, pellets: 1, magazine: 12, reserve: 60, reloadTime: 1.2, recoil: 1.5, knockback: 2 },
  Rifle: { kind: 'gun', look: 'rifle', damage: 20, fireRate: 10, automatic: true, spread: 1.5, pellets: 1, magazine: 30, reserve: 150, reloadTime: 1.8, recoil: 0.8, knockback: 1.5 },
  Shotgun: { kind: 'gun', look: 'shotgun', damage: 12, fireRate: 1.2, automatic: false, spread: 7, pellets: 8, magazine: 6, reserve: 36, reloadTime: 2.2, recoil: 4, knockback: 6, range: 40 },
  Bow: { kind: 'projectile', look: 'bow', damage: 45, fireRate: 1.2, automatic: false, spread: 0.3, pellets: 1, magazine: 0, reserve: 30, projectileSpeed: 48, projectileGravity: 1, projectileColor: '#c9a66b', recoil: 0.5, knockback: 3 },
  'Rocket launcher': { kind: 'projectile', look: 'rifle', damage: 90, fireRate: 0.8, automatic: false, spread: 0, magazine: 1, reserve: 12, reloadTime: 1.6, projectileSpeed: 30, projectileGravity: 0, projectileColor: '#ff7a2e', recoil: 3, knockback: 14 },
  Sword: { kind: 'melee', look: 'sword', damage: 35, fireRate: 1.8, range: 2.4, spread: 50, magazine: 0, reserve: -1, recoil: 0, knockback: 5 },
  Fists: { kind: 'melee', look: 'none', damage: 10, fireRate: 2.5, range: 1.6, spread: 40, magazine: 0, reserve: -1, recoil: 0, knockback: 3 },
};
