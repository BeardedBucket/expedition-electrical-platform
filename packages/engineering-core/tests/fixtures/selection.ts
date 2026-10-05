import {
  generateArchitectures,
  type ArchitectureGenerationInput,
} from '../../src/architecture-generation.js';
import type { ComponentLibraryRecord } from '../../src/component-library.js';
import type { ProductSelectionInput } from '../../src/product-selection.js';

/** Project-authored semantic fixtures, never production facts or runtime witness products. */
export const converterProduct = (): ComponentLibraryRecord => ({
  id: 'fixture.converter',
  manufacturer: 'Fixture maker',
  model: 'C',
  category: 'test',
  verification_status: 'verified',
  source_refs: [{ id: 'fixture.source', title: 'Project-authored test facts' }],
  capabilities: [{ id: 'convert', type: 'dc_to_dc_conversion' }],
  ports: [
    { id: 'in', domain: 'dc', direction: 'input', voltage_v: 24 },
    { id: 'out', domain: 'dc', direction: 'output', voltage_v: 12, power_w: 500 },
  ],
  power_paths: [
    { id: 'convert', capability_id: 'convert', from_port: 'in', to_port: 'out', isolated: true },
  ],
});
export const batteryProduct = (): ComponentLibraryRecord => ({
  id: 'fixture.battery',
  manufacturer: 'Fixture maker',
  model: 'B',
  category: 'test',
  verification_status: 'verified',
  source_refs: [{ id: 'fixture.source', title: 'Project-authored test facts' }],
  capabilities: [{ id: 'store', type: 'energy_storage', port_ids: ['battery'] }],
  ports: [{ id: 'battery', domain: 'dc', direction: 'bidirectional', voltage_v: 12 }],
  electrical: { nominal_voltage_v: 12 },
  battery: {
    nominal_capacity_ah: 100,
    nominal_energy_wh: 1200,
    allowed_series_count: { min: 1, max: 4 },
    allowed_parallel_count: { min: 1, max: 4 },
  },
});
export const selectionRequest = (
  corpus: readonly ComponentLibraryRecord[] = [converterProduct()],
  shared = false,
  storage = false,
): ProductSelectionInput => {
  const req: ArchitectureGenerationInput = {
    schema_version: '2.0.0',
    assumptions: [],
    requirements: {
      id: 'fixture.selection',
      fixed_house_voltage_v: 24,
      loads: [
        {
          id: 'load',
          domain: { kind: 'dc', nominal_voltage_v: 12 },
          required_power_w: 100,
          requires_isolation: true,
        },
        ...(shared
          ? [
              {
                id: 'load2',
                domain: { kind: 'dc' as const, nominal_voltage_v: 12 },
                required_power_w: 200,
              },
            ]
          : []),
      ],
      charging_sources: [],
      storage: { required: storage, ...(storage ? { minimum_nominal_energy_wh: 4800 } : {}) },
    },
  };
  // Explicit isolation dedicates a boundary. Shared acceptance removes it so the
  // same-domain demands actually share the generated role, rather than an assumed role.
  const generation = generateArchitectures(
    shared
      ? {
          ...req,
          requirements: {
            ...req.requirements,
            loads: req.requirements.loads.map(({ requires_isolation: _isolation, ...l }) => l),
          },
        }
      : req,
  );
  return {
    schema_version: '1.0.0',
    generation,
    candidate_id: generation.candidates[0]!.id,
    corpus,
    fixed_existing: [],
    assemblies: [],
  };
};
