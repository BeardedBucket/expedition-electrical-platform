import type { EngineeringIssue, EngineeringSeverity } from './battery-power.js';

export type DomainStorageStatus = 'present' | 'absent' | 'unresolved';
export type SupplyPermission = 'allowed' | 'prohibited' | 'required' | 'unresolved';
export type SupplyCapabilityStatus = 'resolved' | 'unresolved';

export interface MixedVoltageDomainInput {
  readonly id: string;
  readonly nominalVoltageV: number;
  readonly storage?: DomainStorageStatus;
  readonly currentType?: 'dc' | 'ac';
}

export interface SupplyPathInput {
  readonly id: string;
  readonly sourceDomainId: string;
  readonly targetDomainId: string;
  readonly permission?: SupplyPermission;
  readonly capabilityStatus?: SupplyCapabilityStatus;
  readonly continuousPowerW?: number;
  readonly surgePowerW?: number;
  readonly surgeDurationS?: number;
  readonly isolated?: boolean;
  readonly available?: 'available' | 'unavailable' | 'unresolved';
}

export interface SupplyRequirementInput {
  readonly id: string;
  readonly sourceDomainId: string;
  readonly targetDomainId: string;
  readonly relationship?: SupplyPermission;
  readonly pathId?: string;
  readonly continuousPowerW?: number;
  readonly surgePowerW?: number;
  readonly surgeDurationS?: number;
  readonly requiresIsolation?: boolean;
}

export interface MixedVoltageEvaluationInput {
  readonly domains: readonly MixedVoltageDomainInput[];
  readonly paths?: readonly SupplyPathInput[];
  readonly requirements?: readonly SupplyRequirementInput[];
}

export interface MixedVoltageDomain {
  readonly domainId: string;
  readonly nominalVoltageV: number;
  readonly storage: DomainStorageStatus;
  readonly currentType?: 'dc' | 'ac';
}

export interface MixedVoltageObservation {
  readonly requirementId?: string;
  readonly sourceDomainId?: string;
  readonly targetDomainId?: string;
  readonly conversionRequired?: boolean;
  readonly localStoragePresent?: boolean;
  readonly localStorageAbsent?: boolean;
  readonly pathRequired?: boolean;
  readonly pathResolved?: boolean;
  readonly pathAdequate?: boolean;
}

export interface MixedVoltageIssue extends EngineeringIssue {
  readonly pathId?: string;
  readonly requirementId?: string;
  readonly sourceDomainId?: string;
  readonly targetDomainId?: string;
}

export interface SupplyPathEvaluation {
  readonly pathId: string;
  readonly sourceDomainId: string;
  readonly targetDomainId: string;
  readonly severity: EngineeringSeverity;
  readonly issues: readonly MixedVoltageIssue[];
}

export interface MixedVoltageEvaluationResult {
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly domains: readonly MixedVoltageDomain[];
  readonly pathEvaluations: readonly SupplyPathEvaluation[];
  readonly observations: readonly MixedVoltageObservation[];
  readonly issues: readonly MixedVoltageIssue[];
  readonly selectedPathIds: readonly string[];
  readonly recommendation?: never;
}

const finiteNonNegative = (value: number | undefined): boolean =>
  value !== undefined && Number.isFinite(value) && value >= 0;

const issue = (
  code: string,
  severity: EngineeringSeverity,
  message: string,
  context: Omit<MixedVoltageIssue, 'code' | 'severity' | 'message'> = {},
): MixedVoltageIssue => ({ code, severity, message, ...context });

const severityRank: Record<EngineeringSeverity, number> = {
  PASS: 0,
  INFORMATION: 0,
  WARNING: 1,
  CONDITIONAL: 2,
  FAIL: 3,
};

const highestSeverity = (severities: readonly EngineeringSeverity[]): EngineeringSeverity =>
  severities.reduce<EngineeringSeverity>(
    (highest, current) => (severityRank[current] > severityRank[highest] ? current : highest),
    'PASS',
  );

const validDomain = (domain: MixedVoltageDomainInput): boolean =>
  domain.id.length > 0 && Number.isFinite(domain.nominalVoltageV) && domain.nominalVoltageV > 0;

const validPath = (path: SupplyPathInput): boolean =>
  [path.continuousPowerW, path.surgePowerW, path.surgeDurationS]
    .filter((value): value is number => value !== undefined)
    .every(finiteNonNegative);

