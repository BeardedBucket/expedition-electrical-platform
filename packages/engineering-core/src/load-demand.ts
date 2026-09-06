import type { BatteryBankRequirements, EngineeringIssue } from './battery-power.js';

export type LoadSupplyType = 'dc' | 'ac';

export interface LoadDemandDefinition {
  readonly id: string;
  readonly name?: string;
  readonly supplyType?: LoadSupplyType;
  readonly active?: boolean;
  readonly powerW?: number;
  readonly configuredPowerW?: number;
  readonly runtimeHours?: number;
  readonly dutyCycle?: number;
  readonly startupPowerW?: number;
  readonly startupDurationS?: number;
  readonly voltageV?: number;
  readonly inverterEfficiency?: number;
  readonly dcDcEfficiency?: number;
}

export interface LoadDemandScenarioInput {
  readonly scenarioId?: string;
  readonly designVoltageV?: number;
  readonly batteryVoltageV?: number;
  readonly loads: readonly LoadDemandDefinition[];
  readonly assumptions?: readonly string[];
}

export interface LoadDemandLoadContribution {
  readonly id: string;
  readonly name?: string;
  readonly supplyType: LoadSupplyType;
  readonly active: boolean;
  readonly loadSidePowerW: number;
  readonly batterySidePowerW?: number;
  readonly loadEnergyWh?: number;
  readonly batteryEnergyWh?: number;
  readonly startupPowerW?: number;
  readonly startupDurationS?: number;
  readonly currentA?: number;
  readonly voltageV?: number;
  readonly reasons: readonly string[];
}

export interface LoadDemandSurgeContribution {
  readonly loadId: string;
  readonly loadName?: string;
  readonly supplyType: LoadSupplyType;
  readonly powerW: number;
  readonly durationS?: number;
  readonly currentA?: number;
  readonly batterySidePowerW?: number;
  readonly resolved: boolean;
}

export interface LoadDemandSurgeRequirement {
  readonly powerW: number;
  readonly durationS?: number;
  readonly currentA?: number;
  readonly batterySidePowerW?: number;
  readonly resolved: boolean;
}

export interface LoadDemandScenarioResult extends EngineeringIssue {
  readonly scenarioId?: string;
  readonly totalLoadSidePowerW: number;
  readonly totalBatterySidePowerW?: number;
  readonly totalLoadEnergyWh?: number;
  readonly totalBatteryEnergyWh?: number;
  readonly continuousBatteryCurrentA?: number;
  readonly surgeRequirement?: LoadDemandSurgeRequirement;
  readonly surgeContributions?: readonly LoadDemandSurgeContribution[];
  readonly contributingLoads: readonly LoadDemandLoadContribution[];
  readonly unresolvedInputs: readonly string[];
  readonly designVoltageV?: number;
  readonly batteryVoltageV?: number;
  readonly assumptions: readonly string[];
}

const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const validDutyCycle = (value: number): boolean =>
  Number.isFinite(value) && value >= 0 && value <= 1;

const resolveVoltageBasis = (
  input: LoadDemandScenarioInput,
): { basis?: number; conflict?: string } => {
  const hasDesign = input.designVoltageV !== undefined;
  const hasBattery = input.batteryVoltageV !== undefined;

  if (hasDesign && hasBattery && input.designVoltageV !== input.batteryVoltageV) {
    return {
      conflict:
        'batteryVoltageV and designVoltageV are both supplied and conflict; a single battery-side voltage basis is required.',
    };
  }

  return {
    basis: input.batteryVoltageV ?? input.designVoltageV,
  };
};

