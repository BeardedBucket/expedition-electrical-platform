import Ajv2020 from 'ajv/dist/2020.js';
import component from '../../../data/schemas/component.schema.json' with { type: 'json' };
import generationInput from '../../../data/schemas/architecture-generation-input.schema.json' with { type: 'json' };
import generationPolicy from '../../../data/schemas/architecture-generation-policy.schema.json' with { type: 'json' };
import generation from '../../../data/schemas/architecture-generation.schema.json' with { type: 'json' };
import input from '../../../data/schemas/product-selection-input.schema.json' with { type: 'json' };
import policy from '../../../data/schemas/product-selection-policy.schema.json' with { type: 'json' };
import result from '../../../data/schemas/product-selection.schema.json' with { type: 'json' };
import { serializePassportValue } from './portable-json.js';
import { hasCurrentCanonicalVerification } from './canonical-verification.js';

type Validator = ((v: unknown) => boolean) & {
  errors?: readonly { instancePath?: string; message?: string }[];
};
const Ctor = Ajv2020 as unknown as new (o: Record<string, unknown>) => {
  addSchema(s: unknown): void;
  compile(s: unknown): Validator;
};
const ajv = new Ctor({
  allErrors: true,
  strict: false,
  strictNumbers: true,
  validateFormats: false,
});
for (const schema of [component, generationInput, generationPolicy, generation, input, policy])
  ajv.addSchema(schema);
const validators = {
  input: ajv.compile(input),
  policy: ajv.compile(policy),
  result: ajv.compile(result),
};
export const assertSelectionSchema = (value: unknown, kind: keyof typeof validators): void => {
  serializePassportValue(value);
  const validate = validators[kind];
  if (!validate(value))
    throw new TypeError(
      `Selection ${kind} schema rejected: ${(validate.errors ?? []).map((e) => `${e.instancePath}: ${e.message}`).join('; ')}`,
    );
  if (kind === 'input') {
    const corpus = (value as { corpus?: readonly Record<string, unknown>[] }).corpus ?? [];
    for (const record of corpus)
      if (record.verification_status === 'verified' && !hasCurrentCanonicalVerification(record))
        throw new TypeError('Canonical engineering verification is stale or invalid.');
  }
};
