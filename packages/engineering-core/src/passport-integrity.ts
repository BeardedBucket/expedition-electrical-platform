import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };
import referenceSchema from '../../../data/schemas/reference-system.schema.json' with { type: 'json' };
import topologySchema from '../../../data/schemas/installed-power-topology.schema.json' with { type: 'json' };
import inputSchema from '../../../data/schemas/whole-system-input.schema.json' with { type: 'json' };
import passportSchema from '../../../data/schemas/engineering-passport.schema.json' with { type: 'json' };

export { passportDigest, serializePassportValue } from './portable-json.js';
import { serializePassportValue } from './portable-json.js';

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
