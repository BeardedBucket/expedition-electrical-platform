import Ajv2020 from 'ajv/dist/2020.js';
import component from '../../../data/schemas/component.schema.json' with { type: 'json' };
import generationInput from '../../../data/schemas/architecture-generation-input.schema.json' with { type: 'json' };
import generationPolicy from '../../../data/schemas/architecture-generation-policy.schema.json' with { type: 'json' };
import generation from '../../../data/schemas/architecture-generation.schema.json' with { type: 'json' };
import selectionInput from '../../../data/schemas/product-selection-input.schema.json' with { type: 'json' };
import selectionPolicy from '../../../data/schemas/product-selection-policy.schema.json' with { type: 'json' };
import selection from '../../../data/schemas/product-selection.schema.json' with { type: 'json' };
import reference from '../../../data/schemas/reference-system.schema.json' with { type: 'json' };
import topology from '../../../data/schemas/installed-power-topology.schema.json' with { type: 'json' };
import wholeInput from '../../../data/schemas/whole-system-input.schema.json' with { type: 'json' };
import input from '../../../data/schemas/recommendation-input.schema.json' with { type: 'json' };
import policy from '../../../data/schemas/recommendation-policy.schema.json' with { type: 'json' };
import result from '../../../data/schemas/recommendation.schema.json' with { type: 'json' };
import { serializePassportValue } from './portable-json.js';

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
for (const schema of [
  component,
  reference,
  topology,
  wholeInput,
  generationInput,
  generationPolicy,
  generation,
  selectionInput,
  selectionPolicy,
  selection,
  input,
  policy,
])
  ajv.addSchema(schema);
const validators = {
  input: ajv.compile(input),
  policy: ajv.compile(policy),
  result: ajv.compile(result),
};
export const assertRecommendationSchema = (value: unknown, kind: keyof typeof validators): void => {
  serializePassportValue(value);
  const validate = validators[kind];
  if (!validate(value))
    throw new TypeError(
      `Recommendation ${kind} schema rejected: ${(validate.errors ?? []).map((e) => `${e.instancePath}: ${e.message}`).join('; ')}`,
    );
};
