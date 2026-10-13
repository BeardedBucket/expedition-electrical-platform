import { passportDigest, serializePassportValue } from './portable-json.js';
import {
  evaluateEngineeringEnvelope,
  type EngineeringEnvelopeInput,
  type EngineeringEnvelopeResult,
} from './engineering-envelope.js';
import { evaluateEngineeringEnvelope as evaluateV1 } from './engineering-envelope-v1.js';
import type {
  EngineeringEnvelopeInput as LegacyInput,
  EngineeringEnvelopeResult as LegacyResult,
} from './engineering-envelope-v1.js';

export interface PortableEngineeringEnvelopeV2 {
  schema_version: 'portable-engineering-envelope.v2';
  input: EngineeringEnvelopeInput;
  result: EngineeringEnvelopeResult;
  digest: string;
}
export type PortableEngineeringEnvelope =
  | PortableEngineeringEnvelopeV2
  | {
      schema_version: 'portable-engineering-envelope.v1';
      input: LegacyInput;
      result: LegacyResult;
      digest: string;
    };
/** Caller input and result are owned snapshots; exact versions, evidence and
 * assumptions all participate. A digest proves content identity, not approval. */
export function buildPortableEngineeringEnvelope(
  raw: EngineeringEnvelopeInput,
): PortableEngineeringEnvelopeV2 {
  const result = evaluateEngineeringEnvelope(raw);
  const input = JSON.parse(JSON.stringify(raw)) as EngineeringEnvelopeInput;
  const content = { schema_version: 'portable-engineering-envelope.v2' as const, input, result };
  return { ...content, digest: passportDigest(content) };
}

export function replayEngineeringEnvelope(input: unknown): PortableEngineeringEnvelope {
  if (!input || typeof input !== 'object') throw new Error('Invalid portable envelope');
  const p = input as PortableEngineeringEnvelope;
  if (p.schema_version === 'portable-engineering-envelope.v1') {
    const content = {
      schema_version: 'portable-engineering-envelope.v1',
      input: p.input,
      result: evaluateV1(p.input),
    };
    const reproduced = { ...content, digest: passportDigest(content) };
    if (serializePassportValue(reproduced) !== serializePassportValue(input))
      throw new Error('Legacy envelope replay mismatch');
    return reproduced as Extract<
      PortableEngineeringEnvelope,
      { schema_version: 'portable-engineering-envelope.v1' }
    >;
  }
  if (p.schema_version !== 'portable-engineering-envelope.v2')
    throw new Error('Unsupported replay version');
  const reconstructed = buildPortableEngineeringEnvelope(p.input);
  // Recompute semantics, not just the envelope hash: rehashing forged decisions
  // cannot turn an unresolved result into eligibility. No v1-to-future upgrade.
  if (serializePassportValue(reconstructed) !== serializePassportValue(p))
    throw new Error('Engineering envelope differs from exact supported-version replay');
  return reconstructed;
}
