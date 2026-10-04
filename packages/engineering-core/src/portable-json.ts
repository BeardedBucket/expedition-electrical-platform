import { createHash } from 'node:crypto';

/**
 * Shared backend snapshot encoding: reject values JSON would erase/coerce.
 * Sort object keys by code point, preserve all array order (including route order).
 * No locale, wall clock or global hash state participates. SHA-256 protects
 * snapshot comparison; it is not a signature or manufacturer certification.
 */
export const serializePassportValue = (value: unknown): string => {
  const ancestors = new Set<object>();
  const visit = (entry: unknown): string => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean')
      return JSON.stringify(entry);
    if (typeof entry === 'number' && Number.isFinite(entry)) return JSON.stringify(entry);
    if (typeof entry !== 'object' || entry === null)
      throw new TypeError(
        'Passport inputs must be finite portable JSON; undefined is not an unknown value.',
      );
    if (ancestors.has(entry)) throw new TypeError('Passport inputs cannot contain cycles.');
    ancestors.add(entry);
    let result: string;
    if (Array.isArray(entry)) {
      // Array indexes are also snapshot data, not executable getters. Check
      // descriptors before reading elements. Length is the intrinsic exception.
      if (
        Reflect.ownKeys(entry).some(
          (key) =>
            key !== 'length' &&
            (typeof key !== 'string' ||
              !Object.getOwnPropertyDescriptor(entry, key)?.enumerable ||
              Object.getOwnPropertyDescriptor(entry, key)?.get ||
              Object.getOwnPropertyDescriptor(entry, key)?.set),
        )
      )
        throw new TypeError(
          'Passport arrays cannot hide symbol, non-enumerable or accessor properties.',
        );
      const keys = Object.keys(entry);
      if (
        keys.length !== entry.length ||
        keys.some((key) => {
          const index = Number(key);
          return (
            !Number.isInteger(index) || index < 0 || index >= entry.length || String(index) !== key
          );
        })
      )
        throw new TypeError('Passport arrays must be dense JSON arrays.');
      result = `[${entry.map(visit).join(',')}]`;
    } else {
      if (
        Object.getPrototypeOf(entry) !== Object.prototype &&
        Object.getPrototypeOf(entry) !== null
      )
        throw new TypeError('Passport objects must be plain JSON objects.');
      if (
        Reflect.ownKeys(entry).some(
          (key) =>
            typeof key !== 'string' ||
            !Object.getOwnPropertyDescriptor(entry, key)?.enumerable ||
            Object.getOwnPropertyDescriptor(entry, key)?.get ||
            Object.getOwnPropertyDescriptor(entry, key)?.set,
        )
      )
        throw new TypeError(
          'Passport objects cannot hide symbol, non-enumerable or accessor properties.',
        );
      result = `{${Object.keys(entry)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit((entry as Record<string, unknown>)[key])}`)
        .join(',')}}`;
    }
    ancestors.delete(entry);
    return result;
  };
  return visit(value);
};

export const passportDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(serializePassportValue(value), 'utf8').digest('hex')}`;
