/**
 * Keyboard, mouse/touch (pointer) and gamepad input, plus named actions/axes so game
 * logic says `input.action('jump')` instead of caring which key or button was used.
 *
 * Binding strings: "Key:<KeyboardEvent.code>", "Mouse:<button>", "Pad:<button index>".
 */

export interface AxisBinding {
  negative: string[];
  positive: string[];
  /** Gamepad axis index (standard mapping: 0/1 left stick, 2/3 right stick). */
  padAxis?: number;
  /** Flip the gamepad axis (stick "up" is -1 on gamepads). */
  invertPad?: boolean;
}

export interface InputBindings {
  actions: Record<string, string[]>;
  axes: Record<string, AxisBinding>;
}

export function defaultBindings(): InputBindings {
  return {
    actions: {
      jump: ['Key:Space', 'Pad:0', 'Touch:jump'],
      run: ['Key:ShiftLeft', 'Key:ShiftRight', 'Pad:10', 'Touch:run'],
      crouch: ['Key:KeyC', 'Key:ControlLeft', 'Pad:1', 'Touch:crouch'],
      interact: ['Key:KeyE', 'Pad:2', 'Touch:interact'],
      fire: ['Mouse:0', 'Pad:7', 'Touch:fire'],
      aim: ['Mouse:2', 'Pad:6', 'Touch:aim'],
      pause: ['Key:Escape', 'Key:KeyP', 'Pad:9', 'Touch:pause'],
    },
    axes: {
      moveX: { negative: ['Key:KeyA', 'Key:ArrowLeft'], positive: ['Key:KeyD', 'Key:ArrowRight'], padAxis: 0 },
      moveY: {
        negative: ['Key:KeyS', 'Key:ArrowDown'],
        positive: ['Key:KeyW', 'Key:ArrowUp'],
        padAxis: 1,
        invertPad: true,
      },
      lookX: { negative: [], positive: [], padAxis: 2 },
      lookY: { negative: [], positive: [], padAxis: 3, invertPad: true },
    },
  };
}

const PAD_DEADZONE = 0.15;

type KeyLike = Event & { code?: string; repeat?: boolean };
type PointerLike = Event & {
  button?: number;
  pointerType?: string;
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  movementX?: number;
  movementY?: number;
};
type WheelLike = Event & { deltaY?: number };

export class Input {
  bindings: InputBindings;

