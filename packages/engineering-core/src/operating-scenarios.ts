import type { LoadDemandScenarioInput, LoadDemandScenarioResult } from './load-demand.js';
import { evaluateLoadDemandScenario } from './load-demand.js';
import type { BatteryBankRequirements, EngineeringSeverity } from './battery-power.js';

export interface DimensionEnvelope<T = number> {
  readonly value?: T;
  readonly governingScenarioIds: readonly string[];
  readonly status: 'resolved' | 'unresolved';
  readonly unresolvedScenarioIds?: readonly string[];
}

export interface SurgeRequirementSpec {
  readonly currentA: number;
  readonly durationS: number;
  readonly powerW: number;
}

export interface SurgeEnvelope {
  readonly nonDominatedRequirements: readonly SurgeRequirementSpec[];
  readonly status: 'resolved' | 'unresolved';
  readonly unresolvedScenarioIds?: readonly string[];
}

export interface OperatingScenarioSetInput {
  readonly setId?: string;
  readonly scenarios: readonly LoadDemandScenarioInput[];
}

export interface OperatingScenarioSetResult {
  readonly setId?: string;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly continuousPowerEnvelope: DimensionEnvelope<number>;
  readonly continuousCurrentEnvelope: DimensionEnvelope<number>;
  readonly energyEnvelope: DimensionEnvelope<number>;
  readonly surgeEnvelope: SurgeEnvelope;
  readonly evaluatedScenarios: readonly LoadDemandScenarioResult[];
  readonly unresolvedDimensions: readonly string[];
}

const determineSurgeRequestDominance = (
  a: SurgeRequirementSpec,
  b: SurgeRequirementSpec,
): -1 | 0 | 1 => {
  const aDoesNotDominateB = a.currentA < b.currentA || a.durationS < b.durationS;
  const bDoesNotDominateA = b.currentA < a.currentA || b.durationS < a.durationS;

  if (!aDoesNotDominateB && bDoesNotDominateA) return -1;
  if (!bDoesNotDominateA && aDoesNotDominateB) return 1;
  return 0;
};

const filterNonDominatedSurge = (
  requirements: readonly SurgeRequirementSpec[],
): readonly SurgeRequirementSpec[] => {
  if (requirements.length <= 1) return requirements;

  const nonDominated: SurgeRequirementSpec[] = [];
  for (const candidate of requirements) {
    let isDominated = false;
    for (const other of requirements) {
      if (candidate === other) continue;
      if (determineSurgeRequestDominance(other, candidate) === -1) {
        isDominated = true;
        break;
      }
    }
    if (!isDominated) {
      nonDominated.push(candidate);
    }
  }
  return nonDominated;
};