const evaluatePath = (
  path: SupplyPathInput,
  domainsById: ReadonlyMap<string, MixedVoltageDomainInput>,
): SupplyPathEvaluation => {
  const issues: MixedVoltageIssue[] = [];
  if (!domainsById.has(path.sourceDomainId) || !domainsById.has(path.targetDomainId)) {
    issues.push(
      issue('invalid_path_domains', 'FAIL', 'Supply path references an unknown domain.', {
        pathId: path.id,
        sourceDomainId: path.sourceDomainId,
        targetDomainId: path.targetDomainId,
      }),
    );
  }
  if (!validPath(path)) {
    issues.push(
      issue(
        'invalid_path_numeric_input',
        'FAIL',
        'Supply path capability values must be finite and non-negative.',
        {
          pathId: path.id,
          sourceDomainId: path.sourceDomainId,
          targetDomainId: path.targetDomainId,
        },
      ),
    );
  }
  if (path.permission === 'prohibited') {
    issues.push(
      issue(
        'prohibited_supply_relationship',
        'FAIL',
        'The declared supply relationship is prohibited.',
        {
          pathId: path.id,
          sourceDomainId: path.sourceDomainId,
          targetDomainId: path.targetDomainId,
        },
      ),
    );
  } else if (
    path.permission === 'unresolved' ||
    path.available === 'unresolved' ||
    path.capabilityStatus === 'unresolved'
  ) {
    issues.push(
      issue(
        'required_supply_path_unresolved',
        'CONDITIONAL',
        'The declared supply path remains unresolved.',
        {
          pathId: path.id,
          sourceDomainId: path.sourceDomainId,
          targetDomainId: path.targetDomainId,
        },
      ),
    );
  } else if (path.available === 'unavailable') {
    issues.push(
      issue(
        'supply_path_unavailable',
        'FAIL',
        'The declared supply path is unavailable in this evaluation.',
        {
          pathId: path.id,
          sourceDomainId: path.sourceDomainId,
          targetDomainId: path.targetDomainId,
        },
      ),
    );
  }
  const severity = highestSeverity(issues.map((item) => item.severity));
  return {
    pathId: path.id,
    sourceDomainId: path.sourceDomainId,
    targetDomainId: path.targetDomainId,
    severity,
    issues,
  };
};

