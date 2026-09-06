import type { EngineeringSeverity } from './battery-power.js';

export type ChargingSourceType =
  'shore_charger' | 'alternator_dc_dc' | 'solar_charge_controller' | 'generator_charger' | 'other';

export type ChargingSourceAvailability = 'available' | 'unavailable' | 'unresolved';
export type ChargingSourcePowerBasis = 'battery-output' | 'input';

export interface ChargingSourceInput {
  readonly id: string;
  readonly name?: string;
  readonly sourceType: ChargingSourceType;
  readonly active?: boolean;
  readonly availability?: ChargingSourceAvailability;
  readonly installedCurrentA?: number;
  readonly configuredCurrentLimitA?: number;
  readonly availableCurrentA?: number;
  readonly installedPowerW?: number;
  readonly configuredPowerLimitW?: number;
  readonly availablePowerW?: number;
  readonly voltageV?: number;
  readonly powerBasis?: ChargingSourcePowerBasis;
  readonly efficiency?: number;
  readonly sourceGroupId?: string;
}

export interface ChargingSourceScenarioInput {
  readonly scenarioId?: string;
  readonly batteryVoltageV?: number;
  readonly designVoltageV?: number;
  readonly sources: readonly ChargingSourceInput[];
}

export interface ChargingSourceCapability {
  readonly currentA?: number;
  readonly powerW?: number;
  readonly totalResolved: boolean;
  readonly sourceIds: readonly string[];
}

export interface ChargingSourceContribution {
  readonly sourceId: string;
  readonly name?: string;
  readonly sourceType: ChargingSourceType;
  readonly installedCurrentA?: number;
  readonly installedPowerW?: number;
  readonly configuredCurrentLimitA?: number;
  readonly configuredPowerLimitW?: number;
  readonly availableCurrentA?: number;
  readonly availablePowerW?: number;
  readonly reason?: string;
}

export interface ChargingSourceIssue extends ChargingSourceContribution {
  readonly reason: string;
}

export interface ChargingSourceScenarioResult {
  readonly scenarioId?: string;
  readonly batteryVoltageV?: number;
  readonly designVoltageV?: number;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly installedCapability: ChargingSourceCapability;
  readonly activeConfiguredCapability: ChargingSourceCapability;
  readonly availableCapability: ChargingSourceCapability;
  readonly contributingSources: readonly ChargingSourceContribution[];
  readonly inactiveSources: readonly ChargingSourceIssue[];
  readonly unresolvedSources: readonly ChargingSourceIssue[];
  readonly invalidSources: readonly ChargingSourceIssue[];
  readonly issues: readonly string[];
}

const finiteNonNegative = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;
const finitePositive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

const voltageBasis = (input: ChargingSourceScenarioInput, source: ChargingSourceInput) =>
  source.voltageV ?? input.batteryVoltageV ?? input.designVoltageV;

const contribution = (
  source: ChargingSourceInput,
  values: Partial<ChargingSourceContribution> = {},
): ChargingSourceContribution => ({
  sourceId: source.id,
  name: source.name,
  sourceType: source.sourceType,
  installedCurrentA: source.installedCurrentA,
  installedPowerW: source.installedPowerW,
  configuredCurrentLimitA: source.configuredCurrentLimitA,
  configuredPowerLimitW: source.configuredPowerLimitW,
  ...values,
});

const invalidConfiguration = (
  source: ChargingSourceInput,
  reason: string,
): ChargingSourceIssue => ({ ...contribution(source), reason });

const convertPower = (
  source: ChargingSourceInput,
  powerW: number,
): { powerW?: number; reason?: string } => {
  const basis = source.powerBasis ?? 'battery-output';
  if (basis === 'battery-output') return { powerW };
  if (!finitePositive(source.efficiency) || source.efficiency > 1) {
    return { reason: `${source.id}: input-side power requires explicit efficiency in (0,1].` };
  }
  return { powerW: powerW * source.efficiency };
};

const resolveNameplate = (
  input: ChargingSourceScenarioInput,
  source: ChargingSourceInput,
): { currentA?: number; powerW?: number; reason?: string } => {
  const basis = voltageBasis(input, source);
  if (!finiteNonNegative(source.installedCurrentA) && !finiteNonNegative(source.installedPowerW)) {
    return { reason: `${source.id}: installed current or power capability is required.` };
  }
  let powerW = source.installedPowerW;
  if (powerW !== undefined) {
    const converted = convertPower(source, powerW);
    if (converted.reason) return converted;
    powerW = converted.powerW;
  }
  let currentA = source.installedCurrentA;
  if (currentA === undefined && powerW !== undefined) {
    if (!finitePositive(basis)) {
      return { powerW };
    }
    currentA = powerW / basis;
  }
  if (currentA !== undefined && powerW === undefined && finitePositive(basis)) {
    powerW = currentA * basis;
  }
  return { currentA, powerW };
};

