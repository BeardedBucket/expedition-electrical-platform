import { describe, expect, it } from 'vitest';
import { serializePassportValue } from '../src/portable-json.js';

describe('shared portable snapshot ownership', () => {
  it('never executes an array accessor to obtain snapshot data', () => {
    let called = false;
    const array: unknown[] = [];
    Object.defineProperty(array, '0', {
      enumerable: true,
      get: () => {
        called = true;
        return 12;
      },
    });
    expect(() => serializePassportValue(array)).toThrow(/accessor/);
    expect(called).toBe(false);
  });
  it('rejects sparse arrays with extraneous keys even when enumerable count equals length', () => {
    const array: unknown[] = [12];
    array.length = 2;
    Object.assign(array, { extra: 24 });
    expect(() => serializePassportValue(array)).toThrow(/dense/);
  });
  it.each(['symbol', 'hidden'] as const)('rejects %s array state JSON would lose', (kind) => {
    const array = [12];
    if (kind === 'symbol') Object.defineProperty(array, Symbol('hidden'), { value: 24 });
    else Object.defineProperty(array, 'extra', { value: 24 });
    expect(() => serializePassportValue(array)).toThrow(/hide/);
  });
  it.each([undefined, NaN, Infinity, new Date(), new Map(), () => 12])(
    'rejects a nonportable value %s',
    (value) => {
      expect(() => serializePassportValue({ value })).toThrow();
    },
  );
  it('rejects cycles and retains explicit zero, false and null', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => serializePassportValue(cycle)).toThrow(/cycles/);
    expect(serializePassportValue({ value: null, flag: false, power: 0 })).toBe(
      '{"flag":false,"power":0,"value":null}',
    );
  });
});
