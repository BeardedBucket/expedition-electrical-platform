import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../../data/schemas/source-grounded-draft.schema.json' with { type: 'json' };

export type DraftValue =
  number | string | boolean | { min: number; max: number } | { x: number; y: number; z: number };
export interface SourceGroundedDraft {
  version: 'source-grounded-draft.v1';
  authority: 'codex_prepared_unreviewed';
  product: {
    id: string;
    manufacturer: string;
    model: string;
    manufacturer_part_number: string | null;
    hardware_revision: string | null;
  };
  intended_use: string;
  sources: {
    id: string;
    url: string;
    publisher: string;
    retrieved_at: string;
    content_digest: string;
    document_revision: string | null;
    model: string;
    identity_locator: string;
    rights: 'metadata_and_limited_facts_only';
    redistribution_grant: 'not_established';
  }[];
  facts: SourceGroundedFact[];
  holds: string[];
  ports?: {
    id: string;
    label: string;
    domain: 'dc' | 'ac';
    direction: 'input' | 'output' | 'bidirectional';
    voltage_v: number | { min: number; max: number };
    source_fact_ids: string[];
  }[];
  power_paths?: { id: string; from_port: string; to_port: string; source_fact_ids: string[] }[];
}
export interface SourceGroundedFact {
  id: string;
  quantity: string;
  basis:
    | 'nominal'
    | 'absolute'
    | 'operating'
    | 'continuous'
    | 'peak'
    | 'typical'
    | 'recommended'
    | 'measurement'
    | 'body'
    | 'installation'
    | 'descriptive'
    | 'protection';
  mode: string;
  direction: 'input' | 'output' | 'bidirectional' | 'none' | 'unknown';
  electrical_domain: 'dc' | 'ac' | 'none' | 'unknown';
  original: {
    value: string;
    unit: string;
    presentation: 'source_literal' | 'source_value_reconstruction' | 'authored_summary';
  };
  normalized: { value: DraftValue; unit: string };
  normalization:
    | 'identity'
    | 'symmetric_range'
    | 'cm_to_mm'
    | 'kvdc_to_vdc'
    | 'in_to_mm'
    | 'lb_to_kg'
    | 'kwh_to_wh'
    | 'ma_to_a'
    | 'percent_to_fraction'
    | 'minutes_to_seconds';
  source_id: string;
  locator: string;
  context_digest: string;
  conditions: { key: string; value: DraftValue; unit: string }[];
  unresolved_conditions: string[];
  disposition: 'typed_consumer' | 'retained_source_fact' | 'evidence_ambiguity';
}
const Ajv = Ajv2020 as unknown as new (options: object) => {
  compile(schema: unknown): (value: unknown) => boolean;
};
const valid = new Ajv({ strict: false, strictNumbers: true }).compile(schema);

/** Structural/evidence identity validation does not establish semantic truth.
 * No migration, source inference, status upgrade or unspecified unit conversion.
 * Original literals/units survive; normalization is a declared reproducible step. */