const resolveConfigured = (
  input: ChargingSourceScenarioInput,
  source: ChargingSourceInput,
  nameplate: { currentA?: number; powerW?: number },
): { currentA?: number; powerW?: number; reason?: string } => {
  if (
    source.configuredCurrentLimitA !== undefined &&
    (!finiteNonNegative(source.configuredCurrentLimitA) ||
      (nameplate.currentA !== undefined && source.configuredCurrentLimitA > nameplate.currentA))
  ) {
    return {
      reason: `${source.id}: configured current limit exceeds installed capability or is invalid.`,
    };
  }
  if (
    source.configuredPowerLimitW !== undefined &&
    (!finiteNonNegative(source.configuredPowerLimitW) ||
      (nameplate.powerW !== undefined && source.configuredPowerLimitW > nameplate.powerW))
  ) {
    return {
      reason: `${source.id}: configured power limit exceeds installed capability or is invalid.`,
    };
  }
  const currentA =
    nameplate.currentA === undefined
      ? undefined
      : Math.min(nameplate.currentA, source.configuredCurrentLimitA ?? Number.POSITIVE_INFINITY);
  const powerW =
    nameplate.powerW === undefined
      ? undefined
      : Math.min(nameplate.powerW, source.configuredPowerLimitW ?? Number.POSITIVE_INFINITY);
  return { currentA, powerW };
};

