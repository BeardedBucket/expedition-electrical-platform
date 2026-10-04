import { describe, expect, it } from 'vitest';
import { generateArchitectures } from '../src/architecture-generation.js';
import {
  evaluateInstalledSystem,
  parseEngineeringPassport,
  serializeEngineeringPassport,
} from '../src/engineering-passport.js';
import { mixedArchitectureRequirements } from './fixtures/architecture-requirements.js';
import { architectureWitness } from './fixtures/architecture-witness.js';

describe('abstract roles instantiate through the exact Phase 3 nominal authority (test only)', () => {
  for (const candidate of generateArchitectures(mixedArchitectureRequirements()).candidates) {
    it(`${candidate.choices.house_voltage_v} V ${candidate.choices.ac_function_arrangement} witnesses retain every directed nominal relationship`, () => {
      const { input, catalog } = architectureWitness(candidate);
      const passport = evaluateInstalledSystem(input, catalog);
      expect(passport.decisions.filter((decision) => decision.status !== 'satisfied')).toEqual([]);
      expect(passport.result.status).toBe('satisfied');
      expect(passport.result.installation_safety).toBe('not_evaluated');
      expect(
        passport.decisions
          .filter((decision) => decision.id.startsWith('edge:'))
          .every((decision) => decision.status === 'satisfied'),
      ).toBe(true);
      expect(parseEngineeringPassport(serializeEngineeringPassport(passport))).toEqual(passport);
      expect(
        passport.calculations.some((calculation) => calculation.id.startsWith('conversion:')),
      ).toBe(false);
    });
  }
  it('withholding witness review leaves exact binding unresolved without changing abstract generation', () => {
    const input = mixedArchitectureRequirements();
    const result = generateArchitectures(input);
    const witness = architectureWitness(result.candidates[0]!);
    const catalog = witness.catalog.map((record) => ({
      ...record,
      verification_status: 'unverified' as const,
    }));
    expect(evaluateInstalledSystem(witness.input, catalog).result.status).toBe('unresolved');
    expect(generateArchitectures(input)).toEqual(result);
    expect(
      result.candidates.every(
        (candidate) => candidate.structural_evaluation.status === 'structurally_viable',
      ),
    ).toBe(true);
  });
  it('replacing a generated conversion with a wire blocks both authorities', () => {
    const candidate = generateArchitectures(mixedArchitectureRequirements()).candidates.find(
      (c) => c.choices.house_voltage_v === 24 && c.choices.ac_function_arrangement === 'separate',
    )!;
    const witness = architectureWitness(candidate);
    const topology = witness.input.architecture.power_topology;
    const broken = {
      ...witness.input,
      architecture: {
        ...witness.input.architecture,
        power_topology: {
          ...topology,
          edges: topology.edges.map((edge) =>
            edge.kind === 'power_path' &&
            edge.instance_id ===
              candidate.required_roles.find((role) =>
                role.output_capacity.some((capacity) =>
                  capacity.demand_endpoint_ids.includes('demand.low12'),
                ),
              )!.id
              ? { id: edge.id, kind: 'wire' as const, from: edge.from, to: edge.to }
              : edge,
          ),
        },
      },
    };
    expect(evaluateInstalledSystem(broken, witness.catalog).result.status).toBe('blocked');
  });
});