  /** Pointer position in pixels relative to the element's top-left. */
  readonly pointer = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0 };

  /** Touch screens: the on-screen stick (-1…1) and whether a finger is turning the camera. */
  readonly touch = { moveX: 0, moveY: 0, looking: false };
  private touchFinger: { id: number; x: number; y: number; startX: number; startY: number; at: number } | null = null;

  /** On-screen buttons: hold or let go of a binding ("Touch:jump"). */
  holdVirtual(binding: string, on: boolean): void {
    if (on) this.press(binding);
    else this.release(binding);
  }

  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private padAxes: number[] = [];
  private padButtons: boolean[] = [];
  private readonly pointerTarget: EventTarget;
  private readonly listeners: [EventTarget, string, EventListener][] = [];

  /**
   * @param keyTarget where keyboard events are read (usually `window`)
   * @param pointerTarget where mouse/touch events are read (usually the game canvas)
   */
  constructor(keyTarget: EventTarget, pointerTarget: EventTarget = keyTarget, bindings = defaultBindings()) {
    this.pointerTarget = pointerTarget;
    this.bindings = bindings;

    this.listen(keyTarget, 'keydown', (e: KeyLike) => {
      if (e.code && !e.repeat) this.press(`Key:${e.code}`);
    });
    this.listen(keyTarget, 'keyup', (e: KeyLike) => {
      if (e.code) this.release(`Key:${e.code}`);
    });
    // Losing focus means we'll never see the keyup; drop everything so keys don't stick.
    this.listen(keyTarget, 'blur', () => this.releaseAll());

    this.listen(pointerTarget, 'pointerdown', (e: PointerLike) => {
      this.trackPointer(e);
      // A finger on the game turns the camera; a quick tap is a click (pointerup).
      if (e.pointerType === 'touch') {
        if (!this.touchFinger) {
          const x = e.clientX ?? 0;
          const y = e.clientY ?? 0;
          this.touchFinger = { id: e.pointerId ?? 0, x, y, startX: x, startY: y, at: performance.now() };
          this.touch.looking = true;
        }
        return;
      }
      this.press(`Mouse:${e.button ?? 0}`);
    });
    // Released anywhere counts, otherwise dragging off the canvas leaves the button stuck.
    this.listen(keyTarget, 'pointerup', (e: PointerLike) => {
      const f = this.touchFinger;
      if (e.pointerType === 'touch') {
        if (f && (e.pointerId ?? 0) === f.id) {
          const moved = Math.hypot((e.clientX ?? 0) - f.startX, (e.clientY ?? 0) - f.startY);
          if (moved < 12 && performance.now() - f.at < 350) {
            this.press('Mouse:0');
            this.release('Mouse:0');
          }
          this.touchFinger = null;
          this.touch.looking = false;
        }
        return;
      }
      this.release(`Mouse:${e.button ?? 0}`);
    });
    this.listen(pointerTarget, 'pointermove', (e: PointerLike) => {
      const f = this.touchFinger;
      if (e.pointerType === 'touch') {
        if (f && (e.pointerId ?? 0) === f.id) {
          // Touch has no movementX everywhere: measure it.
          this.pointer.dx += (e.clientX ?? 0) - f.x;
          this.pointer.dy += (e.clientY ?? 0) - f.y;
          f.x = e.clientX ?? 0;
          f.y = e.clientY ?? 0;
        }
        this.trackPointer(e);
        return;
      }
      this.pointer.dx += e.movementX ?? 0;
      this.pointer.dy += e.movementY ?? 0;
      this.trackPointer(e);
    });
    this.listen(pointerTarget, 'wheel', (e: WheelLike) => {
      this.pointer.wheel += Math.sign(e.deltaY ?? 0);
    });
  }

  /** Call once at the start of each frame (polls gamepads). */
  beginFrame(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p): p is Gamepad => !!p && p.connected);
    if (!pad) {
      for (let i = 0; i < this.padButtons.length; i++) if (this.padButtons[i]) this.release(`Pad:${i}`);
      this.padButtons = [];
      this.padAxes = [];
      return;
    }
    this.padAxes = pad.axes.map((a) => (Math.abs(a) < PAD_DEADZONE ? 0 : a));
    pad.buttons.forEach((b, i) => {
      const was = this.padButtons[i] ?? false;
      if (b.pressed && !was) this.press(`Pad:${i}`);
      if (!b.pressed && was) this.release(`Pad:${i}`);
      this.padButtons[i] = b.pressed;
    });
  }

  /** Call once at the end of each frame (clears one-frame state). */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.pointer.dx = this.pointer.dy = this.pointer.wheel = 0;
  }

  /** Raw binding is held, e.g. isDown("Key:KeyW"). */
  isDown(binding: string): boolean {
    return this.down.has(binding);
  }
  wasPressed(binding: string): boolean {
    return this.pressed.has(binding);
  }
  wasReleased(binding: string): boolean {
    return this.released.has(binding);
  }

  /** Named action is held (e.g. "run"). */
  action(name: string): boolean {
    return this.bindings.actions[name]?.some((b) => this.down.has(b)) ?? false;
  }
  /** Named action went down this frame (e.g. "jump"). */
  actionPressed(name: string): boolean {
    return this.bindings.actions[name]?.some((b) => this.pressed.has(b)) ?? false;
  }
  actionReleased(name: string): boolean {
    return this.bindings.actions[name]?.some((b) => this.released.has(b)) ?? false;
  }

  /** Named axis in -1..1, combining keys and gamepad stick. */
  axis(name: string): number {
    const a = this.bindings.axes[name];
    if (!a) return 0;
    let v = 0;
    if (a.positive.some((b) => this.down.has(b))) v += 1;
    if (a.negative.some((b) => this.down.has(b))) v -= 1;
    if (a.padAxis !== undefined) {
      const pv = (this.padAxes[a.padAxis] ?? 0) * (a.invertPad ? -1 : 1);
      if (Math.abs(pv) > Math.abs(v)) v = pv;
    }
    const tv = name === 'moveX' ? this.touch.moveX : name === 'moveY' ? this.touch.moveY : 0;
    if (Math.abs(tv) > Math.abs(v)) v = tv;
    return Math.max(-1, Math.min(1, v));
  }

  dispose(): void {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners.length = 0;
    this.releaseAll();
  }

  private listen<E extends Event>(target: EventTarget, type: string, fn: (e: E) => void): void {
    const listener = fn as EventListener;
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  private press(binding: string): void {
    if (this.down.has(binding)) return;
    this.down.add(binding);
    this.pressed.add(binding);
  }

  private release(binding: string): void {
    if (!this.down.delete(binding)) return;
    this.released.add(binding);
  }

  private releaseAll(): void {
    for (const b of this.down) this.released.add(b);
    this.down.clear();
  }

  private trackPointer(e: PointerLike): void {
    const el = this.pointerTarget as Partial<Element>;
    const rect = el.getBoundingClientRect?.();
    this.pointer.x = (e.clientX ?? 0) - (rect?.left ?? 0);
    this.pointer.y = (e.clientY ?? 0) - (rect?.top ?? 0);
  }
}
