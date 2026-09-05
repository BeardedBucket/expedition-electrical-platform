export type EvidenceType =
  | 'manufacturer_notice'
  | 'regulator_notice'
  | 'recall'
  | 'standards_body_notice'
  | 'independent_lab_test'
  | 'documented_field_failure'
  | 'service_bulletin'
  | 'litigation'
  | 'insurance_notice'
  | 'news_report'
  | 'community_report'
  | 'forum_report'
  | 'social_media_report'
  | 'other';

export type EvidenceVerificationStatus =
  'unverified' | 'corroborated' | 'verified' | 'disputed' | 'retracted' | 'superseded';
export type EvidenceStatus = 'active' | 'retracted' | 'superseded' | 'disputed';
export type AdvisoryLifecycleStatus =
  'monitoring' | 'active' | 'resolved' | 'withdrawn' | 'superseded';
export type AdvisorySeverity = 'informational' | 'low' | 'moderate' | 'high' | 'critical';
export type AdvisoryConfidence = 'low' | 'medium' | 'high' | 'confirmed';
export type AdvisoryPolicyAction =
  'none' | 'inform' | 'caution' | 'suppress_recommendation' | 'exclude';

export interface EvidenceSource {
  readonly id: string;
  readonly type: string;
  readonly title?: string;
  readonly description?: string;
  readonly uri?: string;
  readonly publisher?: string;
  readonly source_key?: string;
  readonly event_key?: string;
  readonly publication_date?: string;
  readonly date_checked: string;
  readonly archived_uri?: string;
  readonly notes?: string;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly affected_component_ids: readonly string[];
  readonly type: EvidenceType;
  readonly sources: readonly EvidenceSource[];
  readonly publication_date?: string;
  readonly observed_at?: string;
  readonly date_checked: string;
  readonly summary: string;
  readonly verification_status: EvidenceVerificationStatus;
  readonly status: EvidenceStatus;
  readonly affected_models?: readonly string[];
  readonly serial_ranges?: readonly string[];
  readonly batches?: readonly string[];
  readonly jurisdictions?: readonly string[];
  readonly technical_failure_mode?: string;
  readonly notes?: string;
  readonly duplicate_of?: string;
}

export interface ReviewedAdvisoryDecision {
  readonly status: AdvisoryLifecycleStatus;
  readonly severity: AdvisorySeverity;
  readonly confidence: AdvisoryConfidence;
  readonly policy_action: AdvisoryPolicyAction;
  readonly rationale: string;
  readonly reviewer: string;
  readonly reviewed_at: string;
}

export interface AdvisoryRecord {
  readonly id: string;
  readonly affected_component_ids: readonly string[];
  readonly status: AdvisoryLifecycleStatus;
  readonly severity: AdvisorySeverity;
  readonly confidence: AdvisoryConfidence;
  readonly evidence_ids: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly review_after?: string;
  readonly next_review_at?: string;
  readonly summary: string;
  readonly rationale: string;
  readonly policy_action: AdvisoryPolicyAction;
  readonly affected_models?: readonly string[];
  readonly serial_ranges?: readonly string[];
  readonly batches?: readonly string[];
  readonly jurisdictions?: readonly string[];
  readonly supersedes?: string;
  readonly superseded_by?: string;
  readonly reviewed_decision?: ReviewedAdvisoryDecision;
  readonly title?: string;
  readonly legacy?: boolean;
}

export interface AdvisoryPolicyConfiguration {
  readonly staleAfterDays?: number;
  readonly evidenceStaleAfterDays?: number;
  readonly reviewDueGraceDays?: number;
  readonly resolvedPolicyAction?: AdvisoryPolicyAction;
  readonly withdrawnPolicyAction?: AdvisoryPolicyAction;
  readonly supersededPolicyAction?: AdvisoryPolicyAction;
}

