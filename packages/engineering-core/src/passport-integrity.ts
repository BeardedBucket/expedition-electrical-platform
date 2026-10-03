import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };
import referenceSchema from '../../../data/schemas/reference-system.schema.json' with { type: 'json' };
import topologySchema from '../../../data/schemas/installed-power-topology.schema.json' with { type: 'json' };
import inputSchema from '../../../data/schemas/whole-system-input.schema.json' with { type: 'json' };
import passportSchema from '../../../data/schemas/engineering-passport.schema.json' with { type: 'json' };

/**
 * Passport owns strict portable JSON: reject values JSON would erase/coerce.
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
      if (
        entry.some((_value, index) => !Object.hasOwn(entry, index)) ||
        Object.keys(entry).length !== entry.length
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

type Validator = ((value: unknown) => boolean) & {
  errors?: readonly { instancePath?: string; message?: string }[];
};
const AjvCtor = Ajv2020 as unknown as new (options: Record<string, unknown>) => {
  addSchema(schema: unknown): void;
  compile(schema: unknown): Validator;
};
const ajv = new AjvCtor({ allErrors: true, strict: false, strictNumbers: true });
(addFormats as unknown as (instance: unknown) => void)(ajv);
for (const schema of [componentSchema, referenceSchema, topologySchema, inputSchema])
  ajv.addSchema(schema);
const validateInput = ajv.compile(inputSchema);
const validatePassport = ajv.compile(passportSchema);

export const assertPassportSchema = (value: unknown, kind: 'input' | 'passport'): void => {
  serializePassportValue(value);
  const validate = kind === 'input' ? validateInput : validatePassport;
  if (!validate(value))
    throw new TypeError(
      `${kind} schema rejected: ${(validate.errors ?? []).map((error) => `${error.instancePath}: ${error.message}`).join('; ')}`,
    );
};
