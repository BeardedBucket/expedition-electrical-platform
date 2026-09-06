import {
  deriveBatteryBank,
  type BatteryEngineeringInput,
  type BatteryTopology,
  type EngineeringSeverity,
} from './battery-power.js';
import type { ChargingSourceCapability, ChargingSourceScenarioResult } from './charging-sources.js';

export interface BatteryChargeAcceptanceInput {
  readonly battery: BatteryEngineeringInput;
  readonly selectedTopology: BatteryTopology;
  readonly chargingScenario: ChargingSourceScenarioResult;
}

export type BatteryChargeAcceptanceLimitingBasis =
  'source' | 'battery.maximum_continuous' | 'battery.protection_limit' | 'unresolved';

export interface BatteryChargeAcceptanceResult {
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly batteryId?: string;
  readonly sourceScenarioId?: string;
  readonly selectedTopology: BatteryTopology;
  readonly sourceAvailableCapability: ChargingSourceCapability;
  readonly sourceAvailableA?: number;
  readonly sourceAvailablePowerW?: number;
  readonly bankRecommendedChargeA?: number;
  readonly bankMaximumContinuousChargeA?: number;
  readonly bankProtectionLimitA?: number;
  readonly usableContinuousChargeA?: number;
  readonly hardAcceptanceResolved: boolean;
  readonly guidanceExceeded: boolean;
  readonly limitingBasis: BatteryChargeAcceptanceLimitingBasis;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
}

const validNonNegative = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

const result = (
  input: BatteryChargeAcceptanceInput,
  values: Omit<
    BatteryChargeAcceptanceResult,
    'batteryId' | 'sourceScenarioId' | 'selectedTopology' | 'sourceAvailableCapability'
  >,
): BatteryChargeAcceptanceResult => ({
  batteryId: input.battery.id,
  sourceScenarioId: input.chargingScenario.scenarioId,
  selectedTopology: input.selectedTopology,
  sourceAvailableCapability: input.chargingScenario.availableCapability,
  ...values,
});

