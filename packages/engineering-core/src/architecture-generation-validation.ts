import Ajv2020 from 'ajv/dist/2020.js';
import inputSchema from '../../../data/schemas/architecture-generation-input.schema.json' with { type: 'json' };
import policySchema from '../../../data/schemas/architecture-generation-policy.schema.json' with { type: 'json' };
import resultSchema from '../../../data/schemas/architecture-generation.schema.json' with { type: 'json' };
import { serializePassportValue } from './portable-json.js';
import type {
  ArchitectureGenerationInput,
  ArchitectureGenerationPolicy,
} from './architecture-generation-contracts.js';

type Validator = ((value: unknown) => boolean) & {
  errors?: readonly { instancePath?: string; message?: string }[];
};
const AjvCtor = Ajv2020 as unknown as new (options: Record<string, unknown>) => {
  addSchema(schema: unknown): void;
  compile(schema: unknown): Validator;
};
const ajv = new AjvCtor({ allErrors: true, strict: false, strictNumbers: true });
ajv.addSchema(inputSchema);
ajv.addSchema(policySchema);
const validators = {
  input: ajv.compile(inputSchema),
  policy: ajv.compile(policySchema),
  result: ajv.compile(resultSchema),
};

export const assertArchitectureSchema = (value: unknown, kind: keyof typeof validators): void => {
  serializePassportValue(value);
  const validate = validators[kind];
  if (!validate(value))
    throw new TypeError(
      `${kind} schema rejected: ${(validate.errors ?? []).map((error) => `${error.instancePath}: ${error.message}`).join('; ')}`,
    );
};

export const assertUniqueIds = <T extends { readonly id: string }>(
  values: readonly T[],
  label: string,
): void => {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    throw new TypeError(`Duplicate ${label} identity.`);
};

export const validateGenerationBoundary = (
  input: ArchitectureGenerationInput,
  policy: ArchitectureGenerationPolicy,
): void => {
  assertArchitectureSchema(input, 'input');
  assertArchitectureSchema(policy, 'policy');
  const requirements = input.requirements;
  assertUniqueIds(requirements.loads, 'load');
  assertUniqueIds(requirements.charging_sources, 'charging source');
  assertUniqueIds(input.assumptions, 'assumption');
  assertUniqueIds(requirements.unsupported_requirements ?? [], 'unsupported requirement');
  if (
    requirements.loads.length > policy.bounds.max_loads ||
    requirements.charging_sources.length > policy.bounds.max_charging_sources
  )
    throw new TypeError(
      'Requirements exceed generation policy admission bounds; nothing was truncated.',
    );
  // Contradictory input declarations are retained and evaluated as blocked;
  // malformed/nonportable input is rejected before generation. Absence is legal.
};
