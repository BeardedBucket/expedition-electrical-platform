import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculateBatterySideCurrent,
  calculateDesignUsableEnergy,
  calculateLoadPower,
  calculateNominalEnergy,
  deriveBatteryBank,
  enumerateFeasibleBankConfigurations,
  evaluateBatteryContinuousDischarge,
  evaluateBatterySurge,
  evaluateBatteryNominalEnergy,
  evaluateBatteryNominalVoltage,
  evaluateChargerCapability,
  evaluateChargeRate,
  evaluateSourceConcurrency,
  validateComponentLibraryRecord,
  type BatteryEngineeringInput,
} from '../src/index.js';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';

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

describe('battery bank nominal voltage requirement evaluation', () => {
  it('evaluates nominal voltage requirements and identifies series alternatives', () => {
    const result = evaluateBatteryNominalVoltage({
      requiredVoltageV: 48,
      voltageBasis: 'nominal',
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
    });
    expect(result).toMatchObject({
      severity: 'FAIL',
      code: 'battery.bank.voltage_requirement_insufficient',
      selected: { passes: false, achievedVoltageV: 24 },
    });
    expect(result.alternatives).toEqual(
      expect.arrayContaining([expect.objectContaining({ seriesCount: 2, passes: true })]),
    );
  });

  it('passes when selected topology meets voltage requirement', () => {
    expect(
      evaluateBatteryNominalVoltage({
        requiredVoltageV: 24,
        voltageBasis: 'nominal',
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({
      severity: 'PASS',
      code: 'battery.bank.voltage_requirement_pass',
      selected: { passes: true, achievedVoltageV: 24 },
    });
  });

  it('fails with invalid voltage requirement', () => {
    expect(
      evaluateBatteryNominalVoltage({
        requiredVoltageV: -48,
        voltageBasis: 'nominal',
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({
      severity: 'CONDITIONAL',
      code: 'battery.bank.voltage_requirement_invalid',
      selected: { passes: false },
    });
  });

  it('rejects topology when series exceeds manufacturer maximum', () => {
    expect(
      evaluateBatteryNominalVoltage({
        requiredVoltageV: 72,
        voltageBasis: 'nominal',
        battery,
        selectedTopology: { seriesCount: 3, parallelCount: 1 },
      }),
    ).toMatchObject({
      severity: 'FAIL',
      code: 'battery.bank.topology_not_permitted',
      selected: { passes: false },
    });
  });
});

describe('battery bank nominal energy requirement evaluation', () => {
  it('evaluates nominal energy requirements and identifies feasible alternatives', () => {
    const result = evaluateBatteryNominalEnergy({
      requiredEnergyWh: 5000,
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
    });
    expect(result).toMatchObject({
      severity: 'FAIL',
      code: 'battery.bank.energy_requirement_insufficient',
      selected: { passes: false, achievedEnergyWh: 2400 },
    });
    expect(result.alternatives).toContainEqual(
      expect.objectContaining({ seriesCount: 1, parallelCount: 3, passes: true }),
    );
  });

  it('passes when selected topology meets energy requirement', () => {
    expect(
      evaluateBatteryNominalEnergy({
        requiredEnergyWh: 2400,
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({
      severity: 'PASS',
      code: 'battery.bank.energy_requirement_pass',
      selected: { passes: true, achievedEnergyWh: 2400 },
    });
  });

  it('fails with invalid energy requirement', () => {
    expect(
      evaluateBatteryNominalEnergy({
        requiredEnergyWh: -1000,
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({
      severity: 'CONDITIONAL',
      code: 'battery.bank.energy_requirement_invalid',
      selected: { passes: false },
    });
  });

  it('keeps energy alternatives in deterministic topology order', () => {
    const result = evaluateBatteryNominalEnergy({
      requiredEnergyWh: 5000,
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
    });
    expect(result.alternatives.length).toBeGreaterThan(0);
    for (let i = 1; i < result.alternatives.length; i += 1) {
      const previous = result.alternatives[i - 1];
      const current = result.alternatives[i];
      const previousCount = previous.seriesCount * previous.parallelCount;
      const currentCount = current.seriesCount * current.parallelCount;
      if (previousCount !== currentCount) {
        expect(currentCount).toBeGreaterThan(previousCount);
      } else if (previous.seriesCount !== current.seriesCount) {
        expect(current.seriesCount).toBeGreaterThan(previous.seriesCount);
      } else {
        expect(current.parallelCount).toBeGreaterThan(previous.parallelCount);
      }
    }
  });

  it('identifies when no feasible topology meets requirement', () => {
    expect(
      evaluateBatteryNominalEnergy({
        requiredEnergyWh: 100000,
        battery,
        selectedTopology: { seriesCount: 1, parallelCount: 1 },
      }),
    ).toMatchObject({
      severity: 'FAIL',
      code: 'battery.bank.no_feasible_topology',
      alternatives: expect.not.arrayContaining([expect.objectContaining({ passes: true })]),
    });
  });
});

describe('feasible bank configuration enumeration', () => {
  it('enumerates all valid topologies within manufacturer limits', () => {
    const alternatives = enumerateFeasibleBankConfigurations({ battery });
    expect(alternatives.length).toBe(8);
    expect(alternatives[0]).toMatchObject({ seriesCount: 1, parallelCount: 1, totalUnitCount: 1 });
    expect(alternatives[1]).toMatchObject({ seriesCount: 1, parallelCount: 2, totalUnitCount: 2 });
    expect(alternatives[2]).toMatchObject({ seriesCount: 2, parallelCount: 1, totalUnitCount: 2 });
    expect(alternatives[3]).toMatchObject({ seriesCount: 1, parallelCount: 3, totalUnitCount: 3 });
    expect(alternatives[4]).toMatchObject({ seriesCount: 1, parallelCount: 4, totalUnitCount: 4 });
    expect(alternatives[5]).toMatchObject({ seriesCount: 2, parallelCount: 2, totalUnitCount: 4 });
    expect(alternatives[6]).toMatchObject({ seriesCount: 2, parallelCount: 3, totalUnitCount: 6 });
    expect(alternatives[7]).toMatchObject({ seriesCount: 2, parallelCount: 4, totalUnitCount: 8 });
  });

  it('returns empty array when topology limits are missing', () => {
    const alternatives = enumerateFeasibleBankConfigurations({
      battery: { ...battery, allowedSeriesCount: undefined },
    });
    expect(alternatives).toEqual([]);
  });

  it('sorts alternatives by total battery count, then series, then parallel', () => {
    const alternatives = enumerateFeasibleBankConfigurations({ battery });
    for (let i = 1; i < alternatives.length; i += 1) {
      const prev = alternatives[i - 1];
      const curr = alternatives[i];
      if (prev.totalUnitCount !== curr.totalUnitCount) {
        expect(curr.totalUnitCount).toBeGreaterThanOrEqual(prev.totalUnitCount);
      } else if (prev.seriesCount !== curr.seriesCount) {
        expect(curr.seriesCount).toBeGreaterThanOrEqual(prev.seriesCount);
      } else {
        expect(curr.parallelCount).toBeGreaterThanOrEqual(prev.parallelCount);
      }
    }
  });
});

describe('real epoch battery canonical integration', () => {
  it('supports Epoch B24100A-C canonical facts: 25.6V, 100Ah, 2560Wh', () => {
    const epoch: BatteryEngineeringInput = {
      id: 'epoch-batteries.b24100a-c',
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const bank1s1p = deriveBatteryBank(epoch, { seriesCount: 1, parallelCount: 1 });
    expect(bank1s1p).toMatchObject({
      ok: true,
      value: {
        nominalVoltageV: 25.6,
        nominalCapacityAh: 100,
        nominalEnergyWh: 2560,
        nominalEnergyBasis: 'manufacturer',
        continuousDischargeCurrentA: 120,
        peakDischargeCurrentA: 200,
        peakDischargeDurationS: 60,
      },
    });
  });

  it('calculates 1S2P: 25.6V, 200Ah, 5120Wh, 240A continuous', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const bank1s2p = deriveBatteryBank(epoch, { seriesCount: 1, parallelCount: 2 });
    expect(bank1s2p).toMatchObject({
      ok: true,
      value: {
        nominalVoltageV: 25.6,
        nominalCapacityAh: 200,
        nominalEnergyWh: 5120,
        continuousDischargeCurrentA: 240,
        peakDischargeCurrentA: 400,
      },
    });
  });

  it('calculates 2S1P: 51.2V, 100Ah, 5120Wh, 120A continuous', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const bank2s1p = deriveBatteryBank(epoch, { seriesCount: 2, parallelCount: 1 });
    expect(bank2s1p).toMatchObject({
      ok: true,
      value: {
        nominalVoltageV: 51.2,
        nominalCapacityAh: 100,
        nominalEnergyWh: 5120,
        continuousDischargeCurrentA: 120,
        peakDischargeCurrentA: 200,
      },
    });
  });

  it('calculates 1S3P as 7680Wh using manufacturer energy basis', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    expect(deriveBatteryBank(epoch, { seriesCount: 1, parallelCount: 3 })).toMatchObject({
      ok: true,
      value: {
        nominalEnergyWh: 7680,
        nominalEnergyBasis: 'manufacturer',
      },
    });
  });

  it('calculates 2S4P: 51.2V, 400Ah, 20480Wh, 480A continuous', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const bank2s4p = deriveBatteryBank(epoch, { seriesCount: 2, parallelCount: 4 });
    expect(bank2s4p).toMatchObject({
      ok: true,
      value: {
        nominalVoltageV: 51.2,
        nominalCapacityAh: 400,
        nominalEnergyWh: 20480,
        continuousDischargeCurrentA: 480,
        peakDischargeCurrentA: 800,
      },
    });
  });

  it('rejects 3S1P topology (exceeds 2S maximum)', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const bank3s1p = deriveBatteryBank(epoch, { seriesCount: 3, parallelCount: 1 });
    expect(bank3s1p).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('rejects 1S5P topology (exceeds 4P maximum)', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const bank1s5p = deriveBatteryBank(epoch, { seriesCount: 1, parallelCount: 5 });
    expect(bank1s5p).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  it('requirement example: 145A continuous discharge requires 1S2P', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const result = evaluateBatteryContinuousDischarge({
      requiredCurrentA: 145,
      battery: epoch,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
    });

    expect(result).toMatchObject({
      severity: 'FAIL',
      selected: { passes: false, availableCurrentA: 120 },
    });
    expect(result.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ seriesCount: 1, parallelCount: 2, passes: true }),
      ]),
    );
  });

  it('requirement example: 5000Wh nominal energy requires 1S2P', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const result = evaluateBatteryNominalEnergy({
      requiredEnergyWh: 5000,
      battery: epoch,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
    });

    expect(result).toMatchObject({
      severity: 'FAIL',
      selected: { passes: false, achievedEnergyWh: 2560 },
    });
    expect(result.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ seriesCount: 1, parallelCount: 2, passes: true }),
      ]),
    );
  });

  it('requirement example: 48V requires 2S', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const result = evaluateBatteryNominalVoltage({
      requiredVoltageV: 48,
      voltageBasis: 'nominal',
      battery: epoch,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
    });

    expect(result).toMatchObject({
      severity: 'FAIL',
      selected: { passes: false, achievedVoltageV: 25.6 },
    });
    expect(result.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ seriesCount: 2, passes: true, achievedVoltageV: 51.2 }),
      ]),
    );
  });

  it('requirement example: 180A for 30s peak duration passes 1S1P', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const result = evaluateBatterySurge({
      requiredCurrentA: 180,
      requiredDurationS: 30,
      battery: epoch,
      topology: { seriesCount: 1, parallelCount: 1 },
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      code: 'battery.bank.surge_pass',
    });
  });

  it('requirement example: 180A for 90s peak duration fails (duration exceeds 60s)', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const result = evaluateBatterySurge({
      requiredCurrentA: 180,
      requiredDurationS: 90,
      battery: epoch,
      topology: { seriesCount: 1, parallelCount: 1 },
    });

    expect(result).toMatchObject({
      severity: 'FAIL',
      code: 'battery.bank.surge_duration_insufficient',
    });
  });

  it('enumerates all 8 valid Epoch topologies: 1S1P through 2S4P', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const alternatives = enumerateFeasibleBankConfigurations({ battery: epoch });
    expect(alternatives.length).toBe(8);

    const topologyMap = new Map(
      alternatives.map((alt) => [`${alt.seriesCount}S${alt.parallelCount}P`, alt]),
    );
    expect(topologyMap.size).toBe(8);

    expect(topologyMap.get('1S1P')).toMatchObject({
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
    });
    expect(topologyMap.get('2S4P')).toMatchObject({
      nominalVoltageV: 51.2,
      nominalCapacityAh: 400,
      nominalEnergyWh: 20480,
    });
  });

  it('preserves manufacturer nominal energy through all valid topologies', () => {
    const epoch: BatteryEngineeringInput = {
      nominalVoltageV: 25.6,
      nominalCapacityAh: 100,
      nominalEnergyWh: 2560,
      continuousDischargeCurrentA: 120,
      peakDischargeCurrentA: 200,
      peakDischargeDurationS: 60,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };

    const alternatives = enumerateFeasibleBankConfigurations({ battery: epoch });
    for (const alt of alternatives) {
      expect(alt.nominalEnergyBasis).toBe('manufacturer');
      const expectedWh = 2560 * alt.seriesCount * alt.parallelCount;
      expect(alt.nominalEnergyWh).toBe(expectedWh);
    }
  });

  it('loads Epoch through the canonical component-library path and preserves source energy', async () => {
    const result = await loadComponentLibraryFile(
      path.resolve('data/components/epoch-batteries.b24100a-c.yaml'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const component = result.value;
    const asNumber = (value: number | number[] | null | undefined): number => {
      if (typeof value !== 'number') throw new Error('Expected a scalar numeric component field.');
      return value;
    };
    const batteryFromCanonical: BatteryEngineeringInput = {
      id: component.id,
      nominalVoltageV: asNumber(component.electrical?.nominal_voltage_v),
      nominalCapacityAh: asNumber(component.battery?.nominal_capacity_ah),
      nominalEnergyWh: asNumber(component.battery?.nominal_energy_wh),
      continuousDischargeCurrentA: asNumber(component.electrical?.continuous_discharge_current_a),
      peakDischargeCurrentA: asNumber(component.electrical?.peak_discharge_current_a),
      peakDischargeDurationS: asNumber(component.electrical?.peak_discharge_duration_s),
      allowedSeriesCount: component.battery?.allowed_series_count ?? undefined,
      allowedParallelCount: component.battery?.allowed_parallel_count ?? undefined,
    };

    const expected = [
      [1, 1, 2560],
      [1, 2, 5120],
      [1, 3, 7680],
      [2, 1, 5120],
      [2, 4, 20480],
    ] as const;
    for (const [seriesCount, parallelCount, nominalEnergyWh] of expected) {
      expect(deriveBatteryBank(batteryFromCanonical, { seriesCount, parallelCount })).toMatchObject(
        {
          ok: true,
          value: { nominalEnergyWh, nominalEnergyBasis: 'manufacturer' },
        },
      );
    }
  });

  it('falls back to calculated V×Ah energy only when source energy is absent', () => {
    const synthetic: BatteryEngineeringInput = {
      nominalVoltageV: 24,
      nominalCapacityAh: 100,
      allowedSeriesCount: { min: 1, max: 2 },
      allowedParallelCount: { min: 1, max: 4 },
    };
    expect(deriveBatteryBank(synthetic, { seriesCount: 2, parallelCount: 3 })).toMatchObject({
      ok: true,
      value: {
        nominalEnergyWh: 14400,
        nominalEnergyBasis: 'calculated',
      },
    });
    expect(
      deriveBatteryBank(
        { ...synthetic, nominalEnergyWh: 2500 },
        { seriesCount: 2, parallelCount: 3 },
      ),
    ).toMatchObject({
      ok: true,
      value: {
        nominalEnergyWh: 15000,
        nominalEnergyBasis: 'manufacturer',
      },
    });
  });
});
