import type { BatteryChargeAcceptanceResult } from './battery-charge-acceptance.js';
import type { LoadDemandScenarioResult } from './load-demand.js';
import type { BatteryTopology, EngineeringSeverity } from './battery-power.js';

export interface OperatingPowerBalanceInput {
  readonly operatingCaseId?: string;
  readonly demandScenario: LoadDemandScenarioResult;
  readonly chargeAcceptance: BatteryChargeAcceptanceResult;
}

export type OperatingPowerBalanceState = 'charging' | 'discharging' | 'balanced';

export interface OperatingPowerBalanceResult {
  readonly operatingCaseId?: string;
  readonly demandScenarioId?: string;
  readonly sourceScenarioId?: string;
  readonly batteryId?: string;
  readonly selectedTopology: BatteryTopology;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly demandBatteryPowerW?: number;
  readonly acceptedChargingPowerW?: number;
  readonly netBatteryPowerW?: number;
  readonly chargingSurplusW?: number;
  readonly dischargeDeficitW?: number;
  readonly balanceState?: OperatingPowerBalanceState;
  readonly demandCurrentA?: number;
  readonly acceptedChargeCurrentA?: number;
  readonly netBatteryCurrentA?: number;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
  readonly provenance: {
    readonly demandSeverity: EngineeringSeverity;
    readonly chargeAcceptanceSeverity: EngineeringSeverity;
    readonly selectedBankVoltageV?: number;
    readonly sourceAvailablePowerW?: number;
    readonly sourceAvailableCapability: BatteryChargeAcceptanceResult['sourceAvailableCapability'];
    readonly demandBatteryPowerW?: number;
    readonly acceptedChargingPowerW?: number;
  };
}

const validPower = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

export const evaluateOperatingPowerBalance = (
  input: OperatingPowerBalanceInput,
): OperatingPowerBalanceResult => {
  const demand = input.demandScenario;
  const acceptance = input.chargeAcceptance;
  const unresolvedFacts: string[] = [];
  const issues = [...demand.unresolvedInputs, ...acceptance.issues];
  const demandPower = demand.totalBatterySidePowerW;
  let acceptedPower = acceptance.usableContinuousChargePowerW;

  if (
    acceptedPower === undefined &&
    acceptance.usableContinuousChargeA !== undefined &&
    acceptance.selectedBankVoltageV !== undefined
  ) {
    if (!Number.isFinite(acceptance.selectedBankVoltageV) || acceptance.selectedBankVoltageV <= 0) {
      unresolvedFacts.push(
        'Selected bank voltage must be finite and positive for charge-power conversion.',
      );
    } else {
      acceptedPower = acceptance.usableContinuousChargeA * acceptance.selectedBankVoltageV;
    }
  }

  if (demandPower !== undefined && !validPower(demandPower)) {
    issues.push('Evaluated demand contains invalid battery-side power.');
  }
  if (acceptedPower !== undefined && !validPower(acceptedPower)) {
    issues.push('Charge acceptance contains invalid accepted charging power.');
    acceptedPower = undefined;
  }
  if (demandPower === undefined) {
    unresolvedFacts.push('Evaluated demand did not resolve total battery-side power.');
  }
  if (acceptedPower === undefined) {
    unresolvedFacts.push(
      acceptance.usableContinuousChargeA !== undefined
        ? 'Accepted charging power requires an explicit compatible battery-side voltage basis.'
        : 'Charge acceptance did not prove usable continuous charging capability.',
    );
  }

  const hasFailedInput = demand.severity === 'FAIL' || acceptance.severity === 'FAIL';
  const hasInvalidInput = issues.some((issue) => issue.includes('invalid'));
  const netPower =
    demandPower !== undefined && acceptedPower !== undefined
      ? acceptedPower - demandPower
      : undefined;
  const resolvedBalance = netPower !== undefined && !hasFailedInput && !hasInvalidInput;
  const balanceState: OperatingPowerBalanceState | undefined =
    netPower === undefined
      ? undefined
      : netPower > 0
        ? 'charging'
        : netPower < 0
          ? 'discharging'
          : 'balanced';

  let severity: EngineeringSeverity;
  if (hasFailedInput || hasInvalidInput) {
    severity = 'FAIL';
  } else if (
    !resolvedBalance ||
    acceptance.severity === 'CONDITIONAL' ||
    demand.severity === 'CONDITIONAL'
  ) {
    severity = 'CONDITIONAL';
  } else if (acceptance.severity === 'WARNING' || demand.severity === 'WARNING') {
    severity = 'WARNING';
  } else {
    severity = 'PASS';
  }

  const demandVoltage = demand.batteryVoltageV ?? demand.designVoltageV;
  const acceptedVoltage = acceptance.selectedBankVoltageV;
  const compatibleVoltage =
    demandVoltage !== undefined &&
    acceptedVoltage !== undefined &&
    demandVoltage === acceptedVoltage;
  const demandCurrent =
    compatibleVoltage && demandPower !== undefined ? demandPower / demandVoltage : undefined;
  const acceptedCurrent =
    compatibleVoltage && acceptedPower !== undefined ? acceptedPower / acceptedVoltage : undefined;
  const netCurrent =
    demandCurrent !== undefined && acceptedCurrent !== undefined
      ? acceptedCurrent - demandCurrent
      : undefined;

  return {
    operatingCaseId: input.operatingCaseId,
    demandScenarioId: demand.scenarioId,
    sourceScenarioId: acceptance.sourceScenarioId,
    batteryId: acceptance.batteryId,
    selectedTopology: acceptance.selectedTopology,
    severity,
    code:
      severity === 'FAIL'
        ? 'operating_power_balance.failed'
        : severity === 'CONDITIONAL'
          ? 'operating_power_balance.unresolved'
          : severity === 'WARNING'
            ? 'operating_power_balance.warning'
            : 'operating_power_balance.pass',
    message:
      severity === 'PASS'
        ? 'Operating power balance is resolved.'
        : severity === 'WARNING'
          ? 'Operating power balance is resolved with upstream guidance warnings.'
          : severity === 'FAIL'
            ? 'Operating power balance cannot be evaluated because an upstream input failed.'
            : 'Operating power balance retains known facts but has unresolved inputs.',
    demandBatteryPowerW: demandPower,
    acceptedChargingPowerW: acceptedPower,
    netBatteryPowerW: netPower,
    chargingSurplusW: netPower !== undefined ? Math.max(netPower, 0) : undefined,
    dischargeDeficitW: netPower !== undefined ? Math.max(-netPower, 0) : undefined,
    balanceState,
    demandCurrentA: demandCurrent,
    acceptedChargeCurrentA: acceptedCurrent,
    netBatteryCurrentA: netCurrent,
    unresolvedFacts: [...new Set(unresolvedFacts)],
    issues: [...new Set(issues)],
    provenance: {
      demandSeverity: demand.severity,
      chargeAcceptanceSeverity: acceptance.severity,
      selectedBankVoltageV: acceptedVoltage,
      sourceAvailablePowerW: acceptance.sourceAvailablePowerW,
      sourceAvailableCapability: acceptance.sourceAvailableCapability,
      demandBatteryPowerW: demandPower,
      acceptedChargingPowerW: acceptedPower,
    },
  };
};
