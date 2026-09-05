export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ProductSourceType =
  | 'manufacturer_product_page'
  | 'manufacturer_datasheet'
  | 'manufacturer_manual'
  | 'manufacturer_drawing'
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

export interface ProductFact {
  readonly schema_version: string;
  readonly id: string;
  readonly source_id: string;
  readonly field: string;
  readonly raw_label: string;
  readonly raw_value: JsonValue;
  readonly raw_unit?: string;
  readonly normalized_value?: JsonValue;
  readonly normalized_unit?: string;
  readonly source_locator?: SourceLocator;
  readonly extraction_method: ExtractionMethod;
  readonly transformation_notes?: string;
  readonly review_required?: boolean;
  readonly notes?: string;
  readonly fact_state: FactState;
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
  readonly review_reasons?: readonly string[];
  readonly notes?: string;
}
