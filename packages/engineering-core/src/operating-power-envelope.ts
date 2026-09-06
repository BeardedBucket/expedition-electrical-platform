import type { OperatingPowerBalanceResult } from './operating-power-balance.js';
import type { BatteryTopology, EngineeringSeverity } from './battery-power.js';

export interface OperatingPowerEnvelopeInput {
  readonly envelopeId?: string;
  readonly cases: readonly OperatingPowerBalanceResult[];
}

export interface OperatingPowerDimensionEnvelope {
  readonly valueW?: number;
  readonly governingOperatingCaseIds: readonly string[];
  readonly status: 'resolved' | 'unresolved';
  readonly unresolvedOperatingCaseIds?: readonly string[];
}

export interface OperatingPowerEnvelopeCaseProvenance {
  readonly operatingCaseId: string;
  readonly demandScenarioId?: string;
  readonly sourceScenarioId?: string;
  readonly batteryId?: string;
  readonly selectedTopology: BatteryTopology;
  readonly severity: EngineeringSeverity;
}

export interface OperatingPowerEnvelopeResult {
  readonly envelopeId?: string;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly evaluatedCaseCount: number;
  readonly evaluatedOperatingCaseIds: readonly string[];
  readonly failedOperatingCaseIds: readonly string[];
  readonly dischargeDeficit: OperatingPowerDimensionEnvelope;
  readonly chargingSurplus: OperatingPowerDimensionEnvelope;
  readonly caseProvenance: readonly OperatingPowerEnvelopeCaseProvenance[];
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
}

const validPower = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

const resolveDimension = (
  cases: readonly OperatingPowerBalanceResult[],
  valueForCase: (result: OperatingPowerBalanceResult) => number | undefined,
): OperatingPowerDimensionEnvelope => {
  let maximum: number | undefined;
  const governors: string[] = [];
  const unresolved: string[] = [];

  for (const result of cases) {
    const operatingCaseId = result.operatingCaseId;
    const value = valueForCase(result);
    if (operatingCaseId === undefined) continue;
    if (value === undefined) {
      unresolved.push(operatingCaseId);
      continue;
    }
    if (maximum === undefined || value > maximum) {
      maximum = value;
      governors.length = 0;
    }
    if (value === maximum) governors.push(operatingCaseId);
  }

  const orderedGovernors = [...governors].sort();
  const orderedUnresolved = [...unresolved].sort();
  if (cases.length === 0) {
    return {
      governingOperatingCaseIds: [],
      status: 'unresolved',
    };
  }
  return {
    ...(maximum === undefined ? {} : { valueW: maximum }),
    governingOperatingCaseIds: orderedGovernors,
    status: orderedUnresolved.length === 0 ? 'resolved' : 'unresolved',
    ...(orderedUnresolved.length > 0 ? { unresolvedOperatingCaseIds: orderedUnresolved } : {}),
  };
};