export interface AdvisoryValidationProblem {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface AdvisoryAssessment {
  readonly status: 'needs_review' | 'sufficient';
  readonly severity: AdvisorySeverity;
  readonly confidence: AdvisoryConfidence;
  readonly policy_action: AdvisoryPolicyAction;
  readonly reasons: readonly string[];
  readonly evidence_ids: readonly string[];
}

export interface ComponentAdvisoryEvaluation {
  readonly component_id: string;
  readonly applicable_advisory_ids: readonly string[];
  readonly effective_policy_action: AdvisoryPolicyAction;
  readonly effective_severity: AdvisorySeverity;
  readonly effective_confidence: AdvisoryConfidence;
  readonly eligible: boolean;
  readonly warnings: readonly string[];
  readonly reasons: readonly string[];
  readonly stale: boolean;
  readonly review_due: boolean;
  readonly trace: readonly {
    readonly advisory_id: string;
    readonly evidence_ids: readonly string[];
  }[];
  readonly problems: readonly AdvisoryValidationProblem[];
}

const policyRank: Record<AdvisoryPolicyAction, number> = {
  none: 0,
  inform: 1,
  caution: 2,
  suppress_recommendation: 3,
  exclude: 4,
};
const severityRank: Record<AdvisorySeverity, number> = {
  informational: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};
const confidenceRank: Record<AdvisoryConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
  confirmed: 3,
};
const evidenceTypes = new Set<EvidenceType>([
  'manufacturer_notice',
  'regulator_notice',
  'recall',
  'standards_body_notice',
  'independent_lab_test',
  'documented_field_failure',
  'service_bulletin',
  'litigation',
  'insurance_notice',
  'news_report',
  'community_report',
  'forum_report',
  'social_media_report',
  'other',
]);
const evidenceVerificationStatuses = new Set<EvidenceVerificationStatus>([
  'unverified',
  'corroborated',
  'verified',
  'disputed',
  'retracted',
  'superseded',
]);
const evidenceStatuses = new Set<EvidenceStatus>(['active', 'retracted', 'superseded', 'disputed']);
const advisoryStatuses = new Set<AdvisoryLifecycleStatus>([
  'monitoring',
  'active',
  'resolved',
  'withdrawn',
  'superseded',
]);
const advisorySeverities = new Set<AdvisorySeverity>([
  'informational',
  'low',
  'moderate',
  'high',
  'critical',
]);
const advisoryConfidences = new Set<AdvisoryConfidence>(['low', 'medium', 'high', 'confirmed']);
const policyActions = new Set<AdvisoryPolicyAction>([
  'none',
  'inform',
  'caution',
  'suppress_recommendation',
  'exclude',
]);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const isStableId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9._-]+$/.test(value);
const daysBetween = (from: string, to: string): number =>
  (Date.parse(to) - Date.parse(from)) / 86_400_000;

const technicalEvidenceSourceKeys = (evidence: readonly EvidenceRecord[]): Set<string> => {
  const qualifying = evidence.filter(
    (item) =>
      item.status === 'active' &&
      (item.verification_status === 'verified' || item.verification_status === 'corroborated') &&
      [
        'manufacturer_notice',
        'regulator_notice',
        'recall',
        'independent_lab_test',
        'service_bulletin',
      ].includes(item.type),
  );
  return new Set(
    qualifying.flatMap((item) =>
      item.sources.map(
        (source) => source.event_key ?? source.source_key ?? source.publisher ?? source.id,
      ),
    ),
  );
};