export const evaluateBatteryChargeAcceptance = (
  input: BatteryChargeAcceptanceInput,
): BatteryChargeAcceptanceResult => {
  const bank = deriveBatteryBank(input.battery, input.selectedTopology);
  if (!bank.ok) {
    const severity: EngineeringSeverity = bank.code === 'invalid_input' ? 'FAIL' : 'CONDITIONAL';
    return result(input, {
      severity,
      code: 'battery.charge_acceptance.topology_unresolved',
      message: bank.reasons[0] ?? 'Selected battery topology cannot be evaluated.',
      unresolvedFacts: bank.reasons,
      issues: bank.reasons,
      hardAcceptanceResolved: false,
      guidanceExceeded: false,
      limitingBasis: 'unresolved',
    });
  }

  const semantics = input.battery.chargeCurrent;
  const invalidSemantics =
    semantics !== undefined &&
    [semantics.recommendedA, semantics.maximumContinuousA, semantics.protectionLimitA].some(
      (value) => value !== undefined && !validNonNegative(value),
    );
  if (invalidSemantics) {
    const issue = 'Battery charge-current semantics contain an invalid value.';
    return result(input, {
      severity: 'FAIL',
      code: 'battery.charge_acceptance.invalid_battery_semantics',
      message: issue,
      unresolvedFacts: [],
      issues: [issue],
      hardAcceptanceResolved: false,
      guidanceExceeded: false,
      limitingBasis: 'unresolved',
    });
  }

  const parallelCount = input.selectedTopology.parallelCount;
  const bankRecommendedChargeA =
    semantics?.recommendedA === undefined ? undefined : semantics.recommendedA * parallelCount;
  const bankMaximumContinuousChargeA =
    semantics?.maximumContinuousA === undefined
      ? undefined
      : semantics.maximumContinuousA * parallelCount;
  const bankProtectionLimitA =
    semantics?.protectionLimitA === undefined
      ? undefined
      : semantics.protectionLimitA * parallelCount;

  const scenario = input.chargingScenario;
  const sourceVoltageV = scenario.batteryVoltageV ?? scenario.designVoltageV;
  const issues: string[] = [];
  const unresolvedFacts: string[] = [];
  let sourceAvailableA = scenario.availableCapability.currentA;
  const sourceAvailablePowerW = scenario.availableCapability.powerW;

  if (sourceAvailableA === undefined && sourceAvailablePowerW !== undefined) {
    if (sourceVoltageV !== undefined && validNonNegative(sourceVoltageV) && sourceVoltageV > 0) {
      sourceAvailableA = sourceAvailablePowerW / sourceVoltageV;
    } else {
      unresolvedFacts.push(
        'An explicit source voltage basis is required to derive current from power.',
      );
    }
  }

  if (sourceVoltageV === undefined) {
    unresolvedFacts.push(
      'An explicit source voltage basis is required for charge-current coordination.',
    );
  } else if (sourceVoltageV !== bank.value.nominalVoltageV) {
    const issue = `Charging source voltage basis ${sourceVoltageV}V does not match selected bank voltage ${bank.value.nominalVoltageV}V.`;
    return result(input, {
      severity: 'FAIL',
      code: 'battery.charge_acceptance.voltage_incompatible',
      message: issue,
      ...(bankRecommendedChargeA === undefined ? {} : { bankRecommendedChargeA }),
      ...(bankMaximumContinuousChargeA === undefined ? {} : { bankMaximumContinuousChargeA }),
      ...(bankProtectionLimitA === undefined ? {} : { bankProtectionLimitA }),
      unresolvedFacts: [],
      issues: [issue],
      hardAcceptanceResolved: false,
      guidanceExceeded: false,
      limitingBasis: 'unresolved',
    });
  }

  if (sourceAvailableA === undefined) {
    unresolvedFacts.push(
      'Resolved source available current is required for charge acceptance coordination.',
    );
  }
  if (bankRecommendedChargeA === undefined && bankMaximumContinuousChargeA === undefined) {
    unresolvedFacts.push(
      'A battery recommended or maximum continuous charge acceptance fact is required.',
    );
  }
  if (scenario.severity === 'FAIL') {
    issues.push('The charging-source scenario failed and cannot be treated as usable input.');
  }
  if (!scenario.availableCapability.totalResolved) {
    unresolvedFacts.push('The charging-source scenario does not prove total available capability.');
  }

  const guidanceExceeded =
    sourceAvailableA !== undefined &&
    bankRecommendedChargeA !== undefined &&
    sourceAvailableA > bankRecommendedChargeA;
  if (guidanceExceeded) {
    issues.push('Source capability exceeds the battery manufacturer recommended charge target.');
  }

  const exceedsProtection =
    sourceAvailableA !== undefined &&
    bankProtectionLimitA !== undefined &&
    sourceAvailableA > bankProtectionLimitA;
  const exceedsMaximum =
    sourceAvailableA !== undefined &&
    bankMaximumContinuousChargeA !== undefined &&
    sourceAvailableA > bankMaximumContinuousChargeA;
  const usableContinuousChargeA =
    sourceAvailableA === undefined || bankMaximumContinuousChargeA === undefined
      ? sourceAvailableA !== undefined && bankRecommendedChargeA !== undefined && !guidanceExceeded
        ? sourceAvailableA
        : undefined
      : Math.min(sourceAvailableA, bankMaximumContinuousChargeA);

  if (exceedsProtection) {
    const issue = 'Source capability exceeds the battery protection limit.';
    issues.push(issue);
  }
  if (exceedsMaximum) {
    issues.push('Source capability exceeds the battery maximum continuous charge acceptance.');
  }

  let severity: EngineeringSeverity;
  let code: string;
  let message: string;
  let limitingBasis: BatteryChargeAcceptanceLimitingBasis;
  if (scenario.severity === 'FAIL' || exceedsProtection || exceedsMaximum) {
    severity = 'FAIL';
    code =
      scenario.severity === 'FAIL'
        ? 'battery.charge_acceptance.source_scenario_failed'
        : exceedsProtection
          ? 'battery.charge_acceptance.protection_limit_exceeded'
          : 'battery.charge_acceptance.maximum_continuous_exceeded';
    message = issues[issues.length - 1] ?? 'Charge acceptance coordination failed.';
    limitingBasis = exceedsMaximum
      ? 'battery.maximum_continuous'
      : exceedsProtection
        ? 'battery.protection_limit'
        : 'unresolved';
  } else if (
    unresolvedFacts.length > 0 ||
    (guidanceExceeded && bankMaximumContinuousChargeA === undefined)
  ) {
    severity = 'CONDITIONAL';
    code = 'battery.charge_acceptance.unresolved';
    message =
      'Charge acceptance coordination retains known facts but has unresolved capability or acceptance facts.';
    limitingBasis = 'unresolved';
  } else if (guidanceExceeded) {
    severity = 'WARNING';
    code = 'battery.charge_acceptance.recommended_exceeded';
    message =
      'Source capability exceeds the recommended charge target but remains below the known continuous limit.';
    limitingBasis = 'source';
  } else {
    severity = 'PASS';
    code = 'battery.charge_acceptance.pass';
    message =
      'Source capability is coordinated against the selected battery charge acceptance semantics.';
    limitingBasis = 'source';
  }

  const hardAcceptanceResolved =
    bankMaximumContinuousChargeA !== undefined &&
    sourceAvailableA !== undefined &&
    scenario.availableCapability.totalResolved &&
    unresolvedFacts.length === 0;
  return result(input, {
    severity,
    code,
    message,
    sourceAvailableA,
    sourceAvailablePowerW,
    bankRecommendedChargeA,
    bankMaximumContinuousChargeA,
    bankProtectionLimitA,
    usableContinuousChargeA,
    hardAcceptanceResolved,
    guidanceExceeded,
    limitingBasis,
    unresolvedFacts,
    issues,
  });
};
