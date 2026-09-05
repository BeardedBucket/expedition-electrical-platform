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

export interface SourceReference {
  readonly id: string;
  readonly title: string;
  readonly uri?: string;
  readonly note?: string;
}

export interface DeratingInput {
  readonly id: string;
  readonly factor: number;
  readonly sourceReferences: readonly SourceReference[];
}

export interface AmpacityRecord {
  readonly conductorGauge: string;
  readonly installationConditionId: string;
  readonly baseAmpacityA: number;
  readonly deratingInputs: readonly DeratingInput[];
  readonly sourceReferences: readonly SourceReference[];
}

export interface StandardsDataProfile {
  readonly id: string;
  readonly version: string;
  readonly status: DatasetStatus;
  readonly sources: readonly SourceReference[];
  readonly resistancePerLengthOhmPerM?: Readonly<Record<string, number>>;
  readonly ampacityRecords?: readonly AmpacityRecord[];
}

export interface LoadRequirement {
  readonly id: string;
  readonly name: string;
  readonly powerW?: number;
  readonly quantity?: number;
}

export interface Requirements {
  readonly systemVoltageV: number;
  readonly loads: readonly LoadRequirement[];
}

export interface ComponentRecord {
  readonly id: string;
  readonly verificationStatus: 'unverified' | 'partially_verified' | 'verified';
  readonly engineeringStatus?: 'compatible' | 'incompatible' | 'unknown';
  readonly advisoryRefs?: readonly string[];
}

export type BuilderInventoryMode = 'unrestricted' | 'allowlist' | 'denylist';

export interface BuilderTrackingMetadata {
  readonly sourceKey?: string;
  readonly campaignDefault?: string | null;
  readonly [key: string]: unknown;
}

export type BuilderCatalogAvailability =
  'stocked' | 'special_order' | 'unavailable' | 'discontinued' | 'unknown';

export type BuilderPreference = 'preferred' | 'standard' | 'discouraged';

export interface BuilderCatalogEntry {
  readonly component_id: string;
  readonly availability: BuilderCatalogAvailability;
  readonly preference: BuilderPreference;
  readonly builder_price?: number | null;
  readonly currency?: string | null;
  readonly lead_time_days?: number | null;
  readonly lead_time_text?: string | null;
  readonly sku?: string | null;
  readonly last_checked_at?: string | null;
  readonly notes?: string | null;
}

export interface BuilderProfile {
  readonly builderId: string;
  readonly displayName: string;
  readonly website?: string | null;
  readonly inquiryUrl?: string | null;
  readonly regions?: readonly string[];
  readonly services?: readonly string[];
  readonly inventoryMode: BuilderInventoryMode;
  readonly inventoryComponentIds?: readonly string[];
  readonly preferredComponentIds?: readonly string[];
  readonly preferredManufacturers?: readonly string[];
  readonly supportedSystemVoltagesV?: readonly number[];
  readonly catalog?: readonly BuilderCatalogEntry[];
  readonly tracking?: BuilderTrackingMetadata;
}

export interface RuleSetMetadata extends DatasetVersion {
  readonly description: string;
}

export interface DemoData {
  readonly versions: DatasetVersions;
  readonly components: readonly ComponentRecord[];
  readonly builders: readonly BuilderProfile[];
  readonly advisories: readonly AdvisoryRecord[];
  readonly evidence?: readonly EvidenceRecord[];
  readonly ruleSet: RuleSetMetadata;
}

export type CalculationFailureCode = 'invalid_input' | 'insufficient_data';

export interface CalculationFailure {
  readonly ok: false;
  readonly code: CalculationFailureCode;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
}

export interface CalculationSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly warnings: readonly string[];
}

export type CalculationResult<T> = CalculationSuccess<T> | CalculationFailure;

export interface DirectPowerCurrentInput {
  readonly powerW: number;
  readonly voltageV: number;
}

export interface DirectPowerCurrentResult {
  readonly currentA: number;
  readonly powerW: number;
  readonly voltageV: number;
}

