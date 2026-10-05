import {
  generateArchitectures,
  type ArchitectureGenerationInput,
} from '../../src/architecture-generation.js';
import { evaluateProductSelection } from '../../src/product-selection.js';
import type { RecommendationInput, SelectionOptionSource } from '../../src/recommendation.js';
import { batteryProduct } from './selection.js';
import type { ComponentLibraryRecord } from '../../src/component-library.js';

/** Synthetic project-authored fixtures; no production facts, price or review repairs. */
export const tradeoffProduct = (id = 'fixture.a'): ComponentLibraryRecord => ({
  ...batteryProduct(),
  id,
  electrical: { nominal_voltage_v: 24, power_consumption_w: 2 },
  battery: { ...batteryProduct().battery!, nominal_energy_wh: 2400 },
  ports: batteryProduct().ports!.map((p) => ({ ...p, voltage_v: 24, current_a: 100 })),
  weight_kg: 2,
  dimensions_mm: { x: 10, y: 20, z: 30 },
});
export const recommendationSource = (
  corpus: readonly ComponentLibraryRecord[] = [tradeoffProduct()],
  fixed = false,
  shared = false,
): SelectionOptionSource => {
  const input: ArchitectureGenerationInput = {
    schema_version: '2.0.0',
    assumptions: [],
    requirements: {
      id: 'fixture.recommendation',
      fixed_house_voltage_v: 24,
      // Late Phase 3 timing is separate from Phase 4 schedule interpretation.
      // Supplied upstream schedules still preserve the unmodeled condition.
      loads: [
        {
          id: 'load',
          domain: { kind: 'dc', nominal_voltage_v: 24 },
          required_power_w: 100,
          ...(shared ? { schedule: [{ state: 'active' as const, duration_hours: 1 }] } : {}),
        },
      ],
      charging_sources: [],
      storage: { required: true, minimum_nominal_energy_wh: 1200 },
    },
  };
  const generation = generateArchitectures(input);
  const candidate = generation.candidates[0]!;
  const selection = evaluateProductSelection({
    schema_version: '1.0.0',
    generation,
    candidate_id: candidate.id,
    corpus,
    fixed_existing: fixed
      ? [{ role_id: candidate.required_roles[0]!.id, component_id: corpus[0]!.id }]
      : [],
    assemblies: [],
  });
  return {
    selection,
    handoff: {
      evaluation_hours: 1,
      project_demand_schedules: candidate.demand_endpoints.map((d) => ({
        demand_id: d.id,
        schedule: [{ state: 'active', duration_hours: 1 }],
      })),
      device_states: candidate.required_roles.map((r, i) => ({
        id: `device.${i}`,
        binding_id: candidate.topology.bindings.find(
          (b) => b.role_id === r.id && b.domain_id === 'house',
        )!.id,
        state: 'active' as const,
        duration_hours: 1,
        power: { kind: 'component' as const },
      })),
    },
  };
};
export const recommendationRequest = (
  sources: readonly SelectionOptionSource[] = [recommendationSource()],
): RecommendationInput => ({
  schema_version: '1.0.0',
  sources,
  construction: { mode: 'automatic' },
  preference: { schema_version: '1.0.0', id: 'fixture.preference', tiers: [] },
  context: { prices: [], owned_acquisition: [], features: [] },
});
export const observationSource = {
  owner: 'commercial' as const,
  reference: 'fixture.quote',
  context: 'Project-authored per-unit acquisition quote',
};
