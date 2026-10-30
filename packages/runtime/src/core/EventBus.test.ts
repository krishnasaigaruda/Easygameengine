import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  it('delivers payloads and supports unsubscribe', () => {
    const bus = new EventBus<{ hit: number }>();
    const fn = vi.fn();
    const off = bus.on('hit', fn);
    bus.emit('hit', 5);
    off();
    bus.emit('hit', 6);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(5);
  });

  it('lets a handler unsubscribe itself mid-emit without skipping others', () => {
    const bus = new EventBus<{ e: void }>();
    const calls: string[] = [];
    const offA = bus.on('e', () => {
      calls.push('a');
      offA();
    });
    bus.on('e', () => calls.push('b'));
    bus.emit('e', undefined);
    bus.emit('e', undefined);
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});
