import { createHash } from 'node:crypto';
import type {
  EngineeringProfile,
  EngineeringValue,
} from '@expedition/engineering-core/engineering-profile';
import { nativeModelGridObservations } from './native-model-grid.js';
import {
  prepareEngineeringProfile,
  type EngineeringSourceBinding,
  type RetainedEngineeringSource,
} from './engineering-preparation.js';

/** A source header establishes selected-column ownership, not tracker grouping
 * or SKU identity. This prepares two differently based input limits, leaving
 * physical membership, power conditions, restart and installation unresolved. */
export function prepareNativeTrackerReference(input: {
  source: RetainedEngineeringSource;
  exact_source_model: string;
  component_id: string;
  required_assertions: string[];
}) {
  const observations = nativeModelGridObservations(input.source.bytes, input.exact_source_model);
  const digest = createHash('sha256').update(input.source.bytes).digest('hex');
  const profile: EngineeringProfile = {
    schema_version: 'engineering-profile.v1',
    component_id: input.component_id,
    model: input.exact_source_model,
    manufacturer_revision: input.source.manufacturer_revision,
    evidence: [],
    trackers: [{ id: 'pv_input_unassigned', grouping_status: 'unresolved', evidence_ids: [] }],
  };
  const bindings: EngineeringSourceBinding[] = [];
  for (const obs of observations) {
    const q =
      obs.label === 'Maximum PV open circuit voltage'
        ? 'absolute_voc_v'
        : /^Max\. PV short circuit current(?:\s+\d+)?$/.test(obs.label)
          ? 'max_isc_a'
          : undefined;
    if (!q) continue;
    const match = /^(\d+(?:\.\d+)?)\s*(V|A)$/.exec(obs.value);
    const unit = q === 'absolute_voc_v' ? 'V' : 'A';
    if (!match || match[2] !== unit) continue;
    if (profile.trackers![0]![q]) throw new Error('Competing tracker limit');
    const id = `${input.component_id}.${q}`;
    profile.evidence.push({
      id,
      source_url: input.source.source_url,
      publisher: input.source.publisher,
      model: input.exact_source_model,
      manufacturer_revision: input.source.manufacturer_revision,
      retrieved_at: input.source.retrieved_at,
      source_digest: digest,
      statement: `${obs.label}: ${obs.value}`,
      locator: `utf8-bytes:${obs.start_byte}-${obs.end_byte}`,
      conditions: obs.source_conditions,
      origin: 'source_stated',
      rights: 'metadata_and_limited_facts_only',
    });
    const v: EngineeringValue = { value: Number(match[1]), unit, evidence_ids: [id] };
    (profile.trackers![0] as unknown as Record<string, unknown>)[q] = v;
    profile.trackers![0]!.evidence_ids.push(id);
    bindings.push({
      evidence_id: id,
      source_digest: digest,
      source_url: input.source.source_url,
      start_byte: obs.start_byte,
      end_byte: obs.end_byte,
      source_literal: obs.source_literal,
      ownership: 'native_exact_model',
      context_locators: [
        `table-bytes:${obs.table_start_byte}-${obs.table_end_byte}`,
        `model-bytes:${obs.model_start_byte}-${obs.model_end_byte}`,
      ],
    });
  }
  if (!profile.evidence.length) throw new Error('No closed tracker limit observations');
  return prepareEngineeringProfile({
    profile,
    bindings,
    sources: [input.source],
    required_assertions: input.required_assertions,
    unresolved: [
      'Exact retail SKU/revision and tracker/terminal grouping not established',
      'PV operating current differs from PV Isc and battery charge current; remaining input limits unknown',
      'Startup/restart, power/clipping conditions, sharing, connector and protection qualification required',
    ],
  });
}