const validateReviewedDecision = (
  reviewedDecision: unknown,
  createdAt: unknown,
  updatedAt: unknown,
): readonly AdvisoryValidationProblem[] => {
  const errors: AdvisoryValidationProblem[] = [];
  const add = (code: string, path: string, message: string) => errors.push({ code, path, message });
  if (reviewedDecision === undefined) return errors;
  if (!reviewedDecision || typeof reviewedDecision !== 'object') {
    add('invalid_reviewed_decision', 'reviewed_decision', 'must be an object.');
    return errors;
  }
  const decision = reviewedDecision as Record<string, unknown>;
  if (!advisoryStatuses.has(decision.status as AdvisoryLifecycleStatus))
    add(
      'invalid_reviewed_decision_status',
      'reviewed_decision.status',
      'must be a supported advisory lifecycle status.',
    );
  if (!advisorySeverities.has(decision.severity as AdvisorySeverity))
    add(
      'invalid_reviewed_decision_severity',
      'reviewed_decision.severity',
      'must be a supported severity.',
    );
  if (!advisoryConfidences.has(decision.confidence as AdvisoryConfidence))
    add(
      'invalid_reviewed_decision_confidence',
      'reviewed_decision.confidence',
      'must be a supported confidence.',
    );
  if (!policyActions.has(decision.policy_action as AdvisoryPolicyAction))
    add(
      'invalid_reviewed_decision_policy_action',
      'reviewed_decision.policy_action',
      'must be a supported policy action.',
    );
  if (typeof decision.rationale !== 'string' || decision.rationale.trim() === '')
    add('missing_reviewed_decision_rationale', 'reviewed_decision.rationale', 'is required.');
  if (typeof decision.reviewer !== 'string' || decision.reviewer.trim() === '')
    add('missing_reviewed_decision_reviewer', 'reviewed_decision.reviewer', 'is required.');
  if (!isDate(decision.reviewed_at))
    add(
      'invalid_reviewed_decision_timestamp',
      'reviewed_decision.reviewed_at',
      'must be a parseable timestamp.',
    );
  if (
    isDate(decision.reviewed_at) &&
    isDate(createdAt) &&
    Date.parse(decision.reviewed_at as string) < Date.parse(createdAt as string)
  )
    add(
      'reviewed_decision_before_created_at',
      'reviewed_decision.reviewed_at',
      'must not be earlier than advisory created_at.',
    );
  if (
    isDate(decision.reviewed_at) &&
    isDate(updatedAt) &&
    Date.parse(updatedAt as string) < Date.parse(decision.reviewed_at as string)
  )
    add(
      'reviewed_decision_after_updated_at',
      'reviewed_decision.reviewed_at',
      'advisory updated_at must not be earlier than reviewed_decision.reviewed_at.',
    );
  return errors;
};

/**
 * Malformed reviewed_decision data must never become effective policy. Callers that need to
 * apply reviewed_decision precedence (e.g. evaluateComponentAdvisories) must gate on this check
 * rather than trusting the field's presence alone.
 */
export const isReviewedDecisionValid = (advisory: AdvisoryRecord): boolean =>
  validateReviewedDecision(advisory.reviewed_decision, advisory.created_at, advisory.updated_at)
    .length === 0;

