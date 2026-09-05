export type DatasetStatus = 'synthetic' | 'unverified' | 'reviewed';

export interface DatasetVersion {
  readonly id: string;
  readonly version: string;
  readonly status: DatasetStatus;
}

export interface DatasetVersions {
  readonly components: DatasetVersion;
  readonly builders: DatasetVersion;
  readonly advisories: DatasetVersion;
  readonly ruleSet: DatasetVersion;
}

export interface LoadRequirement {
  readonly id: string;
  readonly name: string;
  readonly powerW?: number;
  readonly quantity?: number;
}

/**
 * Requirements deliberately require a caller-selected voltage. There is no platform default.
 */
export interface Requirements {
  readonly systemVoltageV: number;
  readonly loads: readonly LoadRequirement[];
}

export interface ComponentRecord {
  readonly id: string;
  readonly verificationStatus: 'unverified' | 'partially_verified' | 'verified';
}

export interface BuilderProfile {
  readonly builderId: string;
}

export interface AdvisoryRecord {
  readonly id: string;
  readonly severity: 'info' | 'watch' | 'advisory' | 'critical';
}

export interface RuleSetMetadata extends DatasetVersion {
  readonly description: string;
}

export interface DemoData {
  readonly versions: DatasetVersions;
  readonly components: readonly ComponentRecord[];
  readonly builders: readonly BuilderProfile[];
  readonly advisories: readonly AdvisoryRecord[];
  readonly ruleSet: RuleSetMetadata;
}

export interface TraceStep {
  readonly id: string;
  readonly status: 'complete' | 'empty' | 'skipped';
  readonly summary: string;
}

export interface TraceMetadata {
  readonly inputFingerprint: string;
  readonly dataFingerprint: string;
  readonly ruleSet: DatasetVersion;
  readonly datasets: DatasetVersions;
  readonly steps: readonly TraceStep[];
}

export interface Recommendation {
  readonly id: string;
  readonly why: string;
}

export interface RecommendationResult {
  readonly recommendations: readonly Recommendation[];
  readonly trace: TraceMetadata;
}