const convertBatterySidePower = (
  load: LoadDemandDefinition,
  powerW: number,
  supplyType: LoadSupplyType,
  batteryVoltageBasis: number | undefined,
): { powerW: number; currentA?: number; unresolved: string[] } => {
  const unresolved: string[] = [];

  if (supplyType === 'ac') {
    const efficiency = load.inverterEfficiency;
    if (efficiency === undefined || !finitePositive(efficiency) || efficiency > 1) {
      unresolved.push(
        `${load.id}: AC load requires explicit inverterEfficiency for battery-side conversion.`,
      );
      return { powerW: Number.NaN, unresolved };
    }
    const batterySidePowerW = powerW / efficiency;
    const currentA =
      batteryVoltageBasis !== undefined ? batterySidePowerW / batteryVoltageBasis : undefined;
    return { powerW: batterySidePowerW, currentA, unresolved };
  }

  const dcEfficiency = load.dcDcEfficiency;
  if (dcEfficiency !== undefined) {
    if (!finitePositive(dcEfficiency) || dcEfficiency > 1) {
      unresolved.push(
        `${load.id}: DC load conversion requires explicit dcDcEfficiency in the range (0,1].`,
      );
      return { powerW: Number.NaN, unresolved };
    }
    const batterySidePowerW = powerW / dcEfficiency;
    const currentA =
      batteryVoltageBasis !== undefined ? batterySidePowerW / batteryVoltageBasis : undefined;
    return { powerW: batterySidePowerW, currentA, unresolved };
  }

  const loadVoltageV = load.voltageV ?? batteryVoltageBasis;
  if (
    loadVoltageV !== undefined &&
    batteryVoltageBasis !== undefined &&
    loadVoltageV !== batteryVoltageBasis
  ) {
    unresolved.push(
      `${load.id}: DC load conversion requires explicit dcDcEfficiency when the load-side and battery-side voltage differ.`,
    );
    return { powerW: Number.NaN, unresolved };
  }

  return {
    powerW,
    currentA: batteryVoltageBasis !== undefined ? powerW / batteryVoltageBasis : undefined,
    unresolved,
  };
};

