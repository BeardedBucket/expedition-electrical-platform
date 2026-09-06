import type { EngineeringIssue, EngineeringSeverity } from './battery-power.js';

export type EnergyRequirementBasisKind = 'explicit' | 'usage-profile-discharge' | 'other-derived';

export interface EnergyRequirementBasis {
  readonly kind: EnergyRequirementBasisKind;
  readonly sourceId?: string;
}

export interface EnergyStorageRequirementInput {
  readonly requirementId?: string;
  readonly requiredUsableEnergyWh: number;
  readonly autonomyPeriodCount: number;
  readonly usableFractionOfNominal: number;
  readonly basis?: EnergyRequirementBasis;
}

export interface EnergyStorageRequirementResult {
  readonly requirementId?: string;
  readonly status: 'PASS' | 'FAIL';
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly requiredUsableEnergyWh: number;
  readonly autonomyPeriodCount: number;
  readonly autonomyAdjustedUsableEnergyWh: number;
  readonly usableFractionOfNominal: number;
  readonly reserveFractionDerived: number;
  readonly requiredNominalEnergyWh: number;
  readonly basis?: EnergyRequirementBasis;
  readonly issues: readonly EngineeringIssue[];
  readonly provenance: {
    readonly requirementId?: string;
    readonly requiredUsableEnergyWh: number;
    readonly autonomyPeriodCount: number;
    readonly usableFractionOfNominal: number;
    readonly autonomyAdjustedUsableEnergyWh: number;
    readonly reserveFractionDerived: number;
    readonly requiredNominalEnergyWh: number;
    readonly formula: string;
    readonly basis?: EnergyRequirementBasis;
  };
}

const finite = (value: number): value is number => Number.isFinite(value);
const normalizeNumber = (value: number): number => {
  if (!Number.isFinite(value)) {
    return value;
  }

  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const evaluateEnergyStorageRequirement = (
  input: EnergyStorageRequirementInput,
): EnergyStorageRequirementResult => {
  const issues: EngineeringIssue[] = [];

  const requiredUsableEnergyWh = input.requiredUsableEnergyWh;
  const autonomyPeriodCount = input.autonomyPeriodCount;
  const usableFractionOfNominal = input.usableFractionOfNominal;

  const validRequiredUsableEnergy = finite(requiredUsableEnergyWh) && requiredUsableEnergyWh >= 0;
  if (!validRequiredUsableEnergy) {
    issues.push({
      severity: 'FAIL',
      code: 'energy.storage_requirement.invalid_required_usable_energy_wh',
      message: 'requiredUsableEnergyWh must be finite and non-negative.',
    });
  }

  const validAutonomyPeriodCount = finite(autonomyPeriodCount) && autonomyPeriodCount > 0;
  if (!validAutonomyPeriodCount) {
    issues.push({
      severity: 'FAIL',
      code: 'energy.storage_requirement.invalid_autonomy_period_count',
      message: 'autonomyPeriodCount must be finite and greater than zero.',
    });
  }

  const validUsableFraction =
    finite(usableFractionOfNominal) && usableFractionOfNominal > 0 && usableFractionOfNominal <= 1;
  if (!validUsableFraction) {
    issues.push({
      severity: 'FAIL',
      code: 'energy.storage_requirement.invalid_usable_fraction_of_nominal',
      message: 'usableFractionOfNominal must be finite, greater than zero, and at most 1.',
    });
  }

  if (issues.length > 0) {
    const invalidValue = Number.NaN;
    return {
      requirementId: input.requirementId,
      status: 'FAIL',
      severity: 'FAIL',
      code: 'energy.storage_requirement.invalid',
      message: 'Energy storage requirement validation failed.',
      requiredUsableEnergyWh: requiredUsableEnergyWh,
      autonomyPeriodCount: autonomyPeriodCount,
      autonomyAdjustedUsableEnergyWh: invalidValue,
      usableFractionOfNominal: usableFractionOfNominal,
      reserveFractionDerived: invalidValue,
      requiredNominalEnergyWh: invalidValue,
      basis: input.basis,
      issues,
      provenance: {
        requirementId: input.requirementId,
        requiredUsableEnergyWh: requiredUsableEnergyWh,
        autonomyPeriodCount: autonomyPeriodCount,
        usableFractionOfNominal: usableFractionOfNominal,
        autonomyAdjustedUsableEnergyWh: invalidValue,
        reserveFractionDerived: invalidValue,
        requiredNominalEnergyWh: invalidValue,
        formula:
          'requiredUsableEnergyWh × autonomyPeriodCount ÷ usableFractionOfNominal = requiredNominalEnergyWh',
        basis: input.basis,
      },
    };
  }

  const autonomyAdjustedUsableEnergyWh = normalizeNumber(
    requiredUsableEnergyWh * autonomyPeriodCount,
  );
  const reserveFractionDerived = normalizeNumber(1 - usableFractionOfNominal);
  const requiredNominalEnergyWh = normalizeNumber(
    autonomyAdjustedUsableEnergyWh / usableFractionOfNominal,
  );

  return {
    requirementId: input.requirementId,
    status: 'PASS',
    severity: 'PASS',
    code: 'energy.storage_requirement.pass',
    message: 'Energy storage requirement is fully resolved.',
    requiredUsableEnergyWh,
    autonomyPeriodCount,
    autonomyAdjustedUsableEnergyWh,
    usableFractionOfNominal,
    reserveFractionDerived,
    requiredNominalEnergyWh,
    basis: input.basis,
    issues: [],
    provenance: {
      requirementId: input.requirementId,
      requiredUsableEnergyWh,
      autonomyPeriodCount,
      usableFractionOfNominal,
      autonomyAdjustedUsableEnergyWh,
      reserveFractionDerived,
      requiredNominalEnergyWh,
      formula:
        'requiredUsableEnergyWh × autonomyPeriodCount ÷ usableFractionOfNominal = requiredNominalEnergyWh',
      basis: input.basis,
    },
  };
};