export const validateEvidenceRecord = (
  input: unknown,
):
  | { ok: true; value: EvidenceRecord }
  | { ok: false; errors: readonly AdvisoryValidationProblem[] } => {
  const errors: AdvisoryValidationProblem[] = [];
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      errors: [{ code: 'invalid_record', path: '', message: 'Evidence must be an object.' }],
    };
  }
  const record = input as Record<string, unknown>;
  const add = (code: string, path: string, message: string) => errors.push({ code, path, message });
  if (!isStableId(record.id)) add('invalid_id', 'id', 'must be a stable non-empty ID.');
  if (!evidenceTypes.has(record.type as EvidenceType))
    add('invalid_evidence_type', 'type', 'must be a supported evidence type.');
  if (!evidenceVerificationStatuses.has(record.verification_status as EvidenceVerificationStatus))
    add(
      'invalid_verification_status',
      'verification_status',
      'must be a supported verification status.',
    );
  if (!evidenceStatuses.has(record.status as EvidenceStatus))
    add('invalid_evidence_status', 'status', 'must be a supported evidence status.');
  if (!Array.isArray(record.affected_component_ids) || record.affected_component_ids.length === 0) {
    add('invalid_components', 'affected_component_ids', 'must contain at least one component ID.');
  } else if (record.affected_component_ids.some((id) => !isStableId(id))) {
    add(
      'invalid_component_id',
      'affected_component_ids',
      'must contain only stable component IDs.',
    );
  }
  if (typeof record.summary !== 'string' || record.summary.trim() === '')
    add('missing_summary', 'summary', 'is required.');
  if (!isDate(record.date_checked))
    add('invalid_timestamp', 'date_checked', 'must be a parseable timestamp.');
  if (!Array.isArray(record.sources) || record.sources.length === 0)
    add('missing_provenance', 'sources', 'requires at least one source.');
  if (Array.isArray(record.sources)) {
    const sourceIds = new Set<string>();
    record.sources.forEach((source, index) => {
      if (!source || typeof source !== 'object')
        return add('invalid_source', `sources[${index}]`, 'must be an object.');
      const sourceRecord = source as Record<string, unknown>;
      if (!isStableId(sourceRecord.id))
        add('invalid_source_id', `sources[${index}].id`, 'must be a stable ID.');
      if (typeof sourceRecord.id === 'string' && sourceIds.has(sourceRecord.id))
        add('duplicate_source_id', `sources[${index}].id`, 'is duplicated deterministically.');
      if (typeof sourceRecord.id === 'string') sourceIds.add(sourceRecord.id);
      if (!isDate(sourceRecord.date_checked))
        add('invalid_timestamp', `sources[${index}].date_checked`, 'must be parseable.');
    });
  }
  if (record.publication_date !== undefined && !isDate(record.publication_date))
    add('invalid_timestamp', 'publication_date', 'must be parseable.');
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: record as unknown as EvidenceRecord };
};

