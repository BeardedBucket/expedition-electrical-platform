import type { ArchitectureGenerationInput } from '../../src/architecture-generation.js';

/** Project-authored nominal requirements; neither a recommended system nor product specifications. */
export const mixedArchitectureRequirements = (): ArchitectureGenerationInput => ({
  schema_version: '2.0.0',
  assumptions: [],
  requirements: {
    id: 'fixture.mobile-architecture',
    loads: [
      { id: 'native24', domain: { kind: 'dc', nominal_voltage_v: 24 }, required_power_w: 120 },
      { id: 'low12', domain: { kind: 'dc', nominal_voltage_v: 12 }, required_power_w: 300 },
      {
        id: 'ac120',
        domain: { kind: 'ac', nominal_voltage_v: 120, frequency_hz: 60 },
        required_power_w: 800,
      },
    ],
    charging_sources: [
      {
        id: 'vehicle',
        kind: 'vehicle',
        domain: { kind: 'dc', nominal_voltage_v: 12 },
        required_output_power_w: 250,
      },
      {
        id: 'solar',
        kind: 'solar',
        domain: { kind: 'pv_dc', nominal_voltage_v: 36 },
        required_output_power_w: 200,
      },
      {
        id: 'shore',
        kind: 'shore',
        domain: { kind: 'ac', nominal_voltage_v: 230, frequency_hz: 50 },
        required_output_power_w: 500,
      },
    ],
    storage: { required: true, minimum_nominal_energy_wh: 2400 },
  },
});
