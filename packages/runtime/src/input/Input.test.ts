import { describe, expect, it } from 'vitest';
import { Input } from './Input';

const key = (type: string, code: string, repeat = false) =>
  Object.assign(new Event(type), { code, repeat });

describe('Input', () => {
  it('tracks held / pressed / released keys per frame', () => {
    const t = new EventTarget();
    const input = new Input(t);
    t.dispatchEvent(key('keydown', 'Space'));
    expect(input.isDown('Key:Space')).toBe(true);
    expect(input.actionPressed('jump')).toBe(true);
    input.endFrame();
    expect(input.actionPressed('jump')).toBe(false);
    expect(input.action('jump')).toBe(true);
    t.dispatchEvent(key('keydown', 'Space', true)); // auto-repeat is not a new press
    expect(input.actionPressed('jump')).toBe(false);
    t.dispatchEvent(key('keyup', 'Space'));
    expect(input.actionReleased('jump')).toBe(true);
    expect(input.action('jump')).toBe(false);
  });

  it('combines keys into axes', () => {
    const t = new EventTarget();
    const input = new Input(t);
    t.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.axis('moveY')).toBe(1);
    t.dispatchEvent(key('keydown', 'KeyS'));
    expect(input.axis('moveY')).toBe(0); // opposite keys cancel
    t.dispatchEvent(key('keydown', 'ArrowLeft'));
    expect(input.axis('moveX')).toBe(-1);
    expect(input.axis('nonexistent')).toBe(0);
  });

  it('releases everything on blur so keys never stick', () => {
    const t = new EventTarget();
    const input = new Input(t);
    t.dispatchEvent(key('keydown', 'KeyD'));
    t.dispatchEvent(new Event('blur'));
    expect(input.axis('moveX')).toBe(0);
  });

  it('accumulates pointer movement and resets it each frame', () => {
    const t = new EventTarget();
    const input = new Input(t);
    t.dispatchEvent(Object.assign(new Event('pointermove'), { movementX: 3, movementY: -2, clientX: 10, clientY: 20 }));
    t.dispatchEvent(Object.assign(new Event('pointermove'), { movementX: 1, movementY: 0, clientX: 11, clientY: 20 }));
    expect(input.pointer).toMatchObject({ dx: 4, dy: -2, x: 11, y: 20 });
    t.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
    expect(input.action('fire')).toBe(true);
    input.endFrame();
    expect(input.pointer.dx).toBe(0);
  });

  it('stops listening after dispose', () => {
    const t = new EventTarget();
    const input = new Input(t);
    input.dispose();
    t.dispatchEvent(key('keydown', 'Space'));
    expect(input.action('jump')).toBe(false);
  });
});

describe('touch', () => {
  it('a finger turns the camera, a quick tap is a click, the stick moves, buttons hold keys', () => {
    const target = new EventTarget();
    const input = new Input(target, target);
    const ev = (type: string, x: number, y: number) => target.dispatchEvent(Object.assign(new Event(type), { pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, button: 0 }));
    ev('pointerdown', 100, 100);
    expect(input.touch.looking).toBe(true);
    ev('pointermove', 130, 90);
    expect(input.pointer.dx).toBe(30);
    expect(input.pointer.dy).toBe(-10);
    expect(input.isDown('Mouse:0')).toBe(false); // looking isn't firing
    ev('pointerup', 130, 90);
    expect(input.touch.looking).toBe(false);
    expect(input.wasPressed('Mouse:0')).toBe(false); // it moved: not a tap
    input.endFrame();
    ev('pointerdown', 50, 50);
    ev('pointerup', 52, 51);
    expect(input.wasPressed('Mouse:0')).toBe(true); // a tap clicks
    input.touch.moveY = 0.8;
    expect(input.axis('moveY')).toBeCloseTo(0.8);
    input.holdVirtual('Touch:jump', true);
    expect(input.actionPressed('jump')).toBe(true);
    input.holdVirtual('Key:KeyC', true);
    expect(input.wasPressed('Key:KeyC')).toBe(true);
  });
});
