import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../../../data/schemas/engineering-profile.schema.json' with { type: 'json' };

export const ENGINEERING_PROFILE_VERSION = 'engineering-profile.v1';
export const ENGINEERING_ENVELOPE_RULE = 'engineering-envelope.v2';
export type EngineeringStatus = 'ELIGIBLE' | 'BLOCKED' | 'UNRESOLVED';
export interface EngineeringEvidence {
  id: string;
  source_url: string;
  publisher: string;
  model: string;
  manufacturer_revision: string | null;
  retrieved_at: string;
  locator: string;
  source_digest: string | null;
  statement: string;
  conditions: string[];
  origin: 'source_stated' | 'synthetic';
  rights: 'metadata_and_limited_facts_only' | 'project_authored';
  human_interpretation?: {
    version: 'engineering-profile-adjudication.v1';
    event_id: string;
    fact_id: string;
    source_document_revision: string | null;
    source_unit: string;
  };
}
/** Values stay in published units. Coefficient conversion belongs to a traced
 * calculation, never to a silent rewriting of the manufacturer observation. */
export interface EngineeringValue<U extends string = string> {
  value: number;
  unit: U;
  evidence_ids: string[];
}
export interface EngineeringCoefficient {
  value: number;
  unit: 'percent/K' | 'fraction/K' | 'V/K' | 'A/K' | 'W/K';
  cell_domain_c?: { min: number; max: number };
  evidence_ids: string[];
}
export type PvQuantity = 'voc' | 'vmp' | 'isc' | 'imp' | 'pmax';
export interface PvReference {
  voc_v?: EngineeringValue<'V'>;
  vmp_v?: EngineeringValue<'V'>;
  isc_a?: EngineeringValue<'A'>;
  imp_a?: EngineeringValue<'A'>;
  pmax_w?: EngineeringValue<'W'>;
  reference_cell_c?: EngineeringValue<'degC'>;
  irradiance_w_m2?: EngineeringValue<'W/m2'>;
  spectrum?: { value: string; evidence_ids: string[] };
  coefficients?: Partial<Record<PvQuantity, EngineeringCoefficient>>;
  uncertainty_fraction?: Partial<Record<PvQuantity, EngineeringValue<'fraction'>>>;
  max_system_v?: EngineeringValue<'V'>;
  max_series_fuse_a?: EngineeringValue<'A'>;
}
export interface PvTracker {
  id: string;
  terminal_ids?: string[];
  evidence_ids: string[];
  grouping_status: 'source_supported' | 'unresolved';
  input_sharing?: 'permitted' | 'prohibited';
  absolute_voc_v?: EngineeringValue<'V'>;
  operating_max_v?: EngineeringValue<'V'>;
  /** Proposed quantity, not proof. The consumer independently checks basis
   * provenance; current durable production adjudication has no basis member. */
  operating_max_basis?: 'voc_envelope' | 'vmp_envelope' | 'source_defined_unmodeled';
  operating_min_v?: EngineeringValue<'V'>;
  start_headroom_v?: EngineeringValue<'V'>;
  run_headroom_v?: EngineeringValue<'V'>;
  restart_headroom_v?: EngineeringValue<'V'>;
  max_isc_a?: EngineeringValue<'A'>;
  max_imp_a?: EngineeringValue<'A'>;
  terminal_limits?: {
    id: string;
    max_isc_a?: EngineeringValue<'A'>;
    max_imp_a?: EngineeringValue<'A'>;
  }[];
  power_limits?: {
    battery_nominal_v: EngineeringValue<'V'>;
    max_pmax_w: EngineeringValue<'W'>;
    clipping: 'permitted' | 'prohibited';
    evidence_ids: string[];
  }[];
}
export interface SharedCapacity {
  id: string;
  mode: string;
  path_ids: string[];
  unit: 'W' | 'VA' | 'A';
  limit: number;
  evidence_ids: string[];
  battery_count?: number;
  temperature_c?: { min: number; max: number };
  unresolved_conditions?: string[];
  excluded_path_pairs?: [string, string][];
  accounting: 'boundary_demand_includes_losses';
}
export interface AcMode {
  id: string;
  kind: 'inversion' | 'bypass';
  evidence_ids: string[];
  relationship?: 'single_phase' | 'split_phase' | 'same_phase_legs';
  line_neutral_v?: EngineeringValue<'V'>;
  line_line_v?: EngineeringValue<'V'>;
  source_required?: boolean;
  leg_limits_a?: { L1?: EngineeringValue<'A'>; L2?: EngineeringValue<'A'> };
  neutral_limit_a?: EngineeringValue<'A'>;
  neutral_evidence_ids?: string[];
  grounding_evidence_ids?: string[];
}
export interface AssemblyRequirement {
  component_id: string;
  model: string;
  compatible_revision: string | null;
  relationship: 'required' | 'included' | 'optional';
  min_count: number;
  max_count: number;
  modes?: string[];
  protocol?: string;
  evidence_ids: string[];
}
export interface EngineeringProfile {
  schema_version: typeof ENGINEERING_PROFILE_VERSION;
  component_id: string;
  model: string;
  manufacturer_revision: string | null;
  evidence: EngineeringEvidence[];
  pv?: PvReference;
  trackers?: PvTracker[];
  shared_capacity?: SharedCapacity[];
  shared_capacity_inventory?: { mode: string; group_ids: string[]; evidence_ids: string[] }[];
  ac_modes?: AcMode[];
  assembly?: AssemblyRequirement[];
}