export const evaluateOperatingPowerEnvelope = (
  input: OperatingPowerEnvelopeInput,
): OperatingPowerEnvelopeResult => {
  const cases = input.cases ?? [];
  const issues: string[] = [];
  const unresolvedFacts: string[] = [];
  const ids = cases.map((result) => result.operatingCaseId);
  const missingIdCount = ids.filter((id) => id === undefined).length;
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const id of ids) {
    if (id === undefined) continue;
    if (seenIds.has(id)) duplicateIds.add(id);
    seenIds.add(id);
  }
  for (const id of [...duplicateIds].sort()) {
    issues.push(`Duplicate operating case ID: ${id}.`);
  }
  if (missingIdCount > 0) {
    issues.push(`${missingIdCount} operating case(s) are missing an operating case ID.`);
  }

  const provenance = cases
    .flatMap((result) =>
      result.operatingCaseId === undefined
        ? []
        : [
            {
              operatingCaseId: result.operatingCaseId,
              demandScenarioId: result.demandScenarioId,
              sourceScenarioId: result.sourceScenarioId,
              batteryId: result.batteryId,
              selectedTopology: result.selectedTopology,
              severity: result.severity,
            },
          ],
    )
    .sort((a, b) => a.operatingCaseId.localeCompare(b.operatingCaseId));
  const evaluatedOperatingCaseIds = provenance.map((item) => item.operatingCaseId);
  const failedOperatingCaseIds = cases
    .filter((result) => result.severity === 'FAIL' && result.operatingCaseId !== undefined)
    .map((result) => result.operatingCaseId as string)
    .sort();

  if (cases.length === 0) {
    unresolvedFacts.push('At least one evaluated operating power balance case is required.');
  }

  for (const result of cases) {
    if (result.operatingCaseId === undefined) continue;
    if (result.severity === 'FAIL') {
      issues.push(`${result.operatingCaseId}: operating power balance failed.`);
    }
    if (!validPower(result.dischargeDeficitW)) {
      unresolvedFacts.push(
        `${result.operatingCaseId}: discharge deficit is not resolved as finite non-negative power.`,
      );
    }
    if (!validPower(result.chargingSurplusW)) {
      unresolvedFacts.push(
        `${result.operatingCaseId}: charging surplus is not resolved as finite non-negative power.`,
      );
    }
    for (const unresolvedFact of result.unresolvedFacts) {
      unresolvedFacts.push(`${result.operatingCaseId}: ${unresolvedFact}`);
    }
    for (const issue of result.issues) {
      issues.push(`${result.operatingCaseId}: ${issue}`);
    }
  }

  const dischargeDeficit = resolveDimension(cases, (result) =>
    validPower(result.dischargeDeficitW) ? result.dischargeDeficitW : undefined,
  );
  const chargingSurplus = resolveDimension(cases, (result) =>
    validPower(result.chargingSurplusW) ? result.chargingSurplusW : undefined,
  );

  const hasInvalidInput = issues.some(
    (issue) =>
      issue.startsWith('Duplicate operating case ID:') ||
      issue.includes('missing an operating case ID'),
  );
  const hasInvalidPower = cases.some(
    (result) =>
      (result.dischargeDeficitW !== undefined && !validPower(result.dischargeDeficitW)) ||
      (result.chargingSurplusW !== undefined && !validPower(result.chargingSurplusW)),
  );
  const hasUnresolvedDimension =
    dischargeDeficit.status === 'unresolved' || chargingSurplus.status === 'unresolved';
  const hasWarning = cases.some((result) => result.severity === 'WARNING');
  const severity: EngineeringSeverity =
    hasInvalidInput || hasInvalidPower || failedOperatingCaseIds.length > 0
      ? 'FAIL'
      : cases.length === 0 ||
          hasUnresolvedDimension ||
          cases.some((result) => result.severity === 'CONDITIONAL')
        ? 'CONDITIONAL'
        : hasWarning
          ? 'WARNING'
          : 'PASS';

  return {
    envelopeId: input.envelopeId,
    severity,
    code:
      severity === 'FAIL'
        ? 'operating_power_envelope.failed'
        : severity === 'CONDITIONAL'
          ? 'operating_power_envelope.unresolved'
          : severity === 'WARNING'
            ? 'operating_power_envelope.warning'
            : 'operating_power_envelope.pass',
    message:
      severity === 'FAIL'
        ? 'Operating power envelope contains a failed or invalid case.'
        : severity === 'CONDITIONAL'
          ? 'Operating power envelope retains known maxima but cannot prove a complete envelope.'
          : severity === 'WARNING'
            ? 'Operating power envelope is resolved with upstream guidance warnings.'
            : 'Operating power envelope is fully resolved.',
    evaluatedCaseCount: cases.length,
    evaluatedOperatingCaseIds,
    failedOperatingCaseIds,
    dischargeDeficit,
    chargingSurplus,
    caseProvenance: provenance,
    unresolvedFacts: [...new Set(unresolvedFacts)],
    issues: [...new Set(issues)],
  };
};
