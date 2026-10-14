import { parseSourceGroundedDraft } from '@expedition/engineering-core/source-grounded-draft';
import type { ComponentLibraryRecord } from '@expedition/engineering-core';
import type {
  EngineeringProfile,
  EngineeringValue,
} from '@expedition/engineering-core/engineering-profile';

/** A reviewable export only. Never calls candidate approval/canonical writers.
 * Logical keys map explicit manufacturer labels and source facts; physical wire
 * edges, current/power capacities and protection are never generated. Even when
 * a bounded witness exists its source/product authority remains UNRESOLVED. */
export function projectAuthoredComponent(raw: unknown): ComponentLibraryRecord {
  const d = parseSourceGroundedDraft(raw);
  // The profile owns bare SHA-256 hex; capture/authoring references own a tagged
  // sha256: digest. Remove only the already-validated protocol tag, never rehash
  // or reinterpret the publisher bytes to make these independent codecs agree.
  const evidence = d.facts.map((f) => {
    const s = d.sources.find((s) => s.id === f.source_id)!;
    return {
      id: f.id,
      source_url: s.url,
      publisher: s.publisher,
      model: d.product.model,
      manufacturer_revision: d.product.hardware_revision,
      retrieved_at: s.retrieved_at,
      locator: f.locator,
      source_digest: s.content_digest.slice('sha256:'.length),
      statement: `Authored source value reconstruction: ${f.quantity} ${f.original.value} ${f.original.unit}`,
      conditions: [
        ...f.conditions.map((c) => `${c.key}: ${JSON.stringify(c.value)} ${c.unit}`),
        ...f.unresolved_conditions,
      ],
      origin: 'source_stated' as const,
      rights: 'metadata_and_limited_facts_only' as const,
    };
  });
  const converter = d.power_paths?.length && d.ports?.every((p) => p.domain === 'dc');
  // Canonical logical identifiers are lowercase; manufacturer labels stay in
  // source_specification and port notes. Map both endpoints together so this
  // presentation normalization cannot change the owned directional relationship.
  const portKey = (id: string) => id.toLowerCase();
  if (d.ports && new Set(d.ports.map((p) => portKey(p.id))).size !== d.ports.length)
    throw Error('Port normalization collision');
  const one = (quantity: string, unit: string) => {
    const matches = d.facts.filter((f) => f.quantity === quantity && f.normalized.unit === unit);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const scalar = <U extends string>(quantity: string, unit: U): EngineeringValue<U> | undefined => {
    const f = one(quantity, unit);
    return f && typeof f.normalized.value === 'number'
      ? { value: f.normalized.value, unit, evidence_ids: [f.id] }
      : undefined;
  };
  const profile: EngineeringProfile = {
    schema_version: 'engineering-profile.v1',
    component_id: d.product.id,
    model: d.product.model,
    manufacturer_revision: d.product.hardware_revision,
    evidence,
    source_specification: d,
  };
  // These are ordinary typed *proposals*, with original source units/qualifiers
  // retained in source_specification. No human_interpretation is synthesized;
  // historical adjudication consumers retain their existing authority checks.
  const voc = scalar('pv_voc', 'V');
  if (voc) {
    const spectrum = one('reference_spectrum', 'text');
    profile.pv = {
      voc_v: voc,
      vmp_v: scalar('pv_vmp', 'V'),
      isc_a: scalar('pv_isc', 'A'),
      imp_a: scalar('pv_imp', 'A'),
      pmax_w: scalar('pv_pmax', 'W'),
      reference_cell_c: scalar('reference_module_temperature', 'degC'),
      irradiance_w_m2: scalar('reference_irradiance', 'W/m2'),
      ...(spectrum && typeof spectrum.normalized.value === 'string'
        ? { spectrum: { value: spectrum.normalized.value, evidence_ids: [spectrum.id] } }
        : {}),
      max_system_v: scalar('max_system_voltage', 'V'),
    };
    const coefficients: NonNullable<NonNullable<EngineeringProfile['pv']>['coefficients']> = {};
    for (const [quantity, key] of [
      ['beta_voc', 'voc'],
      ['alpha_isc', 'isc'],
      ['gamma_pmax', 'pmax'],
    ] as const) {
      const f = one(quantity, '%/K');
      if (f && typeof f.normalized.value === 'number')
        coefficients[key] = { value: f.normalized.value, unit: 'percent/K', evidence_ids: [f.id] };
    }
    // %/K and percent/K are the same named unit; no magnitude conversion or
    // coefficient validity domain is inferred from the plotted I-V curves.
    profile.pv.coefficients = coefficients;
  }
  const charge = one('battery_cell_charge_range', 'degC');
  if (charge && typeof charge.normalized.value === 'object' && 'min' in charge.normalized.value) {
    const point = charge.conditions.find((c) => c.key === 'measurement_point')?.value;
    const heater = charge.conditions.find((c) => c.key === 'heater_state')?.value;
    profile.battery_operating = {
      version: 'battery-operating.v1',
      charge_range: {
        min_c: charge.normalized.value.min,
        max_c: charge.normalized.value.max,
        unit: 'degC',
        measurement_point:
          point === 'battery_cell' ? 'battery_cell' : point === 'ambient' ? 'ambient' : 'unknown',
        prerequisite: heater === 'after_heating' ? 'after_heating' : 'unknown',
        evidence_ids: [charge.id],
      },
    };
    for (const [quantity, key] of [
      ['series_count_max', 'series_permission'],
      ['parallel_count_max', 'parallel_permission'],
    ] as const) {
      const f = one(quantity, 'count');
      if (f && typeof f.normalized.value === 'number')
        profile.battery_operating![key] = {
          max_count: f.normalized.value,
          requires_matched_bank:
            f.conditions.find((c) => c.key === 'matched_bank')?.value === true ? true : null,
          evidence_ids: [f.id],
          ...(f.unresolved_conditions.length
            ? { unmodeled_conditions: f.unresolved_conditions }
            : {}),
        };
    }
  }
  const shunt = scalar('reference_shunt_current', 'A');
  const drop = scalar('reference_shunt_drop', 'mV');
  if (shunt && drop) {
    profile.instrumentation = {
      version: 'instrumentation.v1',
      shunt: {
        nominal_current_a: shunt.value,
        nominal_drop_mv: drop.value,
        electrical_domain: 'unknown',
        evidence_ids: [...shunt.evidence_ids, ...drop.evidence_ids],
      },
      accuracy: [],
    };
    for (const [quantity, key] of [
      ['current_accuracy_percent', 'current'],
      ['voltage_accuracy_percent', 'voltage'],
    ] as const) {
      const f = one(quantity, '%');
      if (f && typeof f.normalized.value === 'number') {
        const amps = f.conditions.find((c) => c.key === 'shunt_nominal_a' && c.unit === 'A')?.value;
        const mv = f.conditions.find((c) => c.key === 'shunt_nominal_mv' && c.unit === 'mV')?.value;
        profile.instrumentation.accuracy!.push({
          quantity: key,
          electrical_domain: 'unknown',
          percent: f.normalized.value,
          basis: 'unknown',
          ...(typeof amps === 'number' ? { required_shunt_a: amps } : {}),
          ...(typeof mv === 'number' ? { required_shunt_drop_mv: mv } : {}),
          evidence_ids: [f.id],
        });
      }
    }
  }
  const phase = one('ac_phase', 'text');
  const acNominal = scalar('output_voltage_nominal', 'V');
  if (phase?.normalized.value === 'single_phase' && acNominal)
    profile.ac_modes = [
      {
        id: 'source.inverting',
        kind: 'inversion',
        relationship: 'single_phase',
        line_neutral_v: acNominal,
        evidence_ids: [phase.id, ...acNominal.evidence_ids],
      },
    ];
  const body = d.facts.find(
    (f) =>
      f.quantity === 'body_size' &&
      f.basis === 'body' &&
      !f.unresolved_conditions.length &&
      f.normalized.unit === 'mm' &&
      typeof f.normalized.value === 'object' &&
      'x' in f.normalized.value,
  )?.normalized.value;
  return {
    id: d.product.id,
    manufacturer: d.product.manufacturer,
    model: d.product.model,
    part_number: d.product.manufacturer_part_number,
    manufacturer_revision: d.product.hardware_revision,
    category: 'source_grounded_draft',
    verification_status: 'unverified',
    source_type: 'manufacturer',
    source_refs: d.sources.map((s) => ({
      id: s.id,
      url: s.url,
      date_checked: s.retrieved_at,
      document_revision: s.document_revision,
      source_digest: s.content_digest,
      rights: s.rights,
      authoring_authority: d.authority,
    })),
    ...(body && typeof body === 'object' && 'x' in body ? { dimensions_mm: body } : {}),
    ...(converter
      ? {
          product_role: 'dc_dc_converter' as const,
          capabilities: d.power_paths!.map((p) => ({
            id: p.id,
            type: 'dc_to_dc_conversion' as const,
            port_ids: [portKey(p.from_port), portKey(p.to_port)],
          })),
          ports: d.ports!.map((p) => ({
            id: portKey(p.id),
            domain: p.domain,
            direction: p.direction,
            voltage_v: p.voltage_v,
            notes: `Unreviewed logical grouping for source label ${p.label}; see ${p.source_fact_ids.join(', ')}`,
          })),
          power_paths: d.power_paths!.map((p) => ({
            id: p.id,
            capability_id: p.id,
            from_port: portKey(p.from_port),
            to_port: portKey(p.to_port),
          })),
        }
      : {}),
    engineering_profile: JSON.parse(JSON.stringify(profile)) as EngineeringProfile,
  };
}
