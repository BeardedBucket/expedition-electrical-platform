import { describe, expect, it } from 'vitest';
import { canonicalProposalSchemaValid } from '../src/promotion.js';

const componentWith = (constraints: unknown[]) => ({
  id: 'synthetic.constraint.component',
  manufacturer: 'Synthetic',
  model: 'Constraint Fixture',
  category: 'other',
  verification_status: 'unverified',
  ports: [
    {
      id: 'input',
      domain: 'dc',
      direction: 'input',
      constraints,
    },
    {
      id: 'output',
      domain: 'dc',
      direction: 'output',
    },
  ],
});

describe('generic electrical constraints', () => {
  it('distinguishes absolute maximum voltage from an operating range', () => {
    expect(
      canonicalProposalSchemaValid(
        componentWith([
          {
            id: 'input.max-voc',
            kind: 'absolute_maximum',
            quantity: 'voltage',
            unit: 'V',
            value: 75,
            conditions: [
              {
                path: 'electrical.nominal_voltage_v',
                equals: [12, 24],
              },
            ],
          },
          {
            id: 'input.mppt-range',
            kind: 'operating_range',
            quantity: 'voltage',
            unit: 'V',
            range: { min: 18, max: 66 },
          },
          {
            id: 'input.max-power',
            kind: 'absolute_maximum',
            quantity: 'power',
            unit: 'W',
            value: 220,
          },
        ]),
      ),
    ).toBe(true);
  });

  it('represents a relational headroom requirement without inventing an offset', () => {
    expect(
      canonicalProposalSchemaValid(
        componentWith([
          {
            id: 'input.relative-headroom',
            kind: 'relational_headroom',
            quantity: 'voltage',
            unit: 'V',
            reference: {
              port_id: 'output',
              relation: 'greater_than_or_equal',
              offset: 3,
            },
          },
        ]),
      ),
    ).toBe(true);
  });

  it('allows missing minimum and startup constraints to remain unknown', () => {
    expect(
      canonicalProposalSchemaValid(
        componentWith([
          {
            id: 'input.max-current',
            kind: 'absolute_maximum',
            quantity: 'current',
            unit: 'A',
            value: 15,
          },
        ]),
      ),
    ).toBe(true);
  });

  it('represents nominal design relationships without treating them as operating minima', () => {
    expect(
      canonicalProposalSchemaValid(
        componentWith([
          {
            id: 'input.nominal-pv-battery-voltage',
            kind: 'nominal_design',
            quantity: 'voltage',
            unit: 'V',
            reference: {
              port_id: 'output',
              relation: 'greater_than_or_equal',
              offset: 5,
            },
          },
        ]),
      ),
    ).toBe(true);
  });

  it('represents recovery hysteresis as an event-conditioned offset from a limit', () => {
    expect(
      canonicalProposalSchemaValid(
        componentWith([
          {
            id: 'input.max-voc',
            kind: 'absolute_maximum',
            quantity: 'voltage',
            unit: 'V',
            basis: 'open_circuit',
            value: 75,
          },
          {
            id: 'input.overvoltage-recovery',
            kind: 'recovery_hysteresis',
            quantity: 'voltage',
            unit: 'V',
            recovery: {
              constraint_id: 'input.max-voc',
              event: 'overvoltage',
              relation: 'less_than_or_equal',
              offset: -5,
            },
          },
        ]),
      ),
    ).toBe(true);
  });

  it('preserves conditional nominal power values independently', () => {
    expect(
      canonicalProposalSchemaValid(
        componentWith([
          {
            id: 'input.nominal-power-12v',
            kind: 'nominal',
            quantity: 'power',
            unit: 'W',
            value: 220,
            conditions: [{ path: 'electrical.nominal_voltage_v', equals: 12 }],
          },
          {
            id: 'input.nominal-power-24v',
            kind: 'nominal',
            quantity: 'power',
            unit: 'W',
            value: 440,
            conditions: [{ path: 'electrical.nominal_voltage_v', equals: 24 }],
          },
        ]),
      ),
    ).toBe(true);
  });

  it('distinguishes short-circuit current from ordinary current', () => {
    expect(
      canonicalProposalSchemaValid(
        componentWith([
          {
            id: 'input.max-pv-isc',
            kind: 'absolute_maximum',
            quantity: 'current',
            unit: 'A',
            basis: 'short_circuit',
            value: 15,
          },
          {
            id: 'input.charge-current',
            kind: 'absolute_maximum',
            quantity: 'current',
            unit: 'A',
            basis: 'operating',
            value: 15,
          },
        ]),
      ),
    ).toBe(true);
  });

  it('keeps missing semantic dimensions unknown instead of inferring them', () => {
    expect(
      canonicalProposalSchemaValid(
        componentWith([
          {
            id: 'input.unknown-current',
            kind: 'absolute_maximum',
            quantity: 'current',
            unit: 'A',
            value: 15,
          },
        ]),
      ),
    ).toBe(true);
  });
});
