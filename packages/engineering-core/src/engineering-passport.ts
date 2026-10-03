/** Node backend entry point. Kept out of the browser index and ingestion runtime. */
export * from './installed-power-topology.js';
export * from './engineering-passport-contracts.js';
export {
  evaluateInstalledSystem,
  installedSystemRuleData,
  WHOLE_SYSTEM_EVALUATOR_REVISION,
} from './whole-system-evaluator.js';
export { passportDigest, serializePassportValue } from './passport-integrity.js';

import type { ComponentLibraryRecord } from './component-library.js';
import type { EngineeringPassport, PassportRuleData } from './engineering-passport-contracts.js';
import {
  assertPassportSchema,
  passportDigest,
  serializePassportValue,
} from './passport-integrity.js';
import {
  evaluateInstalledSystem,
  installedSystemRuleData,
  WHOLE_SYSTEM_EVALUATOR_REVISION,
} from './whole-system-evaluator.js';

const assertReproducible = (value: unknown): EngineeringPassport => {
  assertPassportSchema(value, 'passport');
  const passport = value as EngineeringPassport;
  const { passport_digest: digest, ...body } = passport;
  if (passportDigest(body) !== digest) throw new TypeError('Passport integrity mismatch.');
  if (passport.evaluator_revision !== WHOLE_SYSTEM_EVALUATOR_REVISION)
    throw new TypeError('Unsupported evaluator revision.');
  if (passport.rule_data_digest !== passportDigest(installedSystemRuleData))
    throw new TypeError('Unsupported rule data snapshot.');
  const reproduced = evaluateInstalledSystem(
    passport.input,
    passport.component_bindings.map((binding) => binding.record),
  );
  // Loading cannot turn a forged result/trace into authority even if someone
  // recomputes the envelope hash. Reconstruct using the installed implementation.
  if (serializePassportValue(reproduced) !== serializePassportValue(passport))
    throw new TypeError('Passport does not reproduce from its embedded inputs and evidence.');
  return reproduced;
};

export const serializeEngineeringPassport = (passport: EngineeringPassport): string =>
  serializePassportValue(assertReproducible(passport));
export const parseEngineeringPassport = (serialized: string): EngineeringPassport =>
  assertReproducible(JSON.parse(serialized) as unknown);

export type PassportReplayResult =
  | { readonly ok: true; readonly passport: EngineeringPassport }
  | {
      readonly ok: false;
      readonly code:
        | 'invalid_passport'
        | 'evaluator_changed'
        | 'rule_data_changed'
        | 'component_missing'
        | 'component_changed'
        | 'duplicate_component';
      readonly message: string;
      readonly component_id?: string;
    };

export const replayEngineeringPassport = (
  passport: EngineeringPassport,
  catalog: readonly ComponentLibraryRecord[],
  currentRuleData: PassportRuleData = installedSystemRuleData,
): PassportReplayResult => {
  // External corpus comparison is authoritative for replay. Embedded snapshots
  // support offline inspection, not permission to ignore changed live records.
  if (passport.evaluator_revision !== WHOLE_SYSTEM_EVALUATOR_REVISION)
    return { ok: false, code: 'evaluator_changed', message: 'Evaluator revision changed.' };
  if (passport.rule_data_digest !== passportDigest(currentRuleData))
    return { ok: false, code: 'rule_data_changed', message: 'Rule data identity/content changed.' };
  const records = new Map<string, ComponentLibraryRecord>();
  for (const record of catalog) {
    if (records.has(record.id))
      return {
        ok: false,
        code: 'duplicate_component',
        component_id: record.id,
        message: 'Replay catalog contains duplicate component identity.',
      };
    records.set(record.id, record);
  }
  for (const binding of passport.component_bindings) {
    const record = records.get(binding.component_id);
    if (!record)
      return {
        ok: false,
        code: 'component_missing',
        component_id: binding.component_id,
        message: 'Referenced component is absent from replay catalog.',
      };
    if (passportDigest(record) !== binding.record_digest)
      return {
        ok: false,
        code: 'component_changed',
        component_id: binding.component_id,
        message: 'Canonical record content differs from evaluated snapshot.',
      };
  }
  try {
    return { ok: true, passport: assertReproducible(passport) };
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_passport',
      message: error instanceof Error ? error.message : 'Invalid passport.',
    };
  }
};
