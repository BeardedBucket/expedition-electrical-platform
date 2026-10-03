import type { ComponentLibraryRecord, ComponentLogicalPort } from './component-library.js';
import { validateComponentLibraryRecord } from './component-library.js';
import { validateReferenceSystem } from './reference-system.js';
import ruleData from '../../../data/rules/installed-system-proof.json' with { type: 'json' };
import {
  assertPassportSchema,
  passportDigest,
  serializePassportValue,
} from './passport-integrity.js';
import type {
  ExaminedProductEvidence,
  EngineeringPassport,
  PassportCalculation,
  PassportDecision,
  PassportRuleData,
  PassportStatus,
  WholeSystemEvaluationInput,
} from './engineering-passport-contracts.js';
import type {
  InstalledElectricalDomain,
  InstalledPowerBinding,
} from './installed-power-topology.js';

// Version owns interpretation and composition, not manufacturer revision. Bump
// alongside rule data whenever behavior changes; replay requires exact equality.
export const WHOLE_SYSTEM_EVALUATOR_REVISION = 'installed-system-proof/1.1.0';
const freezeRuleData = (value: unknown): void => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeRuleData);
    Object.freeze(value);
  }
};
freezeRuleData(ruleData);
export const installedSystemRuleData: PassportRuleData = ruleData;

export const statusOf = (states: readonly PassportStatus[]): PassportStatus =>
  states.includes('blocked')
    ? 'blocked'
    : states.includes('unresolved')
      ? 'unresolved'
      : 'satisfied';
export const severityOf = (status: PassportStatus) =>
  status === 'blocked'
    ? ('FAIL' as const)
    : status === 'unresolved'
      ? ('CONDITIONAL' as const)
      : ('PASS' as const);
// Canonical ports express current type, not installed source context. Only port
// matching/current arithmetic may erase the PV label; continuity must retain it.
export const dcKind = (domain: InstalledElectricalDomain) =>
  domain.kind === 'pv_dc' ? 'dc' : domain.kind;
export const includesValue = (rating: unknown, value: number): boolean | undefined => {
  if (typeof rating === 'number') return rating === value;
  if (
    rating &&
    typeof rating === 'object' &&
    'min' in rating &&
    'max' in rating &&
    typeof rating.min === 'number' &&
    typeof rating.max === 'number'
  )
    return value >= rating.min && value <= rating.max;
  return undefined;
};
export const maximum = (rating: unknown): number | undefined => {
  if (typeof rating === 'number') return rating;
  if (rating && typeof rating === 'object' && 'max' in rating && typeof rating.max === 'number')
    return rating.max;
  return undefined;
};
export const unique = <T extends { readonly id: string }>(
  values: readonly T[],
  label: string,
): Map<string, T> => {
  const entries = new Map<string, T>();
  for (const value of values) {
    if (entries.has(value.id)) throw new TypeError(`Duplicate ${label} ID '${value.id}'.`);
    entries.set(value.id, value);
  }
  return entries;
};