const Ajv = Ajv2020 as unknown as new (options: object) => {
  compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown };
};
const ajv = new Ajv({ allErrors: true, strict: false, strictNumbers: true });
(addFormats as unknown as (value: unknown) => void)(ajv);
const validate = ajv.compile(schema);

export function engineeringProfileErrors(input: unknown): string[] {
  if (!validate(input)) return [JSON.stringify(validate.errors)];
  const p = input as EngineeringProfile;
  const errors: string[] = [];
  const evidence = new Map(p.evidence.map((e) => [e.id, e]));
  if (evidence.size !== p.evidence.length) errors.push('Duplicate evidence identity');
  for (const e of p.evidence) {
    if (e.model !== p.model || e.manufacturer_revision !== p.manufacturer_revision)
      errors.push(`Evidence ${e.id}: wrong exact model/revision ownership`);
    if (e.origin === 'synthetic' && e.rights !== 'project_authored')
      errors.push(`Evidence ${e.id}: synthetic rights mismatch`);
  }
  const visit = (v: unknown, path: string) => {
    if (!v || typeof v !== 'object') return;
    const r = v as Record<string, unknown>;
    for (const [k, child] of Object.entries(r)) {
      if (k.endsWith('evidence_ids') && Array.isArray(child)) {
        for (const id of child)
          if (!evidence.has(String(id))) errors.push(`${path}.${k}: missing evidence ${id}`);
      } else if (k !== 'evidence') visit(child, `${path}.${k}`);
    }
    if (typeof r.min === 'number' && typeof r.max === 'number' && r.min > r.max)
      errors.push(`${path}: reversed range`);
  };
  visit(p, 'profile');
  for (const list of [p.trackers, p.shared_capacity, p.ac_modes]) {
    if (list && new Set(list.map((x) => x.id)).size !== list.length)
      errors.push('Duplicate contract ID');
  }
  const terminals = p.trackers?.flatMap((t) => t.terminal_ids ?? []) ?? [];
  if (new Set(terminals).size !== terminals.length)
    errors.push('A terminal cannot belong to two trackers');
  for (const t of p.trackers ?? [])
    for (const l of t.terminal_limits ?? [])
      if (!t.terminal_ids?.includes(l.id)) errors.push(`Tracker ${t.id}: foreign terminal limit`);
  for (const t of p.trackers ?? [])
    if (t.grouping_status === 'source_supported' && !t.terminal_ids?.length)
      errors.push(`Tracker ${t.id}: source-supported grouping requires explicit terminals`);
  for (const mode of p.ac_modes ?? [])
    if (mode.kind === 'bypass' && mode.source_required === false)
      errors.push(`Mode ${mode.id}: bypass cannot assert source independence`);
  for (const g of p.shared_capacity ?? [])
    for (const pair of g.excluded_path_pairs ?? [])
      if (pair.some((id) => !g.path_ids.includes(id)))
        errors.push(`Capacity ${g.id}: foreign excluded path`);
  for (const a of p.assembly ?? [])
    if (a.min_count > a.max_count) errors.push('Reversed assembly count');
  if (
    new Set(p.shared_capacity_inventory?.map((i) => i.mode)).size !==
    (p.shared_capacity_inventory?.length ?? 0)
  )
    errors.push('Duplicate capacity inventory mode');
  for (const i of p.shared_capacity_inventory ?? []) {
    const actual = (p.shared_capacity ?? [])
      .filter((g) => g.mode === i.mode)
      .map((g) => g.id)
      .sort();
    if (
      new Set(i.group_ids).size !== i.group_ids.length ||
      JSON.stringify([...i.group_ids].sort()) !== JSON.stringify(actual)
    )
      errors.push('Capacity inventory must identify exactly all declared mode groups');
  }
  for (const u of Object.values(p.pv?.uncertainty_fraction ?? {}))
    if (u && u.value >= 1) errors.push('Fractional uncertainty must be below one');
  for (const q of [
    p.pv?.voc_v,
    p.pv?.vmp_v,
    p.pv?.isc_a,
    p.pv?.imp_a,
    p.pv?.pmax_w,
    p.pv?.irradiance_w_m2,
  ])
    if (q && q.value <= 0) errors.push('PV reference quantities must be positive');
  return errors;
}

/** No historical migration: callers explicitly author v1 over retained evidence.
 * Parsing returns an owned snapshot so a UI cannot mutate evaluation inputs. */
export function parseEngineeringProfile(input: unknown): EngineeringProfile {
  const errors = engineeringProfileErrors(input);
  if (errors.length) throw new Error(errors.join('; '));
  return JSON.parse(JSON.stringify(input)) as EngineeringProfile;
}
