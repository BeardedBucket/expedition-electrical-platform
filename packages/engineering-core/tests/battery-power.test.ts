import { describe, expect, it } from 'vitest';
import {
  calculateBatterySideCurrent,
  calculateDesignUsableEnergy,
  calculateLoadPower,
  calculateNominalEnergy,
  deriveBatteryBank,
  evaluateBatteryContinuousDischarge,
  evaluateBatterySurge,
  evaluateChargerCapability,
  evaluateChargeRate,
  evaluateSourceConcurrency,
  validateComponentLibraryRecord,
} from '../src/index.js';

const battery = {
  id: 'battery',
  nominalVoltageV: 24,
  nominalCapacityAh: 100,
  nominalEnergyWh: 2400,
  continuousDischargeCurrentA: 120,
  peakDischargeCurrentA: 300,
  peakDischargeDurationS: 10,
  allowedSeriesCount: { min: 1, max: 2 },
  allowedParallelCount: { min: 1, max: 4 },
};

describe('battery and power-flow primitives', () => {
  it('aggregates load power and calculates explicit-voltage battery current', () => {
    expect(
      calculateLoadPower([
        { id: 'a', powerW: 100, quantity: 2 },
        { id: 'b', powerW: 50, quantity: 1 },
      ]),
    ).toMatchObject({ ok: true, value: { powerW: 250 } });
    expect(
      calculateBatterySideCurrent({
        powerW: 240,
        voltageV: 24,
        voltageBasis: 'design',
        powerBasis: 'load-output',
        efficiency: 0.8,
      }),
    ).toMatchObject({
      ok: true,
      value: { currentA: 12.5, voltageBasis: 'design', inputPowerW: 300 },
    });
    expect(
      calculateBatterySideCurrent({
        powerW: 240,
        voltageV: 24,
        voltageBasis: 'design',
        powerBasis: 'load-output',
      }),
    ).toMatchObject({ ok: false, code: 'insufficient_data' });
    expect(
      calculateBatterySideCurrent({
        powerW: 240,
        voltageV: 24,
        voltageBasis: 'design',
        powerBasis: 'dc-side',
      }),
    ).toMatchObject({ ok: true, value: { currentA: 10, powerBasis: 'dc-side' } });
    expect(
      calculateBatterySideCurrent({
        powerW: 240,
        voltageV: undefined,
        voltageBasis: 'design',
        powerBasis: 'load-output',
        efficiency: 0.8,
      }),
    ).toMatchObject({ ok: false, code: 'insufficient_data' });
  });

  it('keeps nominal energy calculated and distinct from manufacturer energy', () => {
    expect(calculateNominalEnergy({ voltageV: 24, capacityAh: 100 })).toMatchObject({
      ok: true,
      value: { energyWh: 2400, basis: 'calculated' },
    });
    expect(calculateNominalEnergy({ voltageV: 12, capacityAh: 200 })).toMatchObject({
      ok: true,
      value: { energyWh: 2400 },
    });
  });

  it('requires an explicit usable-energy policy', () => {
    expect(
      calculateDesignUsableEnergy({
        nominalEnergyWh: 1200,
        usableFraction: 0.5,
        policy: { id: 'project.fla', version: '1.0.0' },
      }),
    ).toMatchObject({
      ok: true,
      value: { usableEnergyWh: 600, usableFraction: 0.5 },
    });
    expect(calculateDesignUsableEnergy({ nominalEnergyWh: 1200 })).toMatchObject({
      ok: false,
      code: 'insufficient_data',
    });
    const legacyProductData = { nominalEnergyWh: 1200, usableCapacityAh: 100 };
    expect(calculateDesignUsableEnergy(legacyProductData)).toMatchObject({
      ok: false,
      code: 'insufficient_data',
    });
  });

  it('derives series, parallel, and series-parallel banks without scaling current in series', () => {
    expect(deriveBatteryBank(battery, { seriesCount: 2, parallelCount: 2 })).toMatchObject({
      ok: true,
      value: {
        nominalVoltageV: 48,
        nominalCapacityAh: 200,
        nominalEnergyWh: 9600,
        continuousDischargeCurrentA: 240,
        peakDischargeCurrentA: 600,
      },
    });
    expect(deriveBatteryBank(battery, { seriesCount: 3, parallelCount: 1 })).toMatchObject({
      ok: false,
      code: 'invalid_input',
    });
    expect(deriveBatteryBank(battery, { seriesCount: 1.5, parallelCount: 1 })).toMatchObject({
      ok: false,
      code: 'invalid_input',
    });
    expect(deriveBatteryBank(battery, { seriesCount: 1, parallelCount: 1.5 })).toMatchObject({
      ok: false,
      code: 'invalid_input',
    });
    expect(
      deriveBatteryBank(
        { ...battery, allowedSeriesCount: undefined },
        { seriesCount: 1, parallelCount: 1 },
      ),
    ).toMatchObject({ ok: false, code: 'insufficient_data' });
    expect(
      deriveBatteryBank(
        { ...battery, allowedParallelCount: undefined },
        { seriesCount: 1, parallelCount: 1 },
      ),
    ).toMatchObject({ ok: false, code: 'insufficient_data' });
    expect(deriveBatteryBank(battery, { seriesCount: 2, parallelCount: 1 })).toMatchObject({
      ok: true,
      value: { nominalVoltageV: 48, continuousDischargeCurrentA: 120 },
    });
    expect(deriveBatteryBank(battery, { seriesCount: 1, parallelCount: 2 })).toMatchObject({
      ok: true,
      value: { nominalVoltageV: 24, continuousDischargeCurrentA: 240 },
    });
  });

  it('keeps selected discharge failure distinct from a feasible alternative', () => {
    const result = evaluateBatteryContinuousDischarge({
      requiredCurrentA: 145,
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
    });
    expect(result).toMatchObject({
      severity: 'FAIL',
      code: 'battery.bank.continuous_discharge_insufficient',
      selected: { passes: false },
    });
    expect(result.alternatives).toEqual(
      expect.arrayContaining([expect.objectContaining({ parallelCount: 2, passes: true })]),
    );
  });

  it('reports topology restrictions and maximum-bank insufficiency', () => {
    expect(
      evaluateBatteryContinuousDischarge({
        requiredCurrentA: 145,
        battery: { ...battery, allowedParallelCount: { min: 1, max: 1 } },
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({ severity: 'FAIL', code: 'battery.bank.parallel_not_permitted' });
    expect(
      evaluateBatteryContinuousDischarge({
        requiredCurrentA: 500,
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({ severity: 'FAIL', code: 'battery.bank.max_parallel_insufficient' });
  });

  it('evaluates surge current and duration independently', () => {
    expect(
      evaluateBatterySurge({
        requiredCurrentA: 250,
        requiredDurationS: 5,
        battery,
        topology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({ severity: 'PASS' });
    expect(
      evaluateBatterySurge({
        requiredCurrentA: 250,
        requiredDurationS: 20,
        battery,
        topology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({ severity: 'FAIL', code: 'battery.bank.surge_duration_insufficient' });
    expect(
      evaluateBatterySurge({
        requiredCurrentA: 250,
        requiredDurationS: 1,
        battery: { ...battery, peakDischargeDurationS: undefined },
        topology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({ severity: 'CONDITIONAL', code: 'battery.bank.surge_duration_missing' });
  });

  it('distinguishes charge guidance, hard limits, and protection limits', () => {
    expect(
      evaluateChargeRate({
        configuredCurrentA: 60,
        chargeCurrent: { recommendedA: 50 },
      }),
    ).toMatchObject({ severity: 'WARNING', code: 'battery.charge.recommended_rate_exceeded' });
    expect(
      evaluateChargeRate({
        configuredCurrentA: 60,
        chargeCurrent: { maximumContinuousA: 50 },
      }),
    ).toMatchObject({ severity: 'FAIL', code: 'battery.charge.configuration_limit_exceeded' });
    expect(
      evaluateChargeRate({
        configuredCurrentA: 60,
        chargeCurrent: { protectionLimitA: 50 },
      }),
    ).toMatchObject({ severity: 'FAIL', code: 'battery.charge.protection_limit_exceeded' });
  });

  it('limits calculated charger output by configuration and available input', () => {
    expect(
      evaluateChargerCapability({
        ratedOutputW: 1000,
        configuredOutputLimitW: 800,
        availableInputW: 500,
        efficiency: 0.8,
      }),
    ).toMatchObject({
      severity: 'PASS',
      possibleOutputW: 400,
      codes: expect.arrayContaining(['charger.output.input_limited']),
    });
  });

  it('evaluates source activity and mutual exclusion without hidden concurrency defaults', () => {
    expect(
      evaluateSourceConcurrency({
        activeSourceIds: ['solar', 'alternator'],
        unavailableSourceIds: ['shore'],
        availablePowerW: { solar: 100, alternator: 200 },
        mutuallyExclusiveGroups: [['alternator', 'shore']],
      }),
    ).toMatchObject({ severity: 'PASS', availablePowerW: 300 });
    expect(
      evaluateSourceConcurrency({
        activeSourceIds: ['alternator', 'shore'],
        mutuallyExclusiveGroups: [['alternator', 'shore']],
      }),
    ).toMatchObject({ severity: 'FAIL', code: 'source.concurrent_combination_invalid' });
    expect(
      evaluateSourceConcurrency({
        activeSourceIds: ['solar'],
        availablePowerW: { solar: 100, alternator: 200 },
      }),
    ).toMatchObject({ severity: 'PASS', availablePowerW: 100 });
    expect(
      evaluateSourceConcurrency({
        activeSourceIds: ['solar'],
        availablePowerW: { solar: 100 },
        configuredPowerLimitW: { solar: 40 },
      }),
    ).toMatchObject({ severity: 'PASS', availablePowerW: 40 });
    expect(
      evaluateSourceConcurrency({
        activeSourceIds: ['solar'],
        variableSourceIds: ['solar'],
      }),
    ).toMatchObject({ severity: 'CONDITIONAL', code: 'source.variable_capability' });
    expect(
      evaluateSourceConcurrency({
        activeSourceIds: ['shore'],
        unavailableSourceIds: ['shore'],
        availablePowerW: { shore: 1000 },
      }),
    ).toMatchObject({
      severity: 'CONDITIONAL',
      availablePowerW: 0,
      code: 'source.not_available_in_scenario',
    });
    expect(
      evaluateSourceConcurrency({
        activeSourceIds: ['shore'],
      }),
    ).toMatchObject({ severity: 'CONDITIONAL', code: 'source.available_capability_missing' });
  });

  it('validates the exact chemistry vocabulary and does not derive behavior from chemistry', () => {
    const base = {
      id: 'battery.example',
      manufacturer: 'Example',
      model: 'Battery',
      category: 'battery',
      verification_status: 'unverified',
      battery: { nominal_capacity_ah: 100 },
    };
    for (const chemistry of ['flooded_lead_acid', 'agm', 'gel', 'lifepo4', 'other']) {
      expect(validateComponentLibraryRecord({ ...base, battery: { chemistry } })).toMatchObject({
        ok: true,
      });
    }
    expect(validateComponentLibraryRecord(base)).toMatchObject({ ok: true });
    expect(
      validateComponentLibraryRecord({ ...base, battery: { chemistry: 'unknown' } }),
    ).toMatchObject({ ok: false });
    expect(
      calculateDesignUsableEnergy({
        nominalEnergyWh: 1200,
        usableFraction: undefined,
        policy: undefined,
      }),
    ).toMatchObject({ ok: false, code: 'insufficient_data' });
    expect(evaluateChargeRate({ configuredCurrentA: 60, chargeCurrent: {} })).toMatchObject({
      severity: 'PASS',
      code: 'battery.charge.within_limits',
    });
  });
});