export interface ConversionPowerCurrentInput {
  readonly powerW: number;
  readonly voltageV: number;
  readonly efficiency: number;
}

export interface ConversionPowerCurrentResult {
  readonly currentA: number;
  readonly inputPowerW: number;
  readonly outputPowerW: number;
  readonly voltageV: number;
  readonly efficiency: number;
}

export interface DirectCurrentPowerInput {
  readonly currentA: number;
  readonly voltageV: number;
}

export interface DirectCurrentPowerResult {
  readonly powerW: number;
  readonly currentA: number;
  readonly voltageV: number;
}

export interface ConversionCurrentPowerInput {
  readonly currentA: number;
  readonly voltageV: number;
  readonly efficiency: number;
}

export interface ConversionCurrentPowerResult {
  readonly inputPowerW: number;
  readonly outputPowerW: number;
  readonly currentA: number;
  readonly voltageV: number;
  readonly efficiency: number;
}

export interface RoundTripLengthInput {
  readonly oneWayLengthM: number;
  readonly roundTrip?: boolean;
}

export interface ConductorInput {
  readonly currentA: number;
  readonly nominalVoltageV: number;
  readonly oneWayLengthM: number;
  readonly resistanceOhmPerM: number;
  readonly roundTrip?: boolean;
}

export interface ConductorResult {
  readonly effectiveLengthM: number;
  readonly resistanceOhm: number;
  readonly voltageDropV: number;
  readonly powerLossW: number;
  readonly percentVoltageDrop: number;
}

export interface WireCandidate {
  readonly id: string;
  readonly gauge: string;
  readonly resistanceOhmPerM?: number;
}

export interface WireConstraints {
  readonly currentA: number;
  readonly systemVoltageV: number;
  readonly oneWayLengthM: number;
  readonly installationConditionId?: string;
  readonly maximumPercentVoltageDrop?: number;
  readonly requiredAmpacityA?: number;
  readonly requiredChecks?: readonly ('ampacity' | 'voltageDrop')[];
  readonly roundTrip?: boolean;
}

export interface WireCandidateEvaluation {
  readonly candidateId: string;
  readonly gauge: string;
  readonly eligible: boolean;
  readonly ampacity: {
    readonly required: boolean;
    readonly passes: boolean;
    readonly availableA?: number;
  };
  readonly voltageDrop: {
    readonly required: boolean;
    readonly passes: boolean;
    readonly percent?: number;
  };
  readonly reasons: readonly string[];
}

export type SystemPowerBasis = 'direct-source' | 'converted-load';

export interface SystemVoltageComparisonInput {
  readonly powerW: number;
  readonly powerBasis: SystemPowerBasis;
  readonly conversionEfficiency?: number;
}

export interface VoltageCandidate {
  readonly id: string;
  readonly voltageV: number;
}

export interface VoltageCandidateComparison extends VoltageCandidate {
  readonly sourcePowerW: number;
  readonly currentA: number;
}

export interface TraceStep {
  readonly id: string;
  readonly status: 'complete' | 'empty' | 'skipped' | 'failed';
  readonly summary: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
}

export interface DecisionTrace {
  readonly inputs: unknown;
  readonly calculationSteps: readonly TraceStep[];
  readonly ruleIds: readonly { id: string; version: string }[];
  readonly standardsProfile?: DatasetVersion;
  readonly results: unknown;
  readonly warnings: readonly string[];
  readonly insufficientDataReasons: readonly string[];
  readonly sourceReferences: readonly SourceReference[];
  readonly inputFingerprint: string;
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
  readonly engineeringStatus?: 'compatible' | 'incompatible' | 'unknown';
  readonly advisory?: ComponentAdvisoryEvaluation;
}

export interface RecommendationResult {
  readonly recommendations: readonly Recommendation[];
  readonly inspectableAdvisoryCandidates?: readonly Recommendation[];
  readonly trace: TraceMetadata;
}
import type { AdvisoryRecord, ComponentAdvisoryEvaluation, EvidenceRecord } from './advisory.js';