export const evaluateOperatingScenarioSet = (
  input: OperatingScenarioSetInput,
): OperatingScenarioSetResult => {
  const scenarios = input.scenarios ?? [];
  const evaluatedScenarios: LoadDemandScenarioResult[] = [];
  const unresolvedDimensions: string[] = [];

  if (scenarios.length === 0) {
    return {
      setId: input.setId,
      severity: 'CONDITIONAL',
      code: 'operating_scenarios.empty_set',
      message: 'No scenarios were supplied to the set.',
      continuousPowerEnvelope: {
        governingScenarioIds: [],
        status: 'unresolved',
      },
      continuousCurrentEnvelope: {
        governingScenarioIds: [],
        status: 'unresolved',
      },
      energyEnvelope: {
        governingScenarioIds: [],
        status: 'unresolved',
      },
      surgeEnvelope: {
        nonDominatedRequirements: [],
        status: 'unresolved',
      },
      evaluatedScenarios: [],
      unresolvedDimensions: ['continuousPower', 'continuousCurrent', 'energy', 'surge'],
    };
  }

  for (const scenario of scenarios) {
    evaluatedScenarios.push(evaluateLoadDemandScenario(scenario));
  }

  let maxResolvePowerW: number | undefined;
  const powerGovernors: string[] = [];
  const powerUnresolved: string[] = [];

  for (const result of evaluatedScenarios) {
    if (result.totalBatterySidePowerW !== undefined) {
      if (maxResolvePowerW === undefined || result.totalBatterySidePowerW > maxResolvePowerW) {
        maxResolvePowerW = result.totalBatterySidePowerW;
        powerGovernors.length = 0;
      }
      if (result.totalBatterySidePowerW === maxResolvePowerW && result.scenarioId) {
        powerGovernors.push(result.scenarioId);
      }
    } else if (result.scenarioId) {
      powerUnresolved.push(result.scenarioId);
    }
  }

  const continuousPowerEnvelope: DimensionEnvelope<number> =
    maxResolvePowerW !== undefined
      ? {
          value: maxResolvePowerW,
          governingScenarioIds: powerGovernors,
          status: powerUnresolved.length > 0 ? 'unresolved' : 'resolved',
          ...(powerUnresolved.length > 0 && {
            unresolvedScenarioIds: powerUnresolved,
          }),
        }
      : {
          governingScenarioIds: [],
          status: 'unresolved',
          unresolvedScenarioIds: evaluatedScenarios
            .map((s) => s.scenarioId)
            .filter((id) => id !== undefined) as string[],
        };

  if (continuousPowerEnvelope.status === 'unresolved') {
    unresolvedDimensions.push('continuousPower');
  }

  const allVoltageBases = new Set<number>();

  for (const result of evaluatedScenarios) {
    const basis = result.batteryVoltageV ?? result.designVoltageV;
    if (basis !== undefined) {
      allVoltageBases.add(basis);
    }
  }

  const voltageConflict = allVoltageBases.size > 1;

  let maxResolveCurrentA: number | undefined;
  const currentGovernors: string[] = [];
  const currentUnresolved: string[] = [];

  if (!voltageConflict) {
    for (const result of evaluatedScenarios) {
      if (result.continuousBatteryCurrentA !== undefined) {
        if (
          maxResolveCurrentA === undefined ||
          result.continuousBatteryCurrentA > maxResolveCurrentA
        ) {
          maxResolveCurrentA = result.continuousBatteryCurrentA;
          currentGovernors.length = 0;
        }
        if (result.continuousBatteryCurrentA === maxResolveCurrentA && result.scenarioId) {
          currentGovernors.push(result.scenarioId);
        }
      } else if (result.scenarioId) {
        currentUnresolved.push(result.scenarioId);
      }
    }
  } else {
    for (const result of evaluatedScenarios) {
      if (result.scenarioId) {
        currentUnresolved.push(result.scenarioId);
      }
    }
  }

  const continuousCurrentEnvelope: DimensionEnvelope<number> =
    !voltageConflict && maxResolveCurrentA !== undefined
      ? {
          value: maxResolveCurrentA,
          governingScenarioIds: currentGovernors,
          status: currentUnresolved.length > 0 ? 'unresolved' : 'resolved',
          ...(currentUnresolved.length > 0 && {
            unresolvedScenarioIds: currentUnresolved,
          }),
        }
      : {
          governingScenarioIds: [],
          status: 'unresolved',
          unresolvedScenarioIds: evaluatedScenarios
            .map((s) => s.scenarioId)
            .filter((id) => id !== undefined) as string[],
        };

  if (continuousCurrentEnvelope.status === 'unresolved') {
    unresolvedDimensions.push('continuousCurrent');
  }

  let maxResolveEnergyWh: number | undefined;
  const energyGovernors: string[] = [];
  const energyUnresolved: string[] = [];

  for (const result of evaluatedScenarios) {
    if (result.totalBatteryEnergyWh !== undefined) {
      if (maxResolveEnergyWh === undefined || result.totalBatteryEnergyWh > maxResolveEnergyWh) {
        maxResolveEnergyWh = result.totalBatteryEnergyWh;
        energyGovernors.length = 0;
      }
      if (result.totalBatteryEnergyWh === maxResolveEnergyWh && result.scenarioId) {
        energyGovernors.push(result.scenarioId);
      }
    } else if (result.scenarioId) {
      energyUnresolved.push(result.scenarioId);
    }
  }

  const energyEnvelope: DimensionEnvelope<number> =
    maxResolveEnergyWh !== undefined
      ? {
          value: maxResolveEnergyWh,
          governingScenarioIds: energyGovernors,
          status: energyUnresolved.length > 0 ? 'unresolved' : 'resolved',
          ...(energyUnresolved.length > 0 && {
            unresolvedScenarioIds: energyUnresolved,
          }),
        }
      : {
          governingScenarioIds: [],
          status: 'unresolved',
          unresolvedScenarioIds: evaluatedScenarios
            .map((s) => s.scenarioId)
            .filter((id) => id !== undefined) as string[],
        };

  if (energyEnvelope.status === 'unresolved') {
    unresolvedDimensions.push('energy');
  }

  const surgeRequirements: Array<{
    spec: SurgeRequirementSpec;
    scenarioId: string | undefined;
  }> = [];
  const surgeUnresolved: string[] = [];

  for (const result of evaluatedScenarios) {
    if (result.surgeRequirement?.resolved) {
      const surge = result.surgeRequirement;
      if (
        surge.currentA !== undefined &&
        surge.durationS !== undefined &&
        surge.powerW !== undefined
      ) {
        surgeRequirements.push({
          spec: {
            currentA: surge.currentA,
            durationS: surge.durationS,
            powerW: surge.powerW,
          },
          scenarioId: result.scenarioId,
        });
      }
    } else if (
      result.surgeRequirement === undefined &&
      (result.surgeContributions?.length ?? 0) > 0 &&
      result.scenarioId
    ) {
      surgeUnresolved.push(result.scenarioId);
    } else if (
      result.surgeRequirement !== undefined &&
      result.scenarioId &&
      !result.surgeRequirement.resolved
    ) {
      surgeUnresolved.push(result.scenarioId);
    }
  }

  const nonDominatedSpecs = filterNonDominatedSurge(surgeRequirements.map((r) => r.spec));

  const surgeEnvelope: SurgeEnvelope =
    surgeRequirements.length > 0 || surgeUnresolved.length > 0
      ? {
          nonDominatedRequirements: nonDominatedSpecs,
          status: surgeUnresolved.length > 0 ? 'unresolved' : 'resolved',
          ...(surgeUnresolved.length > 0 && {
            unresolvedScenarioIds: surgeUnresolved,
          }),
        }
      : {
          nonDominatedRequirements: [],
          status: 'resolved',
        };

  if (surgeEnvelope.status === 'unresolved') {
    unresolvedDimensions.push('surge');
  }

  const overallSeverity: EngineeringSeverity =
    unresolvedDimensions.length > 0 ? 'CONDITIONAL' : 'PASS';

  return {
    setId: input.setId,
    severity: overallSeverity,
    code:
      unresolvedDimensions.length > 0
        ? 'operating_scenarios.unresolved_dimensions'
        : 'operating_scenarios.pass',
    message:
      unresolvedDimensions.length > 0
        ? `Operating scenario set evaluated with unresolved dimensions: ${unresolvedDimensions.join(', ')}`
        : 'Operating scenario set is fully resolved.',
    continuousPowerEnvelope,
    continuousCurrentEnvelope,
    energyEnvelope,
    surgeEnvelope,
    evaluatedScenarios,
    unresolvedDimensions,
  };
};

