export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

type RequireAtLeastOne<T> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Omit<T, K>;
}[keyof T];

type PowerConsumptionContext = {
  readonly supply_voltage_v?: number;
  readonly measurement_basis?: 'typical' | 'nominal' | 'maximum' | 'minimum' | 'quiescent';
  readonly electrical_domain?: 'ac' | 'dc';
};

/** Nonempty source conditions; whole-device off cannot have its display on. */
export type PowerConsumptionQualifiers =
  | RequireAtLeastOne<
      PowerConsumptionContext & {
        readonly operating_state?: 'idle' | 'standby' | 'sleep' | 'active';
        readonly display?:
          | { readonly state: 'off' }
          | { readonly state: 'on'; readonly brightness_percent?: number };
      }
    >
  | RequireAtLeastOne<
      PowerConsumptionContext & {
        readonly operating_state: 'off';
        readonly display?: { readonly state: 'off' };
      }
    >;

/** Mirrors the target-discriminated canonical component schema. */
export type CanonicalQualifiedValue = JsonObject &
  (
    | SourceRatingQualifiedValue
    | {
        readonly id: string;
        readonly target: 'electrical.input_voltage_range_v';
        readonly value: { readonly min: number; readonly max: number };
        readonly qualifiers: { readonly electrical_domain: 'ac' | 'dc' };
      }
    | {
        readonly id: string;
        readonly target: 'electrical.power_consumption_w';
        readonly value: number;
        readonly qualifiers: PowerConsumptionQualifiers;
      }
    | {
        readonly id: string;
        readonly target: 'dimensions_mm';
        readonly value: { readonly x: number; readonly y: number; readonly z: number };
        readonly qualifiers: {
          readonly physical_scope: {
            readonly kind: 'physical_body';
            readonly exclusions: readonly ('connectors' | 'mounting_accessories')[];
          };
        };
      }
  );

export type SourceRatingTarget =
  | 'dimensions_mm.x'
  | 'dimensions_mm.y'
  | 'dimensions_mm.z'
  | 'electrical.output_current_a'
  | 'electrical.input_current_a'
  | 'electrical.charge_current_a'
  | 'electrical.discharge_current_a'
  | 'electrical.output_voltage_v'
  | 'electrical.input_voltage_v'
  | 'electrical.operating_power_w'
  | 'electrical.output_power_w'
  | 'electrical.peak_power_w'
  | 'electrical.apparent_power_va'
  | 'electrical.frequency_hz'
  | 'electrical.pv_open_circuit_voltage_v'
  | 'electrical.idle_current_a'
  | 'electrical.standby_current_a'
  | 'electrical.conditioned_consumption_w'
  | 'efficiency_fraction'
  | 'weight_kg'
  | 'electrical.nominal_voltage_v'
  | 'electrical.continuous_power_w'
  | 'electrical.rated_power_w'
  | 'battery.nominal_capacity_ah'
  | 'battery.nominal_energy_wh'
  | 'battery.charging_voltage_range_v'
  | 'battery.float_voltage_range_v';
export interface SourceRatingQualifiedValue {
  readonly id: string;
  readonly target: SourceRatingTarget;
  readonly value: number | { readonly min: number; readonly max: number };
  readonly qualifiers: import('./semantic-rules.js').SourceRatingQualifiers & {
    readonly kind: 'source_rating';
  };
}

export type ProductSourceType =
  | 'manufacturer_product_page'
  | 'manufacturer_datasheet'
  | 'manufacturer_manual'
  | 'manufacturer_drawing'
  | 'manufacturer_certificate'
  | 'manufacturer_cad_metadata'
  | 'manufacturer_support_article'
  | 'manufacturer_api'
  | 'manufacturer_feed'
  | 'authorized_distributor'
  | 'reseller'
  | 'community'
  | 'other';

export type SourceAuthority =
  | 'manufacturer_technical'
  | 'manufacturer_product'
  | 'manufacturer_support'
  | 'authorized_distributor'
  | 'secondary_distributor'
  | 'community_or_social'
  | 'unknown';

export type ProductLifecycleStatus = 'active' | 'discontinued' | 'unknown' | 'replaced';
export type SourceApplicability =
  'direct_identity' | 'explicitly_reviewed' | 'not_applicable' | 'unresolved';

export interface ProductIdentityClaim {
  readonly manufacturer?: string;
  readonly product_family?: string;
  readonly model?: string;
  readonly manufacturer_part_number?: string;
  readonly regional_variant?: string;
  readonly voltage_variant?: string;
  readonly hardware_revision?: string;
  readonly lifecycle_status?: ProductLifecycleStatus;
}

export interface ProductSource {
  readonly schema_version: string;
  readonly id: string;
  readonly uri: string;
  readonly source_type: ProductSourceType;
  readonly authority: SourceAuthority;
  readonly publisher: string;
  readonly retrieved_at: string;
  readonly manufacturer?: string;
  readonly title?: string;
  readonly document_revision?: string;
  readonly publication_date?: string;
  readonly content_hash?: string;
  readonly applicability?: SourceApplicability;
  readonly applicability_reason?: string;
  readonly applies_to?: readonly string[];
  readonly product_identity_claim?: ProductIdentityClaim;
  readonly redistribution_status?: 'unknown' | 'link_only' | 'permitted';
  readonly notes?: string;
}