export const evaluateChargingSourceScenario = (
  input: ChargingSourceScenarioInput,
): ChargingSourceScenarioResult => {
  const sources = input.sources ?? [];
  const issues: string[] = [];
  const inactiveSources: ChargingSourceIssue[] = [];
  const unresolvedSources: ChargingSourceIssue[] = [];
  const invalidSources: ChargingSourceIssue[] = [];
  const contributingSources: ChargingSourceContribution[] = [];
  const installedCurrentValues: number[] = [];
  const installedPowerValues: number[] = [];
  const activeCurrentValues: number[] = [];
  const activePowerValues: number[] = [];
  const availableCurrentValues: number[] = [];
  const availablePowerValues: number[] = [];
  const activeIds = new Set(
    sources.filter((source) => source.active ?? false).map((source) => source.id),
  );

  const excludedIds = new Set<string>();
  const groups = new Map<string, string[]>();
  for (const source of sources) {
    if (source.sourceGroupId && activeIds.has(source.id)) {
      groups.set(source.sourceGroupId, [...(groups.get(source.sourceGroupId) ?? []), source.id]);
    }
  }
  for (const [group, ids] of groups) {
    if (ids.length > 1) {
      const reason = `Sources in mutually exclusive group '${group}' are active together.`;
      for (const id of ids) {
        const source = sources.find((candidate) => candidate.id === id);
        if (source) {
          invalidSources.push(invalidConfiguration(source, `${source.id}: ${reason}`));
          excludedIds.add(id);
        }
      }
      issues.push(reason);
    }
  }

  for (const source of sources) {
    const nameplate = resolveNameplate(input, source);
    if (nameplate.currentA !== undefined) installedCurrentValues.push(nameplate.currentA);
    if (nameplate.powerW !== undefined) installedPowerValues.push(nameplate.powerW);
    if (nameplate.reason) {
      const issue = { ...contribution(source), reason: nameplate.reason };
      if (nameplate.reason.includes('installed current or power capability')) {
        invalidSources.push(issue);
      } else {
        unresolvedSources.push(issue);
      }
      issues.push(nameplate.reason);
      continue;
    }
    const configured = resolveConfigured(input, source, nameplate);
    if (configured.reason) {
      const issue = invalidConfiguration(source, configured.reason);
      invalidSources.push(issue);
      issues.push(configured.reason);
      continue;
    }
    if (!(source.active ?? false)) {
      inactiveSources.push({
        ...contribution(source, {
          availableCurrentA: 0,
          availablePowerW: 0,
        }),
        reason: `${source.id}: source is inactive in this scenario.`,
      });
      continue;
    }
    if (excludedIds.has(source.id)) continue;
    if (source.availability === 'unavailable') {
      inactiveSources.push({
        ...contribution(source, { availableCurrentA: 0, availablePowerW: 0 }),
        reason: `${source.id}: source is unavailable in this scenario.`,
      });
      continue;
    }
    if (source.availability === 'unresolved' || source.availability === undefined) {
      unresolvedSources.push({
        ...contribution(source, {
          availableCurrentA: configured.currentA,
          availablePowerW: configured.powerW,
        }),
        reason: `${source.id}: source availability is unresolved or was not supplied.`,
      });
      if (configured.currentA !== undefined) activeCurrentValues.push(configured.currentA);
      if (configured.powerW !== undefined) activePowerValues.push(configured.powerW);
      continue;
    }
    if (configured.currentA !== undefined) activeCurrentValues.push(configured.currentA);
    if (configured.powerW !== undefined) activePowerValues.push(configured.powerW);
    if (configured.powerW !== undefined && configured.currentA === undefined) {
      unresolvedSources.push({
        ...contribution(source, { availablePowerW: configured.powerW }),
        reason: `${source.id}: explicit battery/design voltage is required to derive current.`,
      });
    }

    const availablePower = source.availablePowerW ?? configured.powerW;
    const availableCurrent = source.availableCurrentA ?? configured.currentA;
    if (
      (availableCurrent !== undefined &&
        configured.currentA !== undefined &&
        (!finiteNonNegative(availableCurrent) || availableCurrent > configured.currentA)) ||
      (availablePower !== undefined &&
        configured.powerW !== undefined &&
        (!finiteNonNegative(availablePower) || availablePower > configured.powerW))
    ) {
      const reason = `${source.id}: scenario availability exceeds configured or installed capability.`;
      invalidSources.push(invalidConfiguration(source, reason));
      issues.push(reason);
      continue;
    }
    let resolvedPower = availablePower;
    if (source.availablePowerW !== undefined) {
      const converted = convertPower(source, source.availablePowerW);
      if (converted.reason) {
        unresolvedSources.push({ ...contribution(source), reason: converted.reason });
        issues.push(converted.reason);
        continue;
      }
      resolvedPower = converted.powerW;
    }
    const resolvedCurrent =
      availableCurrent ??
      (resolvedPower !== undefined && finitePositive(voltageBasis(input, source))
        ? resolvedPower / voltageBasis(input, source)!
        : undefined);
    contributingSources.push(
      contribution(source, {
        availableCurrentA: resolvedCurrent,
        availablePowerW: resolvedPower,
      }),
    );
    if (resolvedCurrent !== undefined) availableCurrentValues.push(resolvedCurrent);
    if (resolvedPower !== undefined) availablePowerValues.push(resolvedPower);
  }

  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  const unresolvedCurrent =
    unresolvedSources.some(
      (source) => source.availableCurrentA !== undefined || source.installedCurrentA !== undefined,
    ) ||
    sources.some(
      (source) =>
        (source.active ?? false) && resolveNameplate(input, source).currentA === undefined,
    );
  const unresolvedPower =
    unresolvedSources.some(
      (source) => source.availablePowerW !== undefined || source.installedPowerW !== undefined,
    ) ||
    sources.some(
      (source) => (source.active ?? false) && resolveNameplate(input, source).powerW === undefined,
    );
  const availableCapability: ChargingSourceCapability = {
    ...(availableCurrentValues.length > 0
      ? { currentA: sum(availableCurrentValues) }
      : unresolvedCurrent
        ? {}
        : { currentA: 0 }),
    ...(availablePowerValues.length > 0 ? { powerW: sum(availablePowerValues) } : { powerW: 0 }),
    totalResolved: !unresolvedCurrent && !unresolvedPower && invalidSources.length === 0,
    sourceIds: contributingSources.map((source) => source.sourceId),
  };
  const severity: EngineeringSeverity =
    invalidSources.length > 0
      ? 'FAIL'
      : sources.length === 0 || unresolvedSources.length > 0 || unresolvedCurrent || unresolvedPower
        ? 'CONDITIONAL'
        : 'PASS';

  return {
    scenarioId: input.scenarioId,
    batteryVoltageV: input.batteryVoltageV,
    designVoltageV: input.designVoltageV,
    severity,
    code:
      severity === 'FAIL'
        ? 'charging_sources.invalid_configuration'
        : severity === 'CONDITIONAL'
          ? 'charging_sources.unresolved_availability'
          : 'charging_sources.pass',
    message:
      severity === 'FAIL'
        ? 'Charging source scenario contains invalid configuration.'
        : severity === 'CONDITIONAL'
          ? 'Charging source scenario contains unresolved capability or availability.'
          : 'Charging source scenario is fully resolved.',
    installedCapability: {
      currentA: sum(installedCurrentValues),
      powerW: sum(installedPowerValues),
      totalResolved: invalidSources.length === 0,
      sourceIds: sources.map((source) => source.id),
    },
    activeConfiguredCapability: {
      currentA: sum(activeCurrentValues),
      powerW: sum(activePowerValues),
      totalResolved: invalidSources.length === 0,
      sourceIds: sources
        .filter((source) => (source.active ?? false) && !excludedIds.has(source.id))
        .map((source) => source.id),
    },
    availableCapability,
    contributingSources,
    inactiveSources,
    unresolvedSources,
    invalidSources,
    issues,
  };
};
