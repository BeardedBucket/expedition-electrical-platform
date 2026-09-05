import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import builderSchema from '../../../data/schemas/builder.schema.json' with { type: 'json' };
import type {
  BuilderCatalogAvailability,
  BuilderCatalogEntry,
  BuilderInventoryMode,
  BuilderPreference,
  BuilderProfile,
} from './contracts.js';

const builderSchemaData = builderSchema as Record<string, unknown>;
type JsonSchemaValidator = ((value: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }>;
};

const AjvCtor = Ajv2020 as unknown as new (options?: Record<string, unknown>) => {
  compile: (schema: unknown) => JsonSchemaValidator;
};
const ajv = new AjvCtor({ allErrors: true, strict: false, allowUnionTypes: true });
const registerFormats = addFormats as unknown as (instance: {
  addFormat?: (...args: unknown[]) => void;
}) => void;
registerFormats(ajv as unknown as { addFormat?: (...args: unknown[]) => void });
const validateBuilderSchema = ajv.compile(builderSchemaData);

const toStringList = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
};

const toNumberList = (value: unknown): readonly number[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  );
};

const normalizeStringField = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const normalizeAvailability = (value: unknown): BuilderCatalogAvailability => {
  switch (typeof value === 'string' ? value.trim().toLowerCase() : '') {
    case 'stocked':
      return 'stocked';
    case 'special_order':
    case 'special-order':
      return 'special_order';
    case 'unavailable':
      return 'unavailable';
    case 'discontinued':
      return 'discontinued';
    case 'unknown':
    case '':
      return 'unknown';
    default:
      return 'unknown';
  }
};

const normalizePreference = (value: unknown): BuilderPreference => {
  switch (typeof value === 'string' ? value.trim().toLowerCase() : '') {
    case 'preferred':
      return 'preferred';
    case 'standard':
      return 'standard';
    case 'discouraged':
      return 'discouraged';
    default:
      return 'standard';
  }
};

const normalizeCurrency = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return value === null ? null : undefined;
  if (typeof value !== 'string') return undefined;
  const tag = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(tag) ? tag : undefined;
};

const normalizeCatalogEntry = (entry: unknown, index: number): BuilderCatalogEntry => {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`catalog[${index}]: must be an object.`);
  }

  const record = entry as Record<string, unknown>;
  const componentId =
    normalizeStringField(record.component_id ?? record.componentId) ??
    normalizeStringField(record.id ?? record.componentID);
  if (!componentId || componentId.length === 0) {
    throw new Error(`catalog[${index}].component_id: must be a non-empty string.`);
  }

  const availability = normalizeAvailability(
    record.availability ?? record.availabilityStatus ?? record.status,
  );
  const preference = normalizePreference(
    record.preference ?? record.preferenceLevel ?? record.priority,
  );

  const rawPrice =
    typeof record.builder_price === 'number'
      ? record.builder_price
      : typeof record.builderPrice === 'number'
        ? record.builderPrice
        : undefined;
  if (rawPrice !== undefined && (!Number.isFinite(rawPrice) || rawPrice < 0)) {
    throw new Error(
      `catalog[${index}].builder_price: must be a finite number greater than or equal to 0.`,
    );
  }

  const leadTimeDays =
    typeof record.lead_time_days === 'number'
      ? record.lead_time_days
      : typeof record.leadTimeDays === 'number'
        ? record.leadTimeDays
        : undefined;
  if (leadTimeDays !== undefined && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0)) {
    throw new Error(`catalog[${index}].lead_time_days: must be a non-negative integer.`);
  }

  const currency = normalizeCurrency(record.currency ?? record.currencyCode);
  if (currency !== undefined && currency !== null && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`catalog[${index}].currency: must be a three-letter ISO currency code.`);
  }

  return {
    component_id: componentId,
    availability,
    preference,
    builder_price: rawPrice,
    currency: currency ?? null,
    lead_time_days: leadTimeDays,
    lead_time_text:
      typeof record.lead_time_text === 'string'
        ? record.lead_time_text
        : typeof record.leadTimeText === 'string'
          ? record.leadTimeText
          : null,
    sku: typeof record.sku === 'string' ? record.sku : null,
    last_checked_at:
      typeof record.last_checked_at === 'string'
        ? record.last_checked_at
        : typeof record.lastCheckedAt === 'string'
          ? record.lastCheckedAt
          : null,
    notes: typeof record.notes === 'string' ? record.notes : null,
  };
};