export const validateAdvisoryRecord = (
  input: unknown,
  evidenceIds?: ReadonlySet<string>,
):
  | { ok: true; value: AdvisoryRecord }
  | { ok: false; errors: readonly AdvisoryValidationProblem[] } => {
  const errors: AdvisoryValidationProblem[] = [];
  if (!input || typeof input !== 'object')
    return {
      ok: false,
      errors: [{ code: 'invalid_record', path: '', message: 'Advisory must be an object.' }],
    };
  const inputRecord = input as Record<string, unknown>;
  const legacyStatus: Record<string, AdvisoryLifecycleStatus> = {
    draft: 'monitoring',
    open: 'active',
  };
  const legacySeverity: Record<string, AdvisorySeverity> = {
    info: 'informational',
    watch: 'low',
    advisory: 'moderate',
    critical: 'critical',
  };
  const legacyAction: Record<string, AdvisoryPolicyAction> = {
    warn: 'caution',
    suppress_default: 'suppress_recommendation',
  };
  const affectedComponentIds = Array.isArray(inputRecord.affected_component_ids)
    ? inputRecord.affected_component_ids
    : Array.isArray(inputRecord.affected)
      ? inputRecord.affected
          .map((item) =>
            item && typeof item === 'object'
              ? (item as Record<string, unknown>).component_id
              : undefined,
          )
          .filter((id): id is string => typeof id === 'string')
      : [];
  const reviewDate =
    inputRecord.review &&
    typeof inputRecord.review === 'object' &&
    typeof (inputRecord.review as Record<string, unknown>).last_reviewed === 'string'
      ? (inputRecord.review as Record<string, unknown>).last_reviewed
      : undefined;
  const record = {
    ...inputRecord,
    affected_component_ids: affectedComponentIds,
    status:
      typeof inputRecord.status === 'string'
        ? (legacyStatus[inputRecord.status] ?? inputRecord.status)
        : inputRecord.status,
    severity:
      typeof inputRecord.severity === 'string'
        ? (legacySeverity[inputRecord.severity] ?? inputRecord.severity)
        : inputRecord.severity,
    policy_action:
      typeof inputRecord.policy_action === 'string'
        ? inputRecord.policy_action
        : typeof inputRecord.recommendation_effect === 'string'
          ? (legacyAction[inputRecord.recommendation_effect] ?? inputRecord.recommendation_effect)
          : inputRecord.policy_action,
    confidence: inputRecord.confidence ?? 'low',
    created_at: inputRecord.created_at ?? reviewDate,
    updated_at: inputRecord.updated_at ?? reviewDate,
  } as Record<string, unknown>;
  const add = (code: string, path: string, message: string) => errors.push({ code, path, message });
  if (!isStableId(record.id)) add('invalid_id', 'id', 'must be a stable non-empty ID.');
  if (!advisoryStatuses.has(record.status as AdvisoryLifecycleStatus))
    add('invalid_advisory_status', 'status', 'must be a supported advisory lifecycle status.');
  if (!advisorySeverities.has(record.severity as AdvisorySeverity))
    add('invalid_severity', 'severity', 'must be a supported severity.');
  if (!advisoryConfidences.has(record.confidence as AdvisoryConfidence))
    add('invalid_confidence', 'confidence', 'must be a supported confidence.');
  if (!policyActions.has(record.policy_action as AdvisoryPolicyAction))
    add('invalid_policy_action', 'policy_action', 'must be a supported policy action.');
  if (
    !Array.isArray(record.affected_component_ids) ||
    record.affected_component_ids.some((id) => !isStableId(id))
  )
    add('invalid_component_id', 'affected_component_ids', 'must contain stable component IDs.');
  if (!Array.isArray(record.evidence_ids))
    add('invalid_evidence_ids', 'evidence_ids', 'must be an array.');
  else
    record.evidence_ids.forEach((id, index) => {
      if (!isStableId(id))
        add('invalid_evidence_id', `evidence_ids[${index}]`, 'must be a stable ID.');
      else if (evidenceIds && !evidenceIds.has(id))
        add(
          'missing_evidence_reference',
          `evidence_ids[${index}]`,
          `evidence '${id}' is not loaded.`,
        );
    });
  for (const field of ['created_at', 'updated_at'])
    if (!isDate(record[field])) add('invalid_timestamp', field, 'must be parseable.');
  if (
    isDate(record.created_at) &&
    isDate(record.updated_at) &&
    Date.parse(record.updated_at) < Date.parse(record.created_at)
  )
    add('timestamp_order', 'updated_at', 'must not be earlier than created_at.');
  if (record.review_after !== undefined && !isDate(record.review_after))
    add('invalid_timestamp', 'review_after', 'must be parseable.');
  if (record.next_review_at !== undefined && !isDate(record.next_review_at))
    add('invalid_timestamp', 'next_review_at', 'must be parseable.');
  if (record.supersedes === record.id || record.superseded_by === record.id)
    add('self_supersedes', 'supersedes', 'must not self-reference.');
  if (typeof record.summary !== 'string' || record.summary.trim() === '')
    add('missing_summary', 'summary', 'is required.');
  if (typeof record.rationale !== 'string' || record.rationale.trim() === '')
    add('missing_rationale', 'rationale', 'is required.');
  if (
    record.policy_action !== 'none' &&
    (!Array.isArray(record.evidence_ids) || record.evidence_ids.length === 0)
  )
    add(
      'missing_influential_provenance',
      'evidence_ids',
      'influential advisories require evidence.',
    );
  errors.push(
    ...validateReviewedDecision(record.reviewed_decision, record.created_at, record.updated_at),
  );
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: record as unknown as AdvisoryRecord };
};

export const validateAdvisoryCollection = (
  advisories: readonly unknown[],
  evidence: readonly EvidenceRecord[] = [],
): readonly AdvisoryValidationProblem[] => {
  const problems: AdvisoryValidationProblem[] = [];
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const advisoryIds = new Set<string>();
  advisories.forEach((item, index) => {
    const id =
      item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string'
        ? ((item as Record<string, unknown>).id as string)
        : `index-${index}`;
    if (advisoryIds.has(id))
      problems.push({
        code: 'duplicate_advisory_id',
        path: `[${index}].id`,
        message: `duplicate advisory '${id}'.`,
      });
    advisoryIds.add(id);
    const result = validateAdvisoryRecord(item, evidenceIds);
    if (!result.ok)
      problems.push(
        ...result.errors.map((error) => ({
          ...error,
          path: `[${index}]${error.path ? `.${error.path}` : ''}`,
        })),
      );
  });
  return problems;
};