export type ExtractionMethod = 'structured' | 'table' | 'text' | 'manual' | 'ai_assisted' | 'other';
export type FactState = 'verified' | 'provisional' | 'unresolved' | 'conflicting';

export interface SourceLocator {
  readonly page?: number;
  readonly section?: string;
  readonly table?: string;
  readonly row?: string;
  readonly paragraph?: string;
  readonly fragment?: string;
}

export type TopologyTargetKind =
  | 'capability'
  | 'port'
  | 'power_path'
  | 'connection_point'
  | 'conductive_relationship'
  | 'switching_configuration'
  | 'protection_instance'
  | 'measurement_instance'
  | 'interaction_endpoint'
  | 'physical_connector'
  | 'physical_connector_association'
  | 'isolation_relationship';

export interface TopologyTarget {
  readonly kind: TopologyTargetKind;
  readonly id: string;
  readonly field?: string;
}

export interface ConstraintTarget {
  readonly kind: 'conductive_relationship';
  readonly id: string;
  readonly field: string;
}

export interface ProductFact {
  readonly human_source?: import('./production-contracts.js').QualifiedFactArtifact;
  /** Retained evidence for replay of a generic rule, independent from product approval. */
  readonly semantic_source?: {
    readonly fact: import('./production-contracts.js').QualifiedFactArtifact;
    readonly context_facts: readonly import('./production-contracts.js').QualifiedFactArtifact[];
    readonly assertion: import('./semantic-rules.js').SemanticAssertion;
  };
  readonly schema_version: string;
  readonly id: string;
  readonly source_id: string;
  readonly field: string;
  readonly raw_label: string;
  readonly raw_value: JsonValue;
  readonly raw_unit?: string;
  readonly normalized_value?: JsonValue;
  readonly normalized_unit?: string;
  readonly normalization?: ProductFactNormalization;
  readonly qualified_value?: CanonicalQualifiedValue;
  readonly source_locator?: SourceLocator;
  readonly extraction_method: ExtractionMethod;
  readonly transformation_notes?: string;
  /** Present only for a calculated value; raw_value then records the calculation output. */
  readonly derivation?: ProductDerivation;
  readonly review_required?: boolean;
  readonly notes?: string;
  readonly fact_state: FactState;
  readonly topology_target?: TopologyTarget;
  readonly target?: ConstraintTarget;
}

/** Typed transform metadata; source and result values remain on their owning fact. */
export interface ProductFactNormalization {
  readonly method: 'unit_conversion' | 'semantic_normalization';
  readonly source_unit?: string;
  readonly normalized_unit?: string;
  readonly method_version: string;
}

export type IdentityStatus = 'verified' | 'provisional' | 'unresolved' | 'conflicting';
export type CandidateReviewStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export type PromotionStatus = 'blocked' | 'review_required' | 'eligible';

export type ProductIdentity = ProductIdentityClaim;

export interface ProductCandidate {
  readonly schema_version: string;
  readonly id: string;
  readonly identity_status: IdentityStatus;
  readonly identity: ProductIdentity;
  readonly review_status: CandidateReviewStatus;
  readonly promotion_status: PromotionStatus;
  readonly source_ids: readonly string[];
  readonly identity_source_ids: readonly string[];
  readonly fact_ids: readonly string[];
  readonly component_data: JsonObject;
  readonly field_evidence: Readonly<Record<string, readonly string[]>>;
  /** Calculated product values remain distinguishable from published assertions. */
  readonly derived_fields?: Readonly<Record<string, ProductDerivation>>;
  readonly qualified_value_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly topology_evidence?: Readonly<Record<string, readonly string[]>>;
  readonly review_reasons?: readonly string[];
  readonly notes?: string;
}

export interface SemanticProductDerivation {
  readonly status: 'derived';
  readonly rule_version: string;
  readonly formula: string;
  readonly input_targets: readonly string[];
  /** QualifiedFact IDs retained for source-level lineage. */
  readonly input_qualified_fact_ids?: readonly string[];
  readonly input_units: readonly string[];
  readonly output_unit: string;
  readonly assumptions: readonly string[];
}

export interface ProductDerivation extends SemanticProductDerivation {
  /** ProductFact IDs at the candidate/promotion boundary. */
  readonly input_fact_ids: readonly string[];
}

export const isSourceApplicable = (
  source: Pick<ProductSource, 'applicability'> | undefined,
  options: { readonly legacy_undefined_applicability?: boolean } = {
    legacy_undefined_applicability: false,
  },
): boolean => {
  if (!source) return false;
  if (source.applicability === undefined) {
    return options.legacy_undefined_applicability === true;
  }
  return (
    source.applicability === 'direct_identity' || source.applicability === 'explicitly_reviewed'
  );
};