export type BuilderAttributionState =
  | { readonly kind: 'generic' }
  | { readonly kind: 'resolved'; readonly builderId: string }
  | { readonly kind: 'unresolved'; readonly builderId: string };

export interface BuilderCatalogCandidate {
  readonly id: string;
  readonly eligible?: boolean;
  readonly engineeringEligible?: boolean;
  readonly safetyEligible?: boolean;
  readonly advisoryEligible?: boolean;
  readonly status?: 'eligible' | 'ineligible' | 'unknown';
}

export interface BuilderCatalogOutcomeItem {
  readonly componentId: string;
  readonly availability?: BuilderCatalogAvailability;
  readonly preference?: BuilderPreference;
  readonly status: 'eligible' | 'ineligible' | 'unknown';
  readonly reason: string;
  readonly explanation: string;
}

export interface BuilderOverlayOutcome {
  readonly status:
    'generic' | 'eligible' | 'ineligible' | 'unknown' | 'inventory_gap' | 'unresolved';
  readonly attribution: BuilderAttributionState;
  readonly candidates: readonly BuilderCatalogOutcomeItem[];
  readonly rankedCandidates: readonly BuilderCatalogOutcomeItem[];
  readonly builderId?: string;
}

const isGlobalCandidateEligible = (candidate: BuilderCatalogCandidate): boolean => {
  if (candidate.eligible === false) return false;
  if (candidate.engineeringEligible === false) return false;
  if (candidate.safetyEligible === false) return false;
  if (candidate.advisoryEligible === false) return false;
  if (candidate.status === 'ineligible') return false;
  if (candidate.status === 'unknown') return false;
  return true;
};

const rankCandidate = (item: BuilderCatalogOutcomeItem): number => {
  if (item.status !== 'eligible') return 999;
  const availabilityRank: Record<BuilderCatalogAvailability, number> = {
    stocked: 0,
    special_order: 2,
    unavailable: 6,
    discontinued: 6,
    unknown: 7,
  };
  const preferenceRank: Record<BuilderPreference, number> = {
    preferred: 0,
    standard: 1,
    discouraged: 5,
  };
  const availability = item.availability ?? 'unknown';
  const preference = item.preference ?? 'standard';
  if (preference === 'discouraged') return 5;
  if (availability === 'unknown') return 7;
  return availabilityRank[availability] + preferenceRank[preference];
};