export const validateEvidenceCollection = (
  evidence: readonly unknown[],
): readonly AdvisoryValidationProblem[] => {
  const problems: AdvisoryValidationProblem[] = [];
  const ids = new Set<string>();
  evidence.forEach((item, index) => {
    const result = validateEvidenceRecord(item);
    if (!result.ok) {
      problems.push(
        ...result.errors.map((error) => ({
          ...error,
          path: `[${index}]${error.path ? `.${error.path}` : ''}`,
        })),
      );
      return;
    }
    if (ids.has(result.value.id)) {
      problems.push({
        code: 'duplicate_evidence_id',
        path: `[${index}].id`,
        message: `duplicate evidence '${result.value.id}'.`,
      });
    }
    ids.add(result.value.id);
  });
  return problems;
};

export const assessAdvisory = (
  advisory: AdvisoryRecord,
  evidence: readonly EvidenceRecord[],
): AdvisoryAssessment => {
  const activeEvidence = evidence.filter(
    (item) =>
      advisory.evidence_ids.includes(item.id) &&
      item.status === 'active' &&
      item.verification_status !== 'retracted' &&
      item.verification_status !== 'superseded',
  );
  const reasons: string[] = [];
  if (activeEvidence.length === 0)
    return {
      status: 'needs_review',
      severity: advisory.severity,
      confidence: 'low',
      policy_action: 'none',
      reasons: ['insufficient_evidence'],
      evidence_ids: [],
    };
  const onlyNonConfirming = activeEvidence.every((item) =>
    [
      'litigation',
      'community_report',
      'forum_report',
      'social_media_report',
      'news_report',
    ].includes(item.type),
  );
  if (onlyNonConfirming) {
    reasons.push('non_confirming_sources_require_human_review');
    const cappedAction: AdvisoryPolicyAction =
      advisory.policy_action === 'none'
        ? 'none'
        : advisory.policy_action === 'inform'
          ? 'inform'
          : 'caution';
    return {
      status: 'needs_review',
      severity: advisory.severity,
      confidence: 'low',
      policy_action: cappedAction,
      reasons,
      evidence_ids: activeEvidence.map((item) => item.id),
    };
  }
  const independentSources = technicalEvidenceSourceKeys(activeEvidence);
  const confidence: AdvisoryConfidence = independentSources.size > 0 ? 'high' : 'medium';
  reasons.push(
    independentSources.size >= 2
      ? 'independent_technical_sources_corroborate_at_high_confidence'
      : independentSources.size === 1
        ? 'verified_or_corroborated_technical_evidence'
        : 'evidence_requires_review',
  );
  return {
    status: confidence === 'high' ? 'sufficient' : 'needs_review',
    severity: advisory.severity,
    confidence,
    policy_action: advisory.policy_action,
    reasons,
    evidence_ids: activeEvidence.map((item) => item.id),
  };
};

