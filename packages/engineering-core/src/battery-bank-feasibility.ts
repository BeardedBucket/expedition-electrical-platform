import type {
  BatteryBankConfigurationResult,
  BatteryBankRequirements,
  BatteryEngineeringInput,
  BatteryTopology,
  EngineeringIssue,
  EngineeringSeverity,
} from './battery-power.js';
import {
  enumerateFeasibleBankConfigurationsForRequirements,
  evaluateBatteryBankConfiguration,
} from './battery-power.js';
import type { EnergyStorageRequirementResult } from './energy-storage-requirement.js';

export interface BatteryBankElectricalRequirements {
  readonly nominalVoltageV?: number;
  readonly continuousDischargeCurrentA?: number;
  readonly peakDischarge?: {
    readonly currentA: number;
    readonly durationSeconds: number;
  };
}

export interface BatteryBankFeasibilityInput {
  readonly evaluationId?: string;
  readonly battery: BatteryEngineeringInput;
  readonly selectedTopology: BatteryTopology;
  readonly storageRequirement: EnergyStorageRequirementResult;
  readonly electricalRequirements?: BatteryBankElectricalRequirements;
}

export interface BatteryBankFeasibilityResult {
  readonly evaluationId?: string;
  readonly batteryId?: string;
  readonly storageRequirement: EnergyStorageRequirementResult;
  readonly requirements: BatteryBankRequirements;
  readonly selected?: BatteryBankConfigurationResult;
  readonly feasibleAlternatives: readonly BatteryTopology[];
  readonly status: EngineeringSeverity;
  readonly severity: EngineeringSeverity;
  readonly issues: readonly EngineeringIssue[];
  readonly reasons: readonly string[];
  readonly unresolvedReasons: readonly string[];
}

const toBankRequirements = (
  storageRequirement: EnergyStorageRequirementResult,
  electricalRequirements?: BatteryBankElectricalRequirements,
): BatteryBankRequirements => ({
  nominalEnergyWh: storageRequirement.requiredNominalEnergyWh,
  nominalVoltageV: electricalRequirements?.nominalVoltageV,
  continuousDischargeCurrentA: electricalRequirements?.continuousDischargeCurrentA,
  peakDischargeCurrentA: electricalRequirements?.peakDischarge?.currentA,
  peakDischargeDurationS: electricalRequirements?.peakDischarge?.durationSeconds,
});

export const evaluateBatteryBankFeasibility = (
  input: BatteryBankFeasibilityInput,
): BatteryBankFeasibilityResult => {
  const requirements = toBankRequirements(input.storageRequirement, input.electricalRequirements);

  if (input.storageRequirement.status !== 'PASS') {
    const upstreamIssues = input.storageRequirement.issues;
    const message =
      'Battery-bank feasibility cannot proceed because the storage requirement failed.';
    const upstreamIssue: EngineeringIssue = {
      severity: 'FAIL',
      code: 'battery.bank.storage_requirement_failed',
      message,
    };
    return {
      evaluationId: input.evaluationId,
      batteryId: input.battery.id,
      storageRequirement: input.storageRequirement,
      requirements,
      feasibleAlternatives: [],
      status: 'FAIL',
      severity: 'FAIL',
      issues: [...upstreamIssues, upstreamIssue],
      reasons: [message, input.storageRequirement.message],
      unresolvedReasons: [],
    };
  }

  const selected = evaluateBatteryBankConfiguration({
    battery: input.battery,
    selectedTopology: input.selectedTopology,
    requirements,
  });
  const feasibleAlternatives = enumerateFeasibleBankConfigurationsForRequirements({
    battery: input.battery,
    selectedTopology: input.selectedTopology,
    requirements,
  });

  return {
    evaluationId: input.evaluationId,
    batteryId: input.battery.id,
    storageRequirement: input.storageRequirement,
    requirements,
    selected,
    feasibleAlternatives,
    status: selected.status,
    severity: selected.severity,
    issues: selected.issues,
    reasons: selected.reasons,
    unresolvedReasons: selected.unresolvedReasons,
  };
};