const sortCatalogResults = (
  results: readonly BuilderCatalogOutcomeItem[],
): readonly BuilderCatalogOutcomeItem[] =>
  [...results].sort((left, right) => {
    const leftRank = rankCandidate(left);
    const rightRank = rankCandidate(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.componentId.localeCompare(right.componentId);
  });

export const evaluateBuilderAttribution = (
  attribution: BuilderAttributionState,
): {
  readonly status: 'generic' | 'resolved' | 'unresolved';
  readonly destination: string;
  readonly builderId?: string;
} => {
  if (attribution.kind === 'generic') {
    return { status: 'generic', destination: 'generic/default' };
  }
  if (attribution.kind === 'resolved') {
    return {
      status: 'resolved',
      destination: attribution.builderId,
      builderId: attribution.builderId,
    };
  }
  return {
    status: 'unresolved',
    destination: 'unresolved/builder-id',
    builderId: attribution.builderId,
  };
};

export const routeBuilderInquiry = (
  attribution: BuilderAttributionState,
): {
  readonly status: 'generic' | 'resolved' | 'unresolved';
  readonly destination: string;
  readonly builderId?: string;
} => evaluateBuilderAttribution(attribution);

export const evaluateGenericBuilderMode = (
  candidates: readonly BuilderCatalogCandidate[],
): BuilderOverlayOutcome => {
  const eligible = candidates.filter(isGlobalCandidateEligible);
  return {
    status: 'generic',
    attribution: { kind: 'generic' },
    candidates: eligible.map((candidate) => ({
      componentId: candidate.id,
      status: 'eligible',
      reason: 'generic.mode',
      explanation: `The candidate ${candidate.id} is globally eligible and generic mode does not impose builder restrictions.`,
    })),
    rankedCandidates: eligible.map((candidate) => ({
      componentId: candidate.id,
      status: 'eligible',
      reason: 'generic.mode',
      explanation: `The candidate ${candidate.id} is globally eligible and generic mode does not impose builder restrictions.`,
    })),
  };
};

export const evaluateBuilderCatalogMode = (
  profile: BuilderProfile,
  candidates: readonly BuilderCatalogCandidate[],
  attribution: BuilderAttributionState = { kind: 'resolved', builderId: profile.builderId },
): BuilderOverlayOutcome => {
  if (attribution.kind === 'generic') {
    return evaluateGenericBuilderMode(candidates);
  }

  if (attribution.kind === 'unresolved') {
    return {
      status: 'unresolved',
      attribution,
      candidates: [],
      rankedCandidates: [],
      builderId: attribution.builderId,
    };
  }

  const globalEligible = candidates.filter(isGlobalCandidateEligible);
  if (globalEligible.length === 0) {
    return {
      status: 'ineligible',
      attribution,
      candidates: [],
      rankedCandidates: [],
      builderId: attribution.builderId,
    };
  }

  const catalogMap = new Map(
    (profile.catalog ?? []).map((entry) => [entry.component_id, entry] as const),
  );
  const evaluated = globalEligible.map((candidate) => {
    const catalogEntry = catalogMap.get(candidate.id);
    if (!catalogEntry) {
      return {
        componentId: candidate.id,
        status: 'unknown' as const,
        reason: 'builder.catalog_missing',
        explanation: `Builder ${profile.builderId} has no catalog entry for ${candidate.id}.`,
      };
    }

    switch (catalogEntry.availability) {
      case 'stocked':
        return {
          componentId: candidate.id,
          availability: 'stocked' as const,
          preference: catalogEntry.preference,
          status: 'eligible' as const,
          reason: 'builder.stocked',
          explanation: `The builder stocks ${candidate.id} and it remains eligible.`,
        };
      case 'special_order':
        return {
          componentId: candidate.id,
          availability: 'special_order' as const,
          preference: catalogEntry.preference,
          status: 'eligible' as const,
          reason: 'builder.special_order',
          explanation: `The builder can supply ${candidate.id} via special order.`,
        };
      case 'unavailable':
        return {
          componentId: candidate.id,
          availability: 'unavailable' as const,
          preference: catalogEntry.preference,
          status: 'ineligible' as const,
          reason: 'builder.unavailable',
          explanation: `The builder marks ${candidate.id} as unavailable.`,
        };
      case 'discontinued':
        return {
          componentId: candidate.id,
          availability: 'discontinued' as const,
          preference: catalogEntry.preference,
          status: 'ineligible' as const,
          reason: 'builder.discontinued',
          explanation: `The builder marks ${candidate.id} as discontinued.`,
        };
      case 'unknown':
      default:
        return {
          componentId: candidate.id,
          availability: 'unknown' as const,
          preference: catalogEntry.preference,
          status: 'unknown' as const,
          reason: 'builder.availability_unknown',
          explanation: `The builder availability for ${candidate.id} is unknown; it is ranked conservatively.`,
        };
    }
  });

  const eligibleCatalog = evaluated.filter((item) => item.status === 'eligible');
  if (eligibleCatalog.length === 0) {
    return {
      status: 'inventory_gap',
      attribution,
      candidates: evaluated,
      rankedCandidates: sortCatalogResults(evaluated),
      builderId: attribution.builderId,
    };
  }

  const rankedCandidates = sortCatalogResults(eligibleCatalog);
  return {
    status: 'eligible',
    attribution,
    candidates: evaluated,
    rankedCandidates,
    builderId: attribution.builderId,
  };
};

export const validateBuilderProfileRecord = (
  input: unknown,
): { ok: true; value: BuilderProfile } | { ok: false; errors: readonly string[] } => {
  if (input === null || typeof input !== 'object') {
    return { ok: false, errors: ['Builder profile must be an object.'] };
  }

  const record = input as Record<string, unknown>;
  const valid = validateBuilderSchema(record);
  if (!valid) {
    const errors = (validateBuilderSchema.errors ?? []).map(
      (err: { instancePath?: string; message?: string }) =>
        `${err.instancePath || 'record'}: ${err.message ?? 'invalid value'}`,
    );
    return { ok: false, errors };
  }

  const builderId = normalizeStringField(record.builder_id ?? record.builderId) ?? '';
  const displayName = normalizeStringField(record.display_name ?? record.displayName) ?? '';
  if (!builderId) return { ok: false, errors: ['builder_id: must be a non-empty string.'] };
  if (!displayName) return { ok: false, errors: ['display_name: must be a non-empty string.'] };

  const requestedMode = (record.inventory_mode ?? record.inventoryMode) as
    BuilderInventoryMode | undefined;
  if (
    requestedMode !== 'unrestricted' &&
    requestedMode !== 'allowlist' &&
    requestedMode !== 'denylist'
  ) {
    return { ok: false, errors: ['inventory_mode: must be unrestricted, allowlist, or denylist.'] };
  }

  const catalogValues: BuilderCatalogEntry[] = [];
  const seenComponentIds = new Set<string>();
  const errors: string[] = [];

  if (record.catalog !== undefined) {
    if (!Array.isArray(record.catalog)) {
      return { ok: false, errors: ['catalog: must be an array when supplied.'] };
    }
    for (let index = 0; index < record.catalog.length; index += 1) {
      try {
        const entry = normalizeCatalogEntry(record.catalog[index], index);
        if (seenComponentIds.has(entry.component_id)) {
          errors.push(
            `catalog[${index}].component_id: duplicate component_id '${entry.component_id}'.`,
          );
          continue;
        }
        seenComponentIds.add(entry.component_id);
        catalogValues.push(entry);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `catalog[${index}]: invalid entry.`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      builderId,
      displayName,
      website:
        typeof record.website === 'string' && record.website.length > 0 ? record.website : null,
      inquiryUrl:
        typeof record.inquiry_url === 'string' && record.inquiry_url.length > 0
          ? record.inquiry_url
          : typeof record.inquiryUrl === 'string' && record.inquiryUrl.length > 0
            ? record.inquiryUrl
            : null,
      regions: toStringList(record.regions),
      services: toStringList(record.services),
      inventoryMode: requestedMode ?? 'unrestricted',
      inventoryComponentIds: toStringList(
        record.inventory_component_ids ?? record.inventoryComponentIds,
      ),
      preferredComponentIds: toStringList(
        record.preferred_component_ids ?? record.preferredComponentIds,
      ),
      preferredManufacturers: toStringList(
        record.preferred_manufacturers ?? record.preferredManufacturers,
      ),
      supportedSystemVoltagesV: toNumberList(
        record.supported_system_voltages_v ?? record.supportedSystemVoltagesV,
      ),
      catalog: catalogValues.length > 0 ? catalogValues : undefined,
      tracking:
        record.tracking !== null &&
        typeof record.tracking === 'object' &&
        record.tracking !== undefined
          ? (record.tracking as Record<string, unknown>)
          : undefined,
    },
  };
};

export const normalizeBuilderProfileRecord = (input: unknown): BuilderProfile => {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('A builder profile must be an object.');
  }

  const validation = validateBuilderProfileRecord(input);
  if (!validation.ok) {
    throw new Error(validation.errors.join('; '));
  }
  return validation.value;
};

export const parseBuilderProfileText = (
  sourceText: string,
  sourceLabel = 'inline-builder-profile',
):
  | { ok: true; value: BuilderProfile; label: string }
  | { ok: false; errors: readonly string[]; label: string } => {
  const trimmed = sourceText.trim();
  if (trimmed.length === 0) {
    return { ok: false, errors: ['Builder profile source is empty.'], label: sourceLabel };
  }

  try {
    const parsed =
      trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(trimmed) : parseYaml(trimmed);
    const validation = validateBuilderProfileRecord(parsed);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, label: sourceLabel };
    }
    return { ok: true, value: validation.value, label: sourceLabel };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    return {
      ok: false,
      errors: [`Unable to parse builder profile (${sourceLabel}): ${message}`],
      label: sourceLabel,
    };
  }
};

export const builderCompatibilityStatusFor = (
  profile: BuilderProfile,
  component: { readonly id: string },
  _context: { readonly systemVoltageV?: number } = {},
): 'eligible' | 'ineligible' | 'unknown' => {
  const result = evaluateBuilderCatalogMode(profile, [{ id: component.id, eligible: true }], {
    kind: 'resolved',
    builderId: profile.builderId,
  });
  return result.status === 'eligible' || result.status === 'generic' ? 'eligible' : 'ineligible';
};