export const evaluateComponentAdvisories = (
  componentId: string,
  advisories: readonly AdvisoryRecord[],
  evidence: readonly EvidenceRecord[],
  evaluatedAt: string,
  configuration: AdvisoryPolicyConfiguration = {},
): ComponentAdvisoryEvaluation => {
  const problems: AdvisoryValidationProblem[] = [];
  if (!isStableId(componentId))
    problems.push({
      code: 'unresolved_component_reference',
      path: 'componentId',
      message: 'component ID is not stable.',
    });
  if (!isDate(evaluatedAt))
    problems.push({
      code: 'invalid_evaluation_timestamp',
      path: 'evaluatedAt',
      message: 'must be parseable.',
    });
  const applicable = advisories.filter((advisory) =>
    advisory.affected_component_ids.includes(componentId),
  );
  // Negative or non-finite grace periods are normalized to 0 (no grace) rather than rejected,
  // so a malformed configuration value cannot silently mask an overdue review.
  const reviewDueGraceDays =
    typeof configuration.reviewDueGraceDays === 'number' &&
    Number.isFinite(configuration.reviewDueGraceDays) &&
    configuration.reviewDueGraceDays > 0
      ? configuration.reviewDueGraceDays
      : 0;
  let action: AdvisoryPolicyAction = 'none';
  let severity: AdvisorySeverity = 'informational';
  let confidence: AdvisoryConfidence = 'low';
  let stale = false;
  let reviewDue = false;
  const warnings: string[] = [];
  const reasons: string[] = [];
  const trace = [];
  for (const advisory of applicable) {
    const validation = validateAdvisoryRecord(advisory, new Set(evidence.map((item) => item.id)));
    if (!validation.ok) problems.push(...validation.errors);
    // A malformed reviewed_decision must never become effective policy; fall back to the
    // automatic assessment when validation fails.
    const reviewedDecision =
      advisory.reviewed_decision !== undefined && isReviewedDecisionValid(advisory)
        ? advisory.reviewed_decision
        : undefined;
    const assessment = assessAdvisory(advisory, evidence);
    const reviewedAction = reviewedDecision?.policy_action ?? assessment.policy_action;
    const effectiveLifecycleStatus = reviewedDecision?.status ?? advisory.status;
    const lifecycleAction =
      effectiveLifecycleStatus === 'resolved'
        ? (configuration.resolvedPolicyAction ?? 'none')
        : effectiveLifecycleStatus === 'withdrawn'
          ? (configuration.withdrawnPolicyAction ?? 'none')
          : effectiveLifecycleStatus === 'superseded'
            ? (configuration.supersededPolicyAction ?? 'none')
            : reviewedAction;
    if (policyRank[lifecycleAction] > policyRank[action]) action = lifecycleAction;
    const effectiveSeverity = reviewedDecision?.severity ?? advisory.severity;
    const effectiveConfidence = reviewedDecision?.confidence ?? assessment.confidence;
    if (severityRank[effectiveSeverity] > severityRank[severity]) severity = effectiveSeverity;
    if (confidenceRank[effectiveConfidence] > confidenceRank[confidence])
      confidence = effectiveConfidence;
    if (
      configuration.staleAfterDays !== undefined &&
      daysBetween(advisory.updated_at, evaluatedAt) > configuration.staleAfterDays
    ) {
      stale = true;
      warnings.push(`${advisory.id}:stale`);
    }
    const referencedEvidence = evidence.filter((item) => advisory.evidence_ids.includes(item.id));
    if (
      configuration.evidenceStaleAfterDays !== undefined &&
      referencedEvidence.some(
        (item) =>
          daysBetween(item.date_checked, evaluatedAt) > configuration.evidenceStaleAfterDays!,
      )
    ) {
      stale = true;
      warnings.push(`${advisory.id}:evidence_stale`);
    }
    const dueAt = advisory.next_review_at ?? advisory.review_after;
    if (dueAt && isDate(dueAt) && daysBetween(dueAt, evaluatedAt) >= reviewDueGraceDays) {
      reviewDue = true;
      warnings.push(`${advisory.id}:review_due`);
    }
    if (assessment.status === 'needs_review') reasons.push(`${advisory.id}:needs_review`);
    trace.push({ advisory_id: advisory.id, evidence_ids: assessment.evidence_ids });
  }
  if (applicable.length > 0 && action !== 'none') warnings.push(`policy:${action}`);
  return {
    component_id: componentId,
    applicable_advisory_ids: applicable.map((advisory) => advisory.id),
    effective_policy_action: action,
    effective_severity: severity,
    effective_confidence: confidence,
    eligible: action !== 'exclude' && action !== 'suppress_recommendation',
    warnings: [...new Set(warnings)],
    reasons,
    stale,
    review_due: reviewDue,
    trace,
    problems,
  };
};