export const evaluateMixedVoltageDomains = (
  input: MixedVoltageEvaluationInput,
): MixedVoltageEvaluationResult => {
  const domains = input.domains ?? [];
  const paths = input.paths ?? [];
  const requirements = input.requirements ?? [];
  const domainsById = new Map(domains.map((domain) => [domain.id, domain]));
  const issues: MixedVoltageIssue[] = [];

  for (const domain of domains) {
    if (!validDomain(domain)) {
      issues.push(
        issue(
          'invalid_domain_voltage',
          'FAIL',
          'Domain nominal voltage must be finite and greater than zero.',
          {
            sourceDomainId: domain.id,
          },
        ),
      );
    }
  }

  const pathEvaluations = paths.map((path) => evaluatePath(path, domainsById));
  issues.push(...pathEvaluations.flatMap((evaluation) => evaluation.issues));
  const observations: MixedVoltageObservation[] = [];
  const selectedPathIds: string[] = [];

  for (const requirement of requirements) {
    const source = domainsById.get(requirement.sourceDomainId);
    const target = domainsById.get(requirement.targetDomainId);
    const conversionRequired =
      source !== undefined &&
      target !== undefined &&
      source.nominalVoltageV !== target.nominalVoltageV;
    const candidates = paths.filter(
      (path) =>
        path.sourceDomainId === requirement.sourceDomainId &&
        path.targetDomainId === requirement.targetDomainId,
    );
    const selected = requirement.pathId
      ? candidates.find((path) => path.id === requirement.pathId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    const relationship = requirement.relationship ?? 'required';
    observations.push({
      requirementId: requirement.id,
      sourceDomainId: requirement.sourceDomainId,
      targetDomainId: requirement.targetDomainId,
      conversionRequired,
      ...(target?.storage === 'present' ? { localStoragePresent: true } : {}),
      ...(target?.storage === 'absent' ? { localStorageAbsent: true } : {}),
      pathRequired: relationship === 'required',
      pathResolved: selected !== undefined,
    });

    if (relationship === 'prohibited') {
      if (selected !== undefined || candidates.length > 0) {
        issues.push(
          issue(
            'prohibited_supply_relationship',
            'FAIL',
            'A prohibited supply relationship was declared or used.',
            {
              requirementId: requirement.id,
              sourceDomainId: requirement.sourceDomainId,
              targetDomainId: requirement.targetDomainId,
            },
          ),
        );
      }
      continue;
    }
    if (relationship !== 'required') continue;
    if (selected === undefined) {
      issues.push(
        issue(
          candidates.length > 1
            ? 'multiple_paths_require_explicit_selection'
            : 'missing_required_supply_path',
          candidates.length > 1 ? 'CONDITIONAL' : 'FAIL',
          candidates.length > 1
            ? 'Multiple supply paths are available; no path was automatically selected.'
            : 'A required supply path was not declared for the selected architecture.',
          {
            requirementId: requirement.id,
            sourceDomainId: requirement.sourceDomainId,
            targetDomainId: requirement.targetDomainId,
          },
        ),
      );
      continue;
    }
    if (requirement.pathId) selectedPathIds.push(selected.id);
    const pathResult = pathEvaluations.find((evaluation) => evaluation.pathId === selected.id);
    if (pathResult && pathResult.severity !== 'PASS') {
      issues.push(
        ...pathResult.issues.map((item) => ({
          ...item,
          code: item.code,
          requirementId: requirement.id,
        })),
      );
      continue;
    }
    const capacityIssues: MixedVoltageIssue[] = [];
    if (requirement.continuousPowerW !== undefined) {
      if (selected.continuousPowerW === undefined) {
        capacityIssues.push(
          issue(
            'continuous_path_capacity_unresolved',
            'CONDITIONAL',
            'Continuous path capability is unresolved.',
            { pathId: selected.id, requirementId: requirement.id },
          ),
        );
      } else if (selected.continuousPowerW < requirement.continuousPowerW) {
        capacityIssues.push(
          issue(
            'continuous_path_capacity_insufficient',
            'FAIL',
            'Declared path continuous capability is below the target requirement.',
            { pathId: selected.id, requirementId: requirement.id },
          ),
        );
      }
    }
    if (requirement.surgePowerW !== undefined) {
      if (selected.surgePowerW === undefined) {
        capacityIssues.push(
          issue(
            'surge_path_capacity_unresolved',
            'CONDITIONAL',
            'Surge path capability is unresolved.',
            { pathId: selected.id, requirementId: requirement.id },
          ),
        );
      } else if (
        selected.surgePowerW < requirement.surgePowerW ||
        (requirement.surgeDurationS !== undefined &&
          (selected.surgeDurationS === undefined ||
            selected.surgeDurationS < requirement.surgeDurationS))
      ) {
        capacityIssues.push(
          issue(
            'surge_path_capacity_insufficient',
            'FAIL',
            'Declared path surge capability is below the target requirement.',
            { pathId: selected.id, requirementId: requirement.id },
          ),
        );
      }
    }
    if (requirement.requiresIsolation && selected.isolated !== true) {
      capacityIssues.push(
        issue(
          'required_isolation_unsatisfied',
          'FAIL',
          'The required isolated supply relationship is not satisfied.',
          { pathId: selected.id, requirementId: requirement.id },
        ),
      );
    }
    issues.push(...capacityIssues);
    const observation = observations[observations.length - 1];
    if (observation) {
      observations[observations.length - 1] = {
        ...observation,
        pathAdequate: capacityIssues.length === 0,
      };
    }
  }

  const severity = highestSeverity(issues.map((item) => item.severity));
  return {
    severity,
    code:
      severity === 'FAIL'
        ? 'mixed_voltage_domains.failed'
        : severity === 'CONDITIONAL'
          ? 'mixed_voltage_domains.unresolved'
          : 'mixed_voltage_domains.pass',
    message:
      severity === 'FAIL'
        ? 'The selected domain relationship or supply path failed compatibility checks.'
        : severity === 'CONDITIONAL'
          ? 'The selected domain relationship remains conditional because required detail is unresolved.'
          : 'The declared domain relationships are compatible.',
    domains: domains.map((domain) => ({
      domainId: domain.id,
      nominalVoltageV: domain.nominalVoltageV,
      storage: domain.storage ?? 'unresolved',
      ...(domain.currentType ? { currentType: domain.currentType } : {}),
    })),
    pathEvaluations,
    observations,
    issues,
    selectedPathIds,
  };
};