export function parseSourceGroundedDraft(raw: unknown): SourceGroundedDraft {
  if (!valid(raw)) throw Error('Invalid source-grounded draft schema');
  const d = raw as SourceGroundedDraft;
  if (
    new Set(d.sources.map((s) => s.id)).size !== d.sources.length ||
    new Set(d.facts.map((f) => f.id)).size !== d.facts.length
  )
    throw Error('Duplicate draft source/fact');
  for (const s of d.sources) {
    if (
      s.model !== d.product.model ||
      s.publisher !== d.product.manufacturer ||
      !Number.isFinite(Date.parse(s.retrieved_at)) ||
      new URL(s.url).protocol !== 'https:'
    )
      throw Error('Foreign source identity or invalid locator');
  }
  for (const f of d.facts) {
    if (!d.sources.some((s) => s.id === f.source_id && s.content_digest === f.context_digest))
      throw Error('Missing source ownership or whole-context digest mismatch');
    const n = f.normalized.value;
    if (typeof n === 'object' && 'min' in n && n.min > n.max) throw Error('Reversed draft range');
    if (new Set(f.conditions.map((c) => c.key)).size !== f.conditions.length)
      throw Error('Competing source conditions');
    if (
      f.conditions.some(
        (c) => typeof c.value === 'object' && 'min' in c.value && c.value.min > c.value.max,
      )
    )
      throw Error('Reversed source condition range');
    if (f.normalization === 'symmetric_range') {
      const parts = /^(-?\d+(?:\.\d+)?)\s*±\s*(\d+(?:\.\d+)?)$/.exec(f.original.value);
      if (
        !parts ||
        typeof n !== 'object' ||
        !('min' in n) ||
        n.min !== Number(parts[1]) - Number(parts[2]) ||
        n.max !== Number(parts[1]) + Number(parts[2]) ||
        f.original.unit !== f.normalized.unit
      )
        throw Error('Unreproducible symmetric source range');
    } else if (f.normalization !== 'identity') {
      // Defined unit conversions, not empirical margins. KVdc retains this
      // publisher spelling; kilo is 1000 and a DC test is not a working rating.
      const conversions = {
        cm_to_mm: ['cm', 'mm', 10],
        kvdc_to_vdc: ['KVdc', 'Vdc', 1000],
        in_to_mm: ['in', 'mm', 25.4],
        lb_to_kg: ['lb', 'kg', 0.45359237],
        kwh_to_wh: ['kWh', 'Wh', 1000],
        ma_to_a: ['mA', 'A', 0.001],
        percent_to_fraction: ['%', 'fraction', 0.01],
        minutes_to_seconds: ['min', 's', 60],
      } as const;
      const [from, to, factor] = conversions[f.normalization];
      const original = Number(f.original.value);
      if (
        f.original.unit !== from ||
        f.normalized.unit !== to ||
        !Number.isFinite(original) ||
        n !== original * factor
      )
        throw Error('Unreproducible normalization');
    } else if (
      f.normalization === 'identity' &&
      (f.original.unit !== f.normalized.unit ||
        (f.original.presentation === 'source_literal' &&
          (typeof n === 'number'
            ? Number(f.original.value) !== n
            : typeof n === 'string'
              ? f.original.value !== n
              : true)))
    )
      throw Error('Undeclared unit/value conversion');
    // Identity cannot reclassify literal electrical text (e.g. AC phase), nor
    // implicitly parse a boolean/object. Explicit range/conversion codecs and
    // labeled authored summaries retain their separate, reviewable meanings.
    if (
      f.normalization === 'identity' &&
      f.original.presentation === 'source_value_reconstruction'
    ) {
      const reconstructed: unknown = JSON.parse(f.original.value);
      if (typeof n === 'object') {
        if (
          !reconstructed ||
          typeof reconstructed !== 'object' ||
          Array.isArray(reconstructed) ||
          Object.keys(reconstructed).sort().join(',') !== Object.keys(n).sort().join(',') ||
          Object.entries(n).some(([k, v]) => (reconstructed as Record<string, unknown>)[k] !== v)
        )
          throw Error('Unreproducible reconstructed source value');
      } else if (reconstructed !== n) throw Error('Unreproducible reconstructed source value');
    }
  }
  const ports = d.ports ?? [];
  if (
    new Set(ports.map((p) => p.id)).size !== ports.length ||
    new Set(d.power_paths?.map((p) => p.id)).size !== (d.power_paths?.length ?? 0)
  )
    throw Error('Ambiguous authored interfaces');
  for (const port of ports) {
    if (
      !port.source_fact_ids.length ||
      port.source_fact_ids.some((id) => !d.facts.some((f) => f.id === id))
    )
      throw Error('Missing source port evidence');
    if (
      !port.source_fact_ids.some((id) =>
        d.facts.some(
          (f) =>
            f.id === id &&
            f.direction === port.direction &&
            f.electrical_domain === port.domain &&
            f.normalized.unit === 'V' &&
            JSON.stringify(f.normalized.value) === JSON.stringify(port.voltage_v) &&
            !f.unresolved_conditions.length &&
            !f.conditions.length,
        ),
      )
    )
      throw Error('Unproven source port voltage/direction');
  }
  for (const path of d.power_paths ?? []) {
    if (
      path.from_port === path.to_port ||
      !ports.some((p) => p.id === path.from_port && p.direction === 'input') ||
      !ports.some((p) => p.id === path.to_port && p.direction === 'output') ||
      !path.source_fact_ids.length ||
      path.source_fact_ids.some(
        (id) =>
          !d.facts.some(
            (f) =>
              f.id === id &&
              f.quantity === 'internal_power_direction' &&
              !f.unresolved_conditions.length,
          ),
      )
    )
      throw Error('Unproven source power path');
  }
  return JSON.parse(JSON.stringify(d)) as SourceGroundedDraft;
}