export const deriveBatteryRequirementsFromOperatingScenarios = (
  scenarioSet: OperatingScenarioSetResult,
): BatteryBankRequirements => {
  const voltageBasis = scenarioSet.continuousCurrentEnvelope.value
    ? Array.from(
        new Set(
          scenarioSet.evaluatedScenarios
            .map((s) => s.batteryVoltageV ?? s.designVoltageV)
            .filter((v) => v !== undefined),
        ),
      )[0]
    : undefined;

  const continuousCurrentFromPower =
    scenarioSet.continuousPowerEnvelope.value !== undefined
      ? scenarioSet.continuousPowerEnvelope.value / (voltageBasis ?? 1)
      : undefined;

  return {
    ...(voltageBasis !== undefined && voltageBasis > 0 ? { nominalVoltageV: voltageBasis } : {}),
    ...(scenarioSet.energyEnvelope.status === 'resolved' &&
    scenarioSet.energyEnvelope.value !== undefined
      ? { nominalEnergyWh: scenarioSet.energyEnvelope.value }
      : {}),
    ...(continuousCurrentFromPower !== undefined
      ? { continuousDischargeCurrentA: continuousCurrentFromPower }
      : scenarioSet.continuousCurrentEnvelope.value !== undefined
        ? { continuousDischargeCurrentA: scenarioSet.continuousCurrentEnvelope.value }
        : {}),
    ...(scenarioSet.surgeEnvelope.status === 'resolved' &&
    scenarioSet.surgeEnvelope.nonDominatedRequirements.length > 0
      ? (() => {
          const primarySurge = scenarioSet.surgeEnvelope.nonDominatedRequirements[0];
          return primarySurge
            ? {
                peakDischargeCurrentA: primarySurge.currentA,
                peakDischargeDurationS: primarySurge.durationS,
              }
            : {};
        })()
      : {}),
  };
};
