import type {
  ProductIdentity,
  ProductSourceType,
  SourceAuthority,
  ProductSource,
} from './contracts.js';
import { reconcileProductFacts } from './reconciliation.js';

export type PilotStage = 'identity' | 'specification';
export type PilotIdentityStatus = 'resolved' | 'unresolved' | 'conflicting';

export interface PilotSourceDefinition {
  readonly id: string;
  readonly uri: string;
  readonly source_type: ProductSourceType;
  readonly authority: SourceAuthority;
  readonly publisher: string;
  readonly source_role: 'identity' | 'specification' | 'mixed';
  readonly manufacturer?: string;
  readonly identity_claim?: Partial<ProductIdentity>;
  readonly extraction_hints?: {
    readonly focused_labels?: readonly string[];
    readonly unit_by_label?: Readonly<Record<string, string>>;
    readonly explicit_field_mappings?: Readonly<Record<string, string>>;
  };
  readonly replay_metadata?: {
    readonly source_id?: string;
    readonly content_hash?: string;
    readonly fragment?: string;
  };
}

export interface PilotConfig {
  readonly pilot_id: string;
  readonly candidate_id: string;
  readonly manufacturer_target?: string;
  readonly target_identity?: Partial<ProductIdentity>;
  readonly expected_product_role?: string;
  readonly expected_category?: string;
  readonly sources: readonly PilotSourceDefinition[];
  readonly identity_requirements: readonly (keyof ProductIdentity)[];
  readonly replay_artifact_metadata?: Readonly<Record<string, string>>;
  readonly identity_first_stage: PilotStage;
  readonly specification_stage: PilotStage;
  readonly allow_specification_without_identity?: boolean;
}

export interface PilotProgress {
  readonly status: PilotIdentityStatus;
  readonly can_proceed_to_specification: boolean;
  readonly required_fields: readonly (keyof ProductIdentity)[];
  readonly missing_fields: readonly (keyof ProductIdentity)[];
}

const requiredIdentityFields: readonly (keyof ProductIdentity)[] = [
  'manufacturer',
  'model',
  'manufacturer_part_number',
];

export const defaultIdentityRequirements = (): readonly (keyof ProductIdentity)[] =>
  requiredIdentityFields;

export const evaluatePilotIdentityProgress = (
  targetIdentity: Partial<ProductIdentity> | undefined,
  requiredFields: readonly (keyof ProductIdentity)[] = defaultIdentityRequirements(),
): PilotProgress => {
  const identity = targetIdentity ?? {};
  const missingFields = requiredFields.filter((field) => identity[field] === undefined);
  const resolved = requiredFields.every((field) => identity[field] !== undefined);
  return {
    status: resolved ? 'resolved' : 'unresolved',
    can_proceed_to_specification: resolved,
    required_fields: requiredFields,
    missing_fields: missingFields,
  };
};

export const evaluatePilotIdentityGate = (
  identity: ProductIdentity,
  sources: readonly ProductSource[],
  requiredFields: readonly (keyof ProductIdentity)[] = defaultIdentityRequirements(),
): PilotProgress => {
  const reconciliation = reconcileProductFacts({
    candidate_id: 'identity-gate',
    identity,
    sources,
    facts: [],
    normalized_facts: [],
  });
  const missingFields = requiredFields.filter((field) => identity[field] === undefined);
  const status =
    reconciliation.identity_status === 'conflicting'
      ? 'conflicting'
      : reconciliation.identity_status === 'verified' && missingFields.length === 0
        ? 'resolved'
        : 'unresolved';
  return {
    status,
    can_proceed_to_specification: status === 'resolved',
    required_fields: requiredFields,
    missing_fields: missingFields,
  };
};

export const createPilotDefinition = (
  config: Omit<PilotConfig, 'identity_first_stage' | 'specification_stage'> & {
    readonly identity_first_stage?: PilotStage;
    readonly specification_stage?: PilotStage;
  },
): PilotConfig => ({
  identity_first_stage: 'identity',
  specification_stage: 'specification',
  ...config,
});