export const evaluateLoadDemandScenario = (
  input: LoadDemandScenarioInput,
): LoadDemandScenarioResult => {
  const unresolvedInputs: string[] = [];
  const contributingLoads: LoadDemandLoadContribution[] = [];
  const surgeContributions: LoadDemandSurgeContribution[] = [];
  const loads = input.loads ?? [];
  const voltageResolution = resolveVoltageBasis(input);
  const batteryVoltageBasis = voltageResolution.basis;

  if (voltageResolution.conflict) {
    unresolvedInputs.push(voltageResolution.conflict);
  }

  if (loads.length === 0) {
    return {
      severity: 'CONDITIONAL',
      code: 'load-demand.empty_scenario',
      message: 'No loads were supplied to the scenario.',
      totalLoadSidePowerW: 0,
      contributingLoads: [],
      unresolvedInputs: ['No loads were supplied to the scenario.'],
      designVoltageV: input.designVoltageV,
      batteryVoltageV: input.batteryVoltageV,
      assumptions: input.assumptions ?? [],
    };
  }

  let totalLoadSidePowerW = 0;
  let totalBatterySidePowerW = 0;
  let totalLoadEnergyWh = 0;
  let totalBatteryEnergyWh = 0;
  let hasEnergyResolution = false;
  const activeLoads = loads.filter((load) => load.active ?? true);
  const hasExplicitEnergyData = activeLoads.some(
    (load) => load.runtimeHours !== undefined || load.dutyCycle !== undefined,
  );

  for (const load of loads) {
    const active = load.active ?? true;
    if (!active) {
      continue;
    }

    const supplyType = load.supplyType ?? 'dc';
    const effectivePower = load.configuredPowerW ?? load.powerW;
    if (effectivePower === undefined || !finiteNonNegative(effectivePower)) {
      unresolvedInputs.push(`${load.id}: Load power is missing or invalid.`);
      contributingLoads.push({
        id: load.id,
        name: load.name,
        supplyType,
        active,
        loadSidePowerW: 0,
        startupPowerW: load.startupPowerW,
        startupDurationS: load.startupDurationS,
        reasons: [`${load.id}: Load power is missing or invalid.`],
      });
      continue;
    }

    const loadSidePowerW = effectivePower;
    totalLoadSidePowerW += loadSidePowerW;

    const converted = convertBatterySidePower(
      load,
      loadSidePowerW,
      supplyType,
      batteryVoltageBasis,
    );
    if (converted.unresolved.length > 0) {
      unresolvedInputs.push(...converted.unresolved);
    }

    const batterySidePowerW = Number.isFinite(converted.powerW) ? converted.powerW : undefined;
    if (batterySidePowerW !== undefined) {
      totalBatterySidePowerW += batterySidePowerW;
    }

    let loadEnergyWh: number | undefined;
    let batteryEnergyWh: number | undefined;
    const energyRuntimeHours = load.runtimeHours ?? (hasExplicitEnergyData ? 1 : undefined);

    if (energyRuntimeHours === undefined) {
      if (activeLoads.length === 1 && !hasExplicitEnergyData) {
        unresolvedInputs.push(
          `${load.id}: runtimeHours are required to calculate energy demand for this load.`,
        );
      }
    } else {
      if (load.runtimeHours !== undefined && !finiteNonNegative(load.runtimeHours)) {
        unresolvedInputs.push(`${load.id}: runtimeHours must be finite and non-negative.`);
      } else {
        const dutyFactor = load.dutyCycle === undefined ? 1 : load.dutyCycle;
        if (load.dutyCycle !== undefined && !validDutyCycle(dutyFactor)) {
          unresolvedInputs.push(`${load.id}: dutyCycle must be between 0 and 1.`);
        } else {
          loadEnergyWh = loadSidePowerW * dutyFactor * energyRuntimeHours;
          totalLoadEnergyWh += loadEnergyWh;
          hasEnergyResolution = true;

          const batteryPowerForEnergy =
            batterySidePowerW ??
            loadSidePowerW * (supplyType === 'ac' ? 1 / (load.inverterEfficiency ?? 1) : 1);
          batteryEnergyWh = batteryPowerForEnergy * dutyFactor * energyRuntimeHours;
          totalBatteryEnergyWh += batteryEnergyWh;
        }
      }
    }

    if (load.startupPowerW !== undefined) {
      const startupPower = load.startupPowerW;
      const startupDurationS = load.startupDurationS;
      const startupConverted = convertBatterySidePower(
        load,
        startupPower,
        supplyType,
        batteryVoltageBasis,
      );
      const startupBatterySidePowerW = Number.isFinite(startupConverted.powerW)
        ? startupConverted.powerW
        : undefined;
      const startupCurrentA =
        batteryVoltageBasis !== undefined && startupBatterySidePowerW !== undefined
          ? startupBatterySidePowerW / batteryVoltageBasis
          : undefined;
      const resolved =
        startupDurationS !== undefined &&
        Number.isFinite(startupPower) &&
        startupBatterySidePowerW !== undefined;

      const contribution: LoadDemandSurgeContribution = {
        loadId: load.id,
        loadName: load.name,
        supplyType,
        powerW: startupBatterySidePowerW ?? startupPower,
        durationS: startupDurationS,
        currentA:
          startupCurrentA ??
          (batteryVoltageBasis !== undefined ? startupPower / batteryVoltageBasis : undefined),
        batterySidePowerW: startupBatterySidePowerW,
        resolved,
      };
      surgeContributions.push(contribution);

      if (startupDurationS === undefined) {
        unresolvedInputs.push(
          `${load.id}: startup duration is required for a time-qualified surge requirement.`,
        );
      } else if (!finiteNonNegative(startupDurationS)) {
        unresolvedInputs.push(`${load.id}: startup duration must be finite and non-negative.`);
      }
      if (startupConverted.unresolved.length > 0) {
        unresolvedInputs.push(...startupConverted.unresolved);
      }
    }

    contributingLoads.push({
      id: load.id,
      name: load.name,
      supplyType,
      active,
      loadSidePowerW,
      batterySidePowerW,
      loadEnergyWh,
      batteryEnergyWh,
      startupPowerW: load.startupPowerW,
      startupDurationS: load.startupDurationS,
      currentA: converted.currentA,
      voltageV: load.voltageV ?? batteryVoltageBasis ?? input.designVoltageV,
      reasons: unresolvedInputs.filter((reason) => reason.startsWith(`${load.id}:`)),
    });
  }

  const resolvedBatterySidePower = Number.isFinite(totalBatterySidePowerW)
    ? totalBatterySidePowerW
    : undefined;
  const continuousBatteryCurrentA =
    resolvedBatterySidePower !== undefined &&
    batteryVoltageBasis !== undefined &&
    batteryVoltageBasis > 0
      ? resolvedBatterySidePower / batteryVoltageBasis
      : undefined;

  if (continuousBatteryCurrentA === undefined && batteryVoltageBasis === undefined) {
    unresolvedInputs.push(
      'A batteryVoltageV or designVoltageV basis is required to derive continuous battery current.',
    );
  }

  let finalSurge: LoadDemandSurgeRequirement | undefined;
  if (surgeContributions.length > 1) {
    unresolvedInputs.push(
      'multiple active surge loads were supplied; aggregate startup demand is unresolved because simultaneous startup is not modeled.',
    );
  } else if (surgeContributions.length === 1) {
    const contribution = surgeContributions[0];
    if (contribution && contribution.resolved) {
      finalSurge = {
        powerW: contribution.powerW,
        durationS: contribution.durationS,
        currentA: contribution.currentA,
        batterySidePowerW: contribution.batterySidePowerW,
        resolved: true,
      };
    } else if (contribution && contribution.durationS === undefined) {
      unresolvedInputs.push(
        `${contribution.loadId}: startup duration is required for a time-qualified surge requirement.`,
      );
    }
  }

  const severity: EngineeringIssue['severity'] =
    unresolvedInputs.length > 0 ? 'CONDITIONAL' : 'PASS';

  return {
    severity,
    code: unresolvedInputs.length > 0 ? 'load_demand.unresolved_inputs' : 'load_demand.pass',
    message:
      unresolvedInputs.length > 0
        ? 'Load demand was resolved with unresolved assumptions.'
        : 'Load demand scenario is fully resolved.',
    scenarioId: input.scenarioId,
    totalLoadSidePowerW,
    totalBatterySidePowerW: resolvedBatterySidePower,
    totalLoadEnergyWh: hasEnergyResolution ? totalLoadEnergyWh : undefined,
    totalBatteryEnergyWh: hasEnergyResolution ? totalBatteryEnergyWh : undefined,
    continuousBatteryCurrentA,
    surgeRequirement: finalSurge,
    surgeContributions: surgeContributions.length > 0 ? surgeContributions : undefined,
    contributingLoads,
    unresolvedInputs,
    designVoltageV: input.designVoltageV,
    batteryVoltageV: input.batteryVoltageV,
    assumptions: input.assumptions ?? [],
  };
};

export const deriveBatteryRequirementsFromLoadDemand = (
  scenario: LoadDemandScenarioResult,
): BatteryBankRequirements => {
  const voltageBasis = scenario.batteryVoltageV ?? scenario.designVoltageV;

  return {
    ...(voltageBasis !== undefined && voltageBasis > 0 ? { nominalVoltageV: voltageBasis } : {}),
    ...(scenario.totalBatteryEnergyWh !== undefined
      ? { nominalEnergyWh: scenario.totalBatteryEnergyWh }
      : {}),
    ...(scenario.continuousBatteryCurrentA !== undefined
      ? { continuousDischargeCurrentA: scenario.continuousBatteryCurrentA }
      : {}),
    ...(scenario.surgeRequirement?.resolved &&
    scenario.surgeRequirement.currentA !== undefined &&
    scenario.surgeRequirement.durationS !== undefined
      ? {
          peakDischargeCurrentA: scenario.surgeRequirement.currentA,
          peakDischargeDurationS: scenario.surgeRequirement.durationS,
        }
      : {}),
  } as BatteryBankRequirements;
};