/** Per-evaluation ownership of validated snapshots, evidence and trace. No shared mutable evaluation state. */
export const createInstalledSystemContext = (
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
) => {
  assertPassportSchema(input, 'input');
  // Snapshot ownership: outputs retain independent JSON copies so later caller
  // mutation cannot rewrite evidence or alter an already evaluated passport.
  const request = JSON.parse(serializePassportValue(input)) as WholeSystemEvaluationInput;
  const topology = request.architecture.power_topology;
  const installation = request.architecture.installation;
  const instances = unique(installation.component_instances ?? [], 'instance');
  const catalogById = unique(catalog, 'catalog component');
  const components = new Map<string, ComponentLibraryRecord>();
  for (const instance of instances.values()) {
    const record = catalogById.get(instance.component_id);
    if (!record) throw new TypeError(`Missing referenced component '${instance.component_id}'.`);
    serializePassportValue(record);
    const validation = validateComponentLibraryRecord(record);
    if (!validation.ok)
      throw new TypeError(`Invalid component '${record.id}': ${validation.errors.join('; ')}`);
    components.set(record.id, JSON.parse(serializePassportValue(record)) as ComponentLibraryRecord);
  }
  const validation = validateReferenceSystem(installation, {
    components: [...components.values()],
  });
  if (validation.status === 'invalid')
    throw new TypeError(`Invalid installation: ${validation.errors.join('; ')}`);
  const domains = unique(topology.domains, 'domain');
  const bindings = unique(topology.bindings, 'binding');
  const edges = unique(topology.edges, 'edge');
  const assumptions = unique(request.assumptions, 'assumption');
  unique(request.requirements.supplies, 'supply');
  unique(request.requirements.load_states, 'load state');
  unique(request.requirements.battery_banks, 'battery bank');
  const banksByInstance = new Map<
    string,
    WholeSystemEvaluationInput['requirements']['battery_banks'][number]
  >();
  for (const bank of request.requirements.battery_banks) {
    if (banksByInstance.has(bank.instance_id))
      throw new TypeError('One instance cannot represent multiple battery-bank configurations.');
    banksByInstance.set(bank.instance_id, bank);
  }
  unique(topology.bonding_contexts ?? [], 'bonding context');
  for (const binding of bindings.values()) {
    if (domains.has(binding.id))
      throw new TypeError(`Domain and binding endpoint IDs collide: '${binding.id}'.`);
    if (!instances.has(binding.instance_id) || !domains.has(binding.domain_id))
      throw new TypeError(`Binding '${binding.id}' references a missing instance or domain.`);
  }
  const boundPorts = new Set<string>();
  for (const binding of bindings.values()) {
    const key = serializePassportValue([binding.instance_id, binding.port_id]);
    if (boundPorts.has(key))
      throw new TypeError('A logical port cannot be assigned to multiple installed domains.');
    boundPorts.add(key);
  }
  const endpointDomain = (id: string): InstalledElectricalDomain => {
    const domain = domains.get(id) ?? domains.get(bindings.get(id)?.domain_id ?? '');
    if (!domain) throw new TypeError(`Missing endpoint '${id}'.`);
    return domain;
  };
  const componentFor = (instanceId: string): ComponentLibraryRecord => {
    const component = components.get(instances.get(instanceId)?.component_id ?? '');
    if (!component) throw new TypeError(`Missing component instance '${instanceId}'.`);
    return component;
  };
  const decisions: PassportDecision[] = [];
  const calculations: PassportCalculation[] = [];
  const facts = new Map<string, ExaminedProductEvidence>();
  const digests = new Map([...components].map(([id, record]) => [id, passportDigest(record)]));
  const warnings: EngineeringPassport['result']['warnings'][number][] = [];
  // Distinct trace IDs protect consumers that index observations by identity;
  // future additions must fail explicitly rather than overwrite stronger/weaker states.
  const decisionIds = new Set<string>();
  const calculationIds = new Set<string>();
  const evidenceReferences = (ids: readonly string[]) =>
    [...new Set(ids)].map((id) => {
      const evidence = facts.get(id);
      if (!evidence) throw new TypeError(`Missing trace evidence '${id}'.`);
      return { evidence_id: id, engineering_use: evidence.engineering_use.state };
    });
  const decide = (
    id: string,
    status: PassportStatus,
    code: string,
    message: string,
    inputs: unknown,
    factIds: readonly string[] = [],
    assumptionIds: readonly string[] = [],
    output?: unknown,
  ): PassportStatus => {
    if (decisionIds.has(id)) throw new TypeError(`Duplicate decision trace ID '${id}'.`);
    decisionIds.add(id);
    decisions.push({
      id,
      rule_id: ruleData.id,
      rule_revision: ruleData.version,
      status,
      code,
      message,
      inputs,
      evidence_refs: evidenceReferences(factIds),
      assumption_ids: assumptionIds,
      ...(output === undefined ? {} : { output }),
    });
    return status;
  };
  const derive = (
    id: string,
    formula: string,
    inputs: unknown,
    output: unknown,
    unit: string,
    factIds: readonly string[] = [],
    assumptionIds: readonly string[] = [],
  ) => {
    if (calculationIds.has(id)) throw new TypeError(`Duplicate calculation trace ID '${id}'.`);
    calculationIds.add(id);
    calculations.push({
      id,
      kind: 'derived',
      rule_id: ruleData.id,
      rule_revision: ruleData.version,
      formula,
      inputs,
      output,
      unit,
      evidence_refs: evidenceReferences(factIds),
      assumption_ids: assumptionIds,
    });
  };
  /** Record examined evidence separately from whether its value enters engineering interpretation. */
  const consume = <T>(
    component: ComponentLibraryRecord,
    path: string,
    value: T | undefined | null,
    factIds: string[],
    unit?: string,
  ): T | undefined => {
    if (value === undefined || value === null) return undefined;
    const id = `evidence:${component.id}:${path}`;
    const derivedFields = component.derived_fields as Record<string, unknown> | undefined;
    const productDerivation = derivedFields?.[path];
    facts.set(id, {
      id,
      component_id: component.id,
      record_digest: digests.get(component.id)!,
      path,
      canonical_value: value,
      origin: productDerivation === undefined ? 'canonical_assertion' : 'product_derivation',
      verification_status: component.verification_status,
      engineering_use:
        component.verification_status === 'verified'
          ? { state: 'accepted_input' }
          : { state: 'withheld', reason: 'record_not_verified' },
      source_refs: component.source_refs ?? [],
      source_native: { state: 'not_retained_in_canonical_record' },
      normalization: {
        kind: 'canonical_projection',
        value,
        ...(unit === undefined ? {} : { unit }),
      },
      ...(productDerivation === undefined ? {} : { product_derivation: productDerivation }),
    });
    factIds.push(id);
    return component.verification_status === 'verified' ? value : undefined;
  };
  const getPort = (binding: InstalledPowerBinding): ComponentLogicalPort | undefined =>
    componentFor(binding.instance_id).ports?.find((port) => port.id === binding.port_id);

  return {
    request,
    topology,
    installation,
    instances,
    components,
    domains,
    bindings,
    edges,
    assumptions,
    decisions,
    calculations,
    facts,
    digests,
    warnings,
    decide,
    derive,
    consume,
    getPort,
    banksByInstance,
    validation,
    componentFor,
    endpointDomain,
  };
};

export type InstalledSystemContext = ReturnType<typeof createInstalledSystemContext>;
