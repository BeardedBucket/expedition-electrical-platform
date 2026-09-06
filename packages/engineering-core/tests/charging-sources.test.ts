import { describe, expect, it } from 'vitest';
import { evaluateChargingSourceScenario } from '../src/index.js';

const source = (overrides: Record<string, unknown> = {}) => ({
  id: 'shore',
  name: 'Shore charger',
  sourceType: 'shore_charger' as const,
  active: true,
  availability: 'available' as const,
  installedCurrentA: 50,
  voltageV: 24,
  ...overrides,
});

describe('charging source scenarios', () => {
  it('separates installed capability from inactive scenario availability', () => {
    const result = evaluateChargingSourceScenario({
      scenarioId: 'parked',
      batteryVoltageV: 24,
      sources: [source({ active: false })],
    });

    expect(result.installedCapability.currentA).toBe(50);
    expect(result.availableCapability.currentA).toBe(0);
    expect(result.inactiveSources.map((item) => item.sourceId)).toEqual(['shore']);
  });

  it('applies a configured current limit without changing installed capability', () => {
    const result = evaluateChargingSourceScenario({
      scenarioId: 'campground',
      batteryVoltageV: 24,
      sources: [source({ configuredCurrentLimitA: 35 })],
    });

    expect(result.installedCapability.currentA).toBe(50);
    expect(result.availableCapability.currentA).toBe(35);
    expect(result.contributingSources[0]?.availableCurrentA).toBe(35);
  });

  it('fails rather than clamping a configured limit above capability', () => {
    const result = evaluateChargingSourceScenario({
      batteryVoltageV: 24,
      sources: [source({ configuredCurrentLimitA: 60 })],
    });

    expect(result.severity).toBe('FAIL');
    expect(result.invalidSources.map((item) => item.sourceId)).toEqual(['shore']);
  });

  it('sums only explicitly active and available simultaneous sources', () => {
    const result = evaluateChargingSourceScenario({
      scenarioId: 'driving-daylight',
      batteryVoltageV: 24,
      sources: [
        source({ id: 'alternator', sourceType: 'alternator_dc_dc', installedCurrentA: 30 }),
        source({ id: 'solar', sourceType: 'solar_charge_controller', installedCurrentA: 40 }),
        source({ id: 'shore-standby', active: false }),
      ],
    });

    expect(result.availableCapability.currentA).toBe(70);
    expect(result.contributingSources.map((item) => item.sourceId)).toEqual([
      'alternator',
      'solar',
    ]);
  });

  it('retains known current when solar availability is unresolved', () => {
    const result = evaluateChargingSourceScenario({
      scenarioId: 'driving-uncertain-solar',
      batteryVoltageV: 24,
      sources: [
        source({ id: 'alternator', sourceType: 'alternator_dc_dc', installedCurrentA: 30 }),
        source({
          id: 'solar',
          sourceType: 'solar_charge_controller',
          installedCurrentA: 40,
          availability: 'unresolved',
        }),
      ],
    });

    expect(result.availableCapability.currentA).toBe(30);
    expect(result.availableCapability.totalResolved).toBe(false);
    expect(result.unresolvedSources.map((item) => item.sourceId)).toEqual(['solar']);
  });

  it('derives current from battery-output power and explicit voltage', () => {
    const result = evaluateChargingSourceScenario({
      batteryVoltageV: 24,
      sources: [
        source({
          installedCurrentA: undefined,
          installedPowerW: 1200,
          powerBasis: 'battery-output',
        }),
      ],
    });

    expect(result.availableCapability.powerW).toBe(1200);
    expect(result.availableCapability.currentA).toBe(50);
  });

  it('does not derive current without a voltage basis', () => {
    const result = evaluateChargingSourceScenario({
      sources: [
        source({
          installedCurrentA: undefined,
          installedPowerW: 1200,
          voltageV: undefined,
          powerBasis: 'battery-output',
        }),
      ],
    });

    expect(result.availableCapability.powerW).toBe(1200);
    expect(result.availableCapability.currentA).toBeUndefined();
    expect(result.unresolvedSources.map((item) => item.sourceId)).toEqual(['shore']);
  });

  it('applies explicit input-side efficiency for converted power', () => {
    const result = evaluateChargingSourceScenario({
      batteryVoltageV: 24,
      sources: [
        source({
          installedCurrentA: undefined,
          installedPowerW: 1000,
          powerBasis: 'input',
          efficiency: 0.9,
        }),
      ],
    });

    expect(result.availableCapability.powerW).toBe(900);
    expect(result.availableCapability.currentA).toBe(37.5);
  });

  it('marks converted power unresolved when efficiency is missing', () => {
    const result = evaluateChargingSourceScenario({
      batteryVoltageV: 24,
      sources: [
        source({
          installedCurrentA: undefined,
          installedPowerW: 1000,
          powerBasis: 'input',
        }),
      ],
    });

    expect(result.severity).toBe('CONDITIONAL');
    expect(result.availableCapability.totalResolved).toBe(false);
    expect(result.unresolvedSources[0]?.reason).toContain('efficiency');
  });

  it('preserves invalid and unresolved findings together', () => {
    const result = evaluateChargingSourceScenario({
      batteryVoltageV: 24,
      sources: [
        source({ id: 'invalid', configuredCurrentLimitA: 60 }),
        source({
          id: 'solar',
          sourceType: 'solar_charge_controller',
          installedCurrentA: 40,
          availability: 'unresolved',
        }),
      ],
    });

    expect(result.severity).toBe('FAIL');
    expect(result.invalidSources.map((item) => item.sourceId)).toEqual(['invalid']);
    expect(result.unresolvedSources.map((item) => item.sourceId)).toEqual(['solar']);
  });

  it('honors explicit mutual exclusion without scheduling sources', () => {
    const result = evaluateChargingSourceScenario({
      batteryVoltageV: 24,
      sources: [
        source({ id: 'shore', sourceGroupId: 'external-input' }),
        source({
          id: 'alternator',
          sourceType: 'alternator_dc_dc',
          installedCurrentA: 30,
          sourceGroupId: 'external-input',
        }),
      ],
    });

    expect(result.severity).toBe('FAIL');
    expect(result.invalidSources[0]?.reason).toContain('mutually exclusive');
  });

  it('returns a deterministic empty scenario', () => {
    const result = evaluateChargingSourceScenario({ scenarioId: 'empty', sources: [] });

    expect(result.severity).toBe('CONDITIONAL');
    expect(result.installedCapability.currentA).toBe(0);
    expect(result.availableCapability.currentA).toBe(0);
  });

  it('supports a camper regression with explicit scenario provenance', () => {
    const sources = [
      source({ id: 'shore', installedCurrentA: 50 }),
      source({ id: 'alternator', sourceType: 'alternator_dc_dc', installedCurrentA: 30 }),
      source({ id: 'solar', sourceType: 'solar_charge_controller', installedCurrentA: 40 }),
    ];

    const campground = evaluateChargingSourceScenario({
      scenarioId: 'campground',
      batteryVoltageV: 24,
      sources: sources.map((item) => ({ ...item, active: item.id !== 'alternator' })),
    });
    const driving = evaluateChargingSourceScenario({
      scenarioId: 'driving',
      batteryVoltageV: 24,
      sources: sources.map((item) => ({ ...item, active: item.id !== 'shore' })),
    });
    const night = evaluateChargingSourceScenario({
      scenarioId: 'parked-night',
      batteryVoltageV: 24,
      sources: sources.map((item) => ({ ...item, active: false })),
    });

    expect(campground.availableCapability.currentA).toBe(90);
    expect(driving.availableCapability.currentA).toBe(70);
    expect(night.availableCapability.currentA).toBe(0);
    expect([campground, driving, night].map((item) => item.scenarioId)).toEqual([
      'campground',
      'driving',
      'parked-night',
    ]);
  });
});
