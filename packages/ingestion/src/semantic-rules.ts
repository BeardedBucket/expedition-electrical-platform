import type { JsonValue, CanonicalQualifiedValue } from './contracts.js';
import {
  artifactDigest,
  deterministicSerialize,
  type QualifiedFactArtifact,
} from './production-contracts.js';
import { parseExactUnitValue, resolveUnit } from './units.js';
import { isQualificationProvenance, isSourceSemanticContext } from './qualified-context.js';

export const SEMANTIC_RULE_INTERPRETER = 'semantic-assertions.v7';
export type SemanticInterpreter =
  | 'semantic-assertions.v2'
  | 'semantic-assertions.v3'
  | 'semantic-assertions.v4'
  | 'semantic-assertions.v5'
  | 'semantic-assertions.v6'
  | typeof SEMANTIC_RULE_INTERPRETER;

/** Project policy reviewed through code review, not product approval. Changes require the same
 * maintainer review as engineering code; no API can install caller-authored rules.
 * Full descriptors and interpreter revision enter artifact identity. */
export interface SemanticRule {
  readonly id: string;
  readonly revision: number;
  readonly label_pattern: string;
  readonly concept: string;
  readonly target: string;
  readonly dimension: string;
  readonly unit: string;
  readonly projection: 'scalar' | 'qualified';
  readonly required_domain?: 'ac' | 'dc';
  readonly required_role?: 'battery';
  readonly required_physical_scope?: 'physical_body';
  readonly direction?: 'input' | 'output';
  readonly rationale: string;
}

const rule = (
  concept: string,
  pattern: string,
  target: string,
  dimension: string,
  unit: string,
  options: Partial<
    Pick<SemanticRule, 'projection' | 'required_domain' | 'required_role' | 'direction'>
  > = {},
): SemanticRule => ({
  id: `generic.${concept}`,
  revision: 1,
  label_pattern: pattern,
  concept,
  target,
  dimension,
  unit,
  projection: 'qualified',
  ...options,
  rationale:
    'Exact source label grammar identifies this quantity; unit dimension and explicit domain/direction constrain meaning. Qualified targets assert source-conditioned measurements, never installation applicability or continuous ratings by implication.',
});

// Anchors reject unknown suffixes. Optional rating words describe the source
// basis and are retained below; they do not imply a duration or a continuous rating.
const basis = '(?:(?:max(?:imum)?\\.?|rated|continuous|nominal|peak|surge|full load) )*';
export const legacySemanticRulesV2: readonly SemanticRule[] = [
  rule(
    'nominal_voltage',
    'nominal (?:ac |dc )?(?:battery )?voltage',
    'electrical.nominal_voltage_v',
    'voltage',
    'V',
  ),
  rule(
    'output_current',
    `${basis}(?:ac |dc )?output current`,
    'electrical.output_current_a',
    'current',
    'A',
    { direction: 'output' },
  ),
  rule(
    'input_current',
    `${basis}(?:ac |dc )?input current`,
    'electrical.input_current_a',
    'current',
    'A',
    { direction: 'input' },
  ),
  rule(
    'charge_current',
    `${basis}(?:dc )?(?:battery )?(?:charge|charging) current`,
    'electrical.charge_current_a',
    'current',
    'A',
  ),
  rule(
    'discharge_current',
    `${basis}(?:dc )?(?:battery )?discharge current`,
    'electrical.discharge_current_a',
    'current',
    'A',
  ),
  rule(
    'output_voltage',
    `${basis}(?:ac |dc )?output voltage`,
    'electrical.output_voltage_v',
    'voltage',
    'V',
    { direction: 'output' },
  ),
  rule(
    'input_voltage',
    `${basis}(?:ac |dc )?input (?:ac |dc )?voltage(?: range)?`,
    'electrical.input_voltage_v',
    'voltage',
    'V',
    { direction: 'input' },
  ),
  rule(
    'operating_power',
    `${basis}operating power(?:\\*+)?(?: [–-] \\d+(?:\\.\\d+)? volt battery)?`,
    'electrical.operating_power_w',
    'power',
    'W',
  ),
  rule(
    'output_power',
    `(?!(?:peak|surge) )${basis}(?:ac |dc )?output power`,
    'electrical.output_power_w',
    'power',
    'W',
    { direction: 'output' },
  ),
  rule('peak_power', '(?:peak|surge)(?: output)? power', 'electrical.peak_power_w', 'power', 'W'),
  rule(
    'continuous_power',
    'continuous (?:ac |dc )?power',
    'electrical.continuous_power_w',
    'power',
    'W',
  ),
  rule(
    'rated_power',
    '(?:rated|nominal) (?:ac |dc )?power',
    'electrical.rated_power_w',
    'power',
    'W',
  ),
  rule(
    'apparent_power',
    `${basis}apparent power`,
    'electrical.apparent_power_va',
    'apparent_power',
    'VA',
  ),
  rule(
    'frequency',
    `${basis}(?:ac )?(?:input |output )?(?:ac )?frequency`,
    'electrical.frequency_hz',
    'frequency',
    'Hz',
    { required_domain: 'ac' },
  ),
  rule(
    'pv_open_circuit_voltage',
    '(?:(?:max(?:imum)?\\.?|pv|solar) )*(?:pv |solar )?open[ -]circuit voltage(?: \\(voc\\))?',
    'electrical.pv_open_circuit_voltage_v',
    'voltage',
    'V',
    { required_domain: 'dc', direction: 'input' },
  ),
  rule(
    'idle_current',
    '(?:no[ -]load|idle|quiescent) current',
    'electrical.idle_current_a',
    'current',
    'A',
  ),
  rule('standby_current', 'standby current', 'electrical.standby_current_a', 'current', 'A'),
  rule(
    'consumption',
    '(?:(?:no[ -]load|idle|standby|quiescent) )(?:power|power consumption|consumption)',
    'electrical.conditioned_consumption_w',
    'power',
    'W',
  ),
  rule(
    'efficiency',
    '(?:(?:max(?:imum)?\\.?|peak|typical|rated|full load) )?efficiency',
    'efficiency_fraction',
    'ratio',
    'fraction',
  ),
  rule('weight', '(?:weight|mass|net weight)', 'weight_kg', 'mass', 'kg', { projection: 'scalar' }),
  rule(
    'battery_capacity',
    '(?:battery )?(?:nominal )?capacity',
    'battery.nominal_capacity_ah',
    'capacity',
    'Ah',
    { required_role: 'battery' },
  ),
  rule(
    'battery_energy',
    '(?:battery )?(?:nominal )?energy',
    'battery.nominal_energy_wh',
    'energy',
    'Wh',
    { required_role: 'battery' },
  ),
  rule(
    'charge_voltage',
    '(?:battery )?(?:charge|charging) voltage(?: range)?',
    'battery.charging_voltage_range_v',
    'voltage',
    'V',
    { required_role: 'battery' },
  ),
  rule(
    'float_voltage',
    '(?:battery )?float voltage(?: range)?',
    'battery.float_voltage_range_v',
    'voltage',
    'V',
    { required_role: 'battery' },
  ),
];

// Archived descriptors stay unchanged: source typing and grammar changes have
// their own interpreter and rule revisions rather than rewriting v2 authority.
export const legacySemanticRulesV3: readonly SemanticRule[] = [
  ...legacySemanticRulesV2.map((r) =>
    r.concept === 'weight'
      ? {
          ...r,
          revision: 2,
          label_pattern: '(?:weight|mass|net weight|product weight)',
          rationale:
            'Explicit mass labels including product weight identify mass. Exact mass units and full conditions are required; no category or manufacturer inference.',
        }
      : r.concept === 'charge_voltage'
        ? {
            ...r,
            revision: 2,
            label_pattern:
              '(?:max(?:imum)?\\.? )?(?:battery )?(?:charge|charging) voltage(?: range)?',
            rationale:
              'Explicit charge-voltage grammar retains maximum basis. Battery ownership is required; a charger supported voltage does not become a battery specification.',
          }
        : r.concept === 'frequency'
          ? {
              ...r,
              revision: 2,
              label_pattern: r.label_pattern + '(?: \\(configurable\\))?',
              rationale:
                'Frequency still requires explicit AC context. Configurability stays a source condition, never a selected installed frequency.',
            }
          : r,
  ),
  {
    ...rule(
      'solar_input_voltage',
      '(?:max(?:imum)?\\.? )?solar input voltage(?: range)?',
      'electrical.input_voltage_v',
      'voltage',
      'V',
      { required_domain: 'dc', direction: 'input' },
    ),
    rationale:
      'Solar input explicitly names PV/DC input direction. Qualified source assertions retain that PV scope; this does not assert array compatibility or operating/open-circuit equivalence.',
  },
  ...(['width', 'depth', 'height'] as const).map((axis, index) => ({
    ...rule(
      `body_${axis}`,
      `(?:(?:physical )?body |product )?${axis}`,
      `dimensions_mm.${['x', 'y', 'z'][index]}`,
      'length',
      'mm',
    ),
    required_physical_scope: 'physical_body' as const,
    rationale: `An explicit body ${axis} label or source-authored physical-body scope is required. Component-local ${['x', 'y', 'z'][index]} measures body ${axis}, not world orientation, clearance or installed envelope; the source scope stays qualified.`,
  })),
];
// Greenfield source classes justify quantity grammars, never manufacturer aliases.
// v3 descriptors and interpretation remain replayable exactly as captured.
export const legacySemanticRulesV4: readonly SemanticRule[] = legacySemanticRulesV3.map((r) => {
  const patterns: Readonly<Record<string, string>> = {
    input_voltage: `${r.label_pattern}|input|(?:start |starter )battery input voltage(?: range)?|supply voltage(?: range)?|input voltage range, auxiliary battery`,
    input_current: `${r.label_pattern}|current draw(?: \\([^()]+\\))?`,
    output_voltage: `${r.label_pattern}|output`,
    peak_power: `${r.label_pattern}|surge|power \\(peak\\)`,
    continuous_power: `${r.label_pattern}|power \\(continuous\\)`,
    nominal_voltage: `${r.label_pattern}|voltage \\(nominal\\)`,
    standby_current: `${r.label_pattern}|inverter standby current`,
    charge_current: `${r.label_pattern}(?: amps)?|${basis}charge|recommended (?:charge|charging) current|charge rating|charger current`,
    battery_capacity: `${r.label_pattern}|ah capacity`,
    discharge_current: `${basis}(?:dc )?(?:battery )?discharge(?: (?:current(?: amps)?|amps))?|recommended discharge current|${basis}discharge peak current(?: amps)?`,
  };
  return patterns[r.concept]
    ? {
        ...r,
        revision: r.revision + (['peak_power', 'charge_current'].includes(r.concept) ? 2 : 1),
        label_pattern: patterns[r.concept],
        rationale:
          r.rationale +
          ' Explicit quantity-unit words may be redundant in a source label. Bare Input/Output require source-stated AC/DC voltage; charge/discharge labels retain their basis and direction without a guessed device role.',
      }
    : r;
});
// v5 changes interpretation of competing unit assertions, so it must not
// reinterpret the immutable v4 acceptance artifacts. Every descriptor records
// the stricter unit boundary; neither version invents a rounding tolerance.
export const legacySemanticRulesV5: readonly SemanticRule[] = legacySemanticRulesV4.map((r) => ({
  ...r,
  revision: r.revision + 1,
  rationale:
    r.rationale +
    ' Competing explicit units or a secondary same-dimension quantity require review; a secondary measurement is not an operating condition.',
}));
// v6 accepts the new structural producer revision, and adds only relationships
// observed to reach QualifiedFacts during frozen upstream replay. v5's rules and
// producer ownership checks remain available unchanged for immutable replay.
export const legacySemanticRulesV6: readonly SemanticRule[] = [
  ...legacySemanticRulesV5.map((r) => ({
    ...r,
    revision: r.revision + 1,
    label_pattern: r.concept === 'weight' ? `${r.label_pattern}|module weight` : r.label_pattern,
    rationale:
      r.rationale +
      ' Supports source-product-html revision 2 ownership without granting ProductGroup inheritance. A module weight remains an owned physical quantity, not shipping or installed weight.',
  })),
  rule('pv_maximum_power', 'maximum power \\(pmax\\)', 'electrical.output_power_w', 'power', 'W', {
    required_domain: 'dc',
    direction: 'output',
  }),
  rule(
    'pv_mpp_voltage',
    'voltage at pmax \\(vmp\\)',
    'electrical.output_voltage_v',
    'voltage',
    'V',
    { required_domain: 'dc', direction: 'output' },
  ),
  rule(
    'pv_mpp_current',
    'current at pmax \\(imp\\)',
    'electrical.output_current_a',
    'current',
    'A',
    { required_domain: 'dc', direction: 'output' },
  ),
  rule(
    'pv_short_circuit_current',
    'short[ -]circuit current \\(isc\\)',
    'electrical.output_current_a',
    'current',
    'A',
    { required_domain: 'dc', direction: 'output' },
  ),
];
// Added only after pdf-source-layout.v1 recovered literal, source-owned rows.
// These closed quantity grammars retain the entire label as a source condition;
// they do not infer device roles, auxiliary capacity ownership or scalar ranges.
export const genericSemanticRules: readonly SemanticRule[] = [
  ...legacySemanticRulesV6.map((r) => {
    const additions: Readonly<Record<string, string>> = {
      input_voltage:
        'input battery voltage range|charging input voltage range|dc input operation range',
      input_current: 'current draw, back light off',
      output_current: 'continuous ac output current \\(a\\)',
      efficiency: '(?:inverter efficiency \\(peak\\)|charger efficiency)',
      standby_current: 'dc input standby current',
      charge_current: 'charger current \\(maximum\\)',
      continuous_power: '(?:ac|dc) output power \\(continuous\\)',
      peak_power: '(?:ac|dc) output power \\(surge\\)',
    };
    return additions[r.concept]
      ? {
          ...r,
          revision: r.revision + 1,
          label_pattern: `${r.label_pattern}|${additions[r.concept]}`,
          rationale:
            r.rationale +
            ' Source-owned PDF quantity wording and section scope remain qualified evidence.',
        }
      : r;
  }),
  rule(
    'continuous_apparent_output_power',
    'continuous power output at \\d+(?:\\.\\d+)?(?:° ?| )c',
    'electrical.apparent_power_va',
    'apparent_power',
    'VA',
    { direction: 'output' },
  ),
];
export const semanticRulesFor = (interpreter: SemanticInterpreter): readonly SemanticRule[] =>
  interpreter === 'semantic-assertions.v2'
    ? legacySemanticRulesV2
    : interpreter === 'semantic-assertions.v3'
      ? legacySemanticRulesV3
      : interpreter === 'semantic-assertions.v4'
        ? legacySemanticRulesV4
        : interpreter === 'semantic-assertions.v5'
          ? legacySemanticRulesV5
          : interpreter === 'semantic-assertions.v6'
            ? legacySemanticRulesV6
            : genericSemanticRules;

export interface SemanticAssertion {
  readonly concept: string;
  readonly target: string;
  readonly rule: {
    readonly id: string;
    readonly revision: number;
    readonly digest: string;
    readonly interpreter: string;
    readonly definition: SemanticRule;
  };
  readonly source_fact_id: string;
  readonly source_fact_digest: string;
  readonly normalized_value?: JsonValue;
  readonly normalized_unit: string;
  readonly qualifiers: SourceRatingQualifiers;
  readonly review_required_reasons: readonly string[];
  readonly projection: 'scalar' | 'qualified';
}

/** These strings are preserved source conditions, not an interpretation of when
 * an installation satisfies them. Consumers must implement an explicit typed
 * interpreter before relying on any qualified rating; no scalar fallback exists. */
export interface SourceRatingQualifiers {
  readonly product_role?: 'battery';
  readonly electrical_domain?: 'ac' | 'dc';
  readonly direction?: 'input' | 'output';
  readonly rating_basis?:
    'maximum' | 'rated' | 'rated_maximum' | 'continuous' | 'nominal' | 'peak' | 'surge';
  readonly battery_voltage_v?: number;
  readonly measurement_basis?: 'rms';
  readonly comparison?:
    'less_than' | 'less_than_or_equal' | 'greater_than' | 'greater_than_or_equal';
  readonly source_conditions?: readonly string[];
  readonly duration?: string;
  readonly temperature_context?: string;
  readonly revision_context?: string;
}

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const sameApplicability = (a: QualifiedFactArtifact, b: QualifiedFactArtifact) =>
  a.source_capture.digest === b.source_capture.digest &&
  a.source_acquisition?.digest === b.source_acquisition?.digest &&
  a.metadata.applicability.kind === b.metadata.applicability.kind &&
  a.metadata.applicability.value === b.metadata.applicability.value;
const contextHasConditions = (
  fact: QualifiedFactArtifact,
  interpreter: SemanticInterpreter,
): boolean =>
  !!fact.metadata.conditions?.length ||
  fact.metadata.duration !== undefined ||
  fact.metadata.temperature_context !== undefined ||
  fact.metadata.revision_context !== undefined ||
  fact.metadata.derived_value !== undefined ||
  fact.metadata.derivation !== undefined ||
  fact.metadata.alternative_interpretations !== undefined ||
  !!fact.evidence?.some(
    (e) =>
      (e.role === 'qualifier' || e.role === 'context') &&
      (interpreter === 'semantic-assertions.v2' || !isQualificationProvenance(e, fact)),
  );

export const recognizeSemanticAssertion = (
  fact: QualifiedFactArtifact,
  peers: readonly QualifiedFactArtifact[] = [fact],
  rules: readonly SemanticRule[] = genericSemanticRules,
  interpreter: SemanticInterpreter = SEMANTIC_RULE_INTERPRETER,
): SemanticAssertion | undefined => {
  const originalLabel = clean(fact.metadata.source_label ?? '');
  // A closed trailing [unit] is an explicit source unit, not an alias. Preserve
  // the original label in the fact; unknown bracket text remains unmatched.
  const labelUnit =
    interpreter === 'semantic-assertions.v4' ||
    interpreter === 'semantic-assertions.v5' ||
    interpreter === 'semantic-assertions.v6' ||
    interpreter === 'semantic-assertions.v7'
      ? originalLabel.match(/,?\s*\[([^[\]]+)\]$/)
      : undefined;
  const bracketUnit = labelUnit && resolveUnit(labelUnit[1]);
  const label = bracketUnit
    ? originalLabel.slice(0, labelUnit!.index).trim().replace(/,$/, '').trim()
    : originalLabel;
  const assertedUnit = fact.metadata.source_unit ?? (bracketUnit ? labelUnit![1] : undefined);
  const matches = rules.filter((r) => new RegExp(`^(?:${r.label_pattern})$`, 'i').test(label));
  // Multiple matching meanings abstain rather than using rule order as authority.
  if (matches.length !== 1) return undefined;
  const r = matches[0];
  const reasons: string[] = [];
  if (
    (interpreter === 'semantic-assertions.v5' ||
      interpreter === 'semantic-assertions.v6' ||
      interpreter === 'semantic-assertions.v7') &&
    bracketUnit &&
    fact.metadata.source_unit !== undefined &&
    resolveUnit(fact.metadata.source_unit)?.id !== bracketUnit.id
  )
    reasons.push('competing_source_units');
  if (!['exact', 'structurally_supported'].includes(fact.qualification_state ?? ''))
    reasons.push('qualification_unresolved');
  if (
    !['exact_product', 'exact_mpn_or_sku', 'exact_sku'].includes(
      fact.metadata.applicability.kind,
    ) ||
    !fact.metadata.applicability.value
  )
    reasons.push('applicability_unresolved');
  if (
    fact.metadata.derived_value !== undefined ||
    fact.metadata.derivation !== undefined ||
    fact.metadata.alternative_interpretations !== undefined
  )
    reasons.push('interpretation_requires_human');
  const raw = String(fact.metadata.raw_value);
  const domains = new Set<'ac' | 'dc'>();
  for (const text of [label, raw, assertedUnit ?? '']) {
    if (/\bac\b|vac\b/i.test(text)) domains.add('ac');
    if (/\bdc\b|vdc\b/i.test(text)) domains.add('dc');
  }
  // A source-stated conversion-domain row is evidence, not a product name or
  // category inference. It must share the capture and exact applicability.
  if (!domains.size)
    for (const p of peers) {
      if (
        sameApplicability(p, fact) &&
        ['exact', 'structurally_supported'].includes(p.qualification_state ?? '') &&
        clean(p.metadata.source_label ?? '') === 'power type - ac dc'
      ) {
        const stated = clean(String(p.metadata.raw_value));
        if (contextHasConditions(p, interpreter))
          reasons.push('conversion_domain_context_unresolved');
        else if (stated === 'dc to dc') domains.add('dc');
        else reasons.push('conversion_domain_unresolved');
      }
    }
  if (r.required_domain === 'dc' && /\b(?:pv|solar)\b/.test(label)) domains.add('dc');
  // These source-native photovoltaic grammars require independent physical
  // ownership: an exact Product's Cells property plus a Module physical label.
  // A name/category, compatible cell types, or a controller's connected-module
  // ratings never establish that the product is the generating module itself.
  // Module cell technology plus an independently owned module physical property
  // establishes the subject. Supported/compatible chemistries, product names and
  // category cannot supply this evidence. MPP and Isc retain their source basis
  // as qualified output observations, never unconditional continuous ratings.
  const pvCells =
    interpreter === 'semantic-assertions.v6' || interpreter === 'semantic-assertions.v7'
      ? peers.filter(
          (p) =>
            sameApplicability(p, fact) &&
            p.qualifier === 'source-product-html' &&
            p.qualifier_version === '2.0.0' &&
            p.qualification_state === 'structurally_supported' &&
            clean(p.metadata.source_label ?? '') === 'cells',
        )
      : [];
  const pvModule =
    pvCells.length === 1 &&
    !contextHasConditions(pvCells[0], interpreter) &&
    /^(?:monocrystalline|polycrystalline)$/.test(clean(String(pvCells[0].metadata.raw_value))) &&
    peers.some(
      (p) =>
        sameApplicability(p, fact) &&
        p.qualifier === 'source-product-html' &&
        p.qualifier_version === '2.0.0' &&
        p.qualification_state === 'structurally_supported' &&
        /^module (?:weight|dimensions)$/.test(clean(p.metadata.source_label ?? '')),
    );
  if (
    (interpreter === 'semantic-assertions.v6' || interpreter === 'semantic-assertions.v7') &&
    ['pv_maximum_power', 'pv_mpp_voltage', 'pv_mpp_current', 'pv_short_circuit_current'].includes(
      r.concept,
    ) &&
    !pvModule
  )
    reasons.push('photovoltaic_module_owner_required');
  if (pvModule && r.concept.startsWith('pv_')) domains.add('dc');
  if (r.required_domain === 'ac' && /\bac\b/.test(label)) domains.add('ac');
  if (domains.size > 1) reasons.push('competing_electrical_domains');
  const domain = domains.size === 1 ? [...domains][0] : undefined;
  if (
    (interpreter === 'semantic-assertions.v4' ||
      interpreter === 'semantic-assertions.v5' ||
      interpreter === 'semantic-assertions.v6' ||
      interpreter === 'semantic-assertions.v7') &&
    /^(?:input|output)$/.test(label) &&
    !domain
  )
    reasons.push('electrical_domain_required');
  if (r.required_domain && domain !== r.required_domain) reasons.push('electrical_domain_required');
  const roles = peers.filter(
    (p) =>
      sameApplicability(p, fact) &&
      ['exact', 'structurally_supported'].includes(p.qualification_state ?? '') &&
      ['product type', 'product role'].includes(clean(p.metadata.source_label ?? '')),
  );
  // PRODUCT role differs from a section mentioning a connected battery.
  // Category, manufacturer and product name never establish battery ownership.
  const declaredProductRole =
    roles.length &&
    roles.every(
      (p) =>
        !contextHasConditions(p, interpreter) && clean(String(p.metadata.raw_value)) === 'battery',
    )
      ? ('battery' as const)
      : undefined;
  // A Product-owned Battery type row that explicitly names a battery is an
  // independent source assertion of ownership. Compatible/supported chemistry,
  // category, model name and connected-battery rows do not meet this grammar.
  const ownedBatteryTypes =
    interpreter === 'semantic-assertions.v4' ||
    interpreter === 'semantic-assertions.v5' ||
    interpreter === 'semantic-assertions.v6' ||
    interpreter === 'semantic-assertions.v7'
      ? peers.filter(
          (p) =>
            sameApplicability(p, fact) &&
            p.qualifier === 'source-product-html' &&
            (p.qualifier_version === '1.0.0' ||
              ((interpreter === 'semantic-assertions.v6' ||
                interpreter === 'semantic-assertions.v7') &&
                p.qualifier_version === '2.0.0')) &&
            p.qualification_state === 'structurally_supported' &&
            clean(p.metadata.source_label ?? '') === 'battery type',
        )
      : [];
  const explicitBatteryType =
    !roles.length &&
    ownedBatteryTypes.length > 0 &&
    ownedBatteryTypes.every(
      (p) =>
        !contextHasConditions(p, interpreter) &&
        /^(?:(?:heated|bluetooth|deep[ -]cycle|rechargeable) )*(?:lifepo4|lithium[ -]ion|lead[ -]acid) battery$/.test(
          clean(String(p.metadata.raw_value)),
        ),
    );
  const productRole = declaredProductRole ?? (explicitBatteryType ? 'battery' : undefined);
  if (r.required_role && productRole !== r.required_role) reasons.push('product_role_required');
  // A controller/monitor's connected-battery specification cannot become the
  // product's own nominal voltage. New ingestion requires independent ownership;
  // archived v3 replay keeps its former behavior for comparison and review.
  if (
    (interpreter === 'semantic-assertions.v4' ||
      interpreter === 'semantic-assertions.v5' ||
      interpreter === 'semantic-assertions.v6' ||
      interpreter === 'semantic-assertions.v7') &&
    r.concept === 'nominal_voltage' &&
    /\bbattery\b/.test(label) &&
    productRole !== 'battery'
  )
    reasons.push('battery_property_owner_required');
  const contextualEvidence =
    fact.evidence?.filter(
      (e) =>
        (e.role === 'qualifier' || e.role === 'context') &&
        (interpreter === 'semantic-assertions.v2' || !isQualificationProvenance(e, fact)),
    ) ?? [];
  let bodyScope: QualifiedFactArtifact | undefined;
  if (r.required_physical_scope) {
    const scopes = peers.filter(
      (p) =>
        sameApplicability(p, fact) &&
        ['exact', 'structurally_supported'].includes(p.qualification_state ?? '') &&
        ['dimension scope', 'physical scope'].includes(clean(p.metadata.source_label ?? '')),
    );
    if (
      scopes.length === 1 &&
      !contextHasConditions(scopes[0], interpreter) &&
      clean(String(scopes[0].metadata.raw_value)) === 'physical body'
    )
      bodyScope = scopes[0];
    const ownedDimensionRegion =
      (interpreter === 'semantic-assertions.v4' ||
        interpreter === 'semantic-assertions.v5' ||
        interpreter === 'semantic-assertions.v6' ||
        interpreter === 'semantic-assertions.v7') &&
      (fact.qualifier === 'source-product-html' ||
        (interpreter === 'semantic-assertions.v7' && fact.qualifier === 'pdf-source-layout.v1')) &&
      (fact.qualifier_version === '1.0.0' ||
        ((interpreter === 'semantic-assertions.v6' || interpreter === 'semantic-assertions.v7') &&
          fact.qualifier_version === '2.0.0')) &&
      contextualEvidence.some(
        (e) =>
          isSourceSemanticContext(e) &&
          e.context?.physical_scope === 'product_body' &&
          e.source_reference?.digest === fact.source_capture.digest &&
          e.source_reference?.kind === fact.source_capture.kind,
      );
    if (!/^(?:physical )?body /.test(label) && !bodyScope && !ownedDimensionRegion)
      reasons.push('physical_body_scope_required');
  }
  // Producer-owned typing separates source assertions from provenance. Neither
  // unknown context nor locator/note wording supplies engineering meaning. The
  // archived v2 interpreter retains its original conservative context handling.
  if (
    contextualEvidence.some(
      (e) =>
        (interpreter === 'semantic-assertions.v2'
          ? e.role === 'context'
          : !isSourceSemanticContext(e)) ||
        typeof e.text !== 'string' ||
        !e.text.trim(),
    )
  )
    reasons.push('qualifier_context_unresolved');
  const sourceConditions = [
    ...new Set([
      ...(fact.metadata.conditions ?? []),
      ...contextualEvidence.flatMap((e) =>
        (interpreter === 'semantic-assertions.v2'
          ? e.role === 'qualifier'
          : isSourceSemanticContext(e)) &&
        typeof e.text === 'string' &&
        e.text.trim()
          ? [e.text]
          : [],
      ),
    ]),
  ].sort();
  if (interpreter === 'semantic-assertions.v7' && fact.qualifier === 'pdf-source-layout.v1')
    sourceConditions.push(fact.metadata.source_label!);
  if (r.required_physical_scope)
    sourceConditions.push(
      bodyScope ? String(bodyScope.metadata.raw_value) : fact.metadata.source_label!,
    );
  const unitSuffix =
    interpreter === 'semantic-assertions.v4' ||
    interpreter === 'semantic-assertions.v5' ||
    interpreter === 'semantic-assertions.v6' ||
    interpreter === 'semantic-assertions.v7'
      ? raw.match(/^\s*(\d+(?:\.\d+)?)\s*\(([^()]+)\)\s*$/)
      : undefined;
  const parenthesizedUnit = unitSuffix && resolveUnit(unitSuffix[2]);
  const suffix = parenthesizedUnit ? undefined : raw.match(/\s*\(([^()]+)\)\s*$/);
  // A same-dimension suffix is an additional measured assertion, not a source
  // condition. Preserve both literals and withhold automatic projection until
  // comparison/precision is supported. No implicit rounding margin is defined.
  if (
    (interpreter === 'semantic-assertions.v5' ||
      interpreter === 'semantic-assertions.v6' ||
      interpreter === 'semantic-assertions.v7') &&
    suffix &&
    parseExactUnitValue(suffix[1])?.unit.dimension === r.dimension
  )
    reasons.push('secondary_quantity_requires_comparison');
  if (suffix) sourceConditions.push(suffix[1]);
  const voltage = label.match(/[–-] (\d+(?:\.\d+)?) volt battery$/);
  const rating_basis = /\b(?:max(?:imum)?\.?)\b/.test(label)
    ? /\brated\b/.test(label)
      ? 'rated_maximum'
      : 'maximum'
    : /\bcontinuous\b/.test(label)
      ? 'continuous'
      : /\brated\b/.test(label)
        ? 'rated'
        : /\bnominal\b/.test(label)
          ? 'nominal'
          : /\bpeak\b/.test(label)
            ? 'peak'
            : /\bsurge\b/.test(label)
              ? 'surge'
              : undefined;
  const relation = raw.trim().match(/^(<=|>=|<|>|≤|≥)\s*/)?.[1];
  const rms =
    /(?:\s+|(?<=A))rms\s*(?:\([^()]+\))?\s*$/i.test(raw) ||
    /^(?:mA|kA|A)\s*rms$/i.test(fact.metadata.source_unit ?? '');
  if (/\bfull load\b/.test(label)) sourceConditions.push('full load');
  if (
    interpreter !== 'semantic-assertions.v2' &&
    (/\(configurable\)$/.test(label) || r.concept === 'solar_input_voltage')
  )
    sourceConditions.push(fact.metadata.source_label!);
  // One basis enum cannot express a compound source basis such as nominal
  // maximum. Preserve that exact label as an additional source constraint.
  if ((label.match(/\b(?:nominal|max(?:imum)?|rated|continuous|peak|surge)\b/g)?.length ?? 0) > 1)
    sourceConditions.push(fact.metadata.source_label!);
  if (/\btypical\b/.test(label) || /\snominal$/i.test(raw))
    sourceConditions.push(/\btypical\b/.test(label) ? fact.metadata.source_label! : raw);
  if (
    (interpreter === 'semantic-assertions.v4' ||
      interpreter === 'semantic-assertions.v5' ||
      interpreter === 'semantic-assertions.v6' ||
      interpreter === 'semantic-assertions.v7') &&
    /^recommended /.test(label)
  )
    sourceConditions.push(fact.metadata.source_label!);
  if (
    (interpreter === 'semantic-assertions.v4' ||
      interpreter === 'semantic-assertions.v5' ||
      interpreter === 'semantic-assertions.v6' ||
      interpreter === 'semantic-assertions.v7') &&
    /^inverter standby current$/.test(label)
  )
    sourceConditions.push(fact.metadata.source_label!);
  if (/^(?:no[ -]load|idle|standby|quiescent) /.test(label))
    sourceConditions.push(label.split(/ (?:current|power|consumption)/)[0]);
  if (
    (interpreter === 'semantic-assertions.v4' ||
      interpreter === 'semantic-assertions.v5' ||
      interpreter === 'semantic-assertions.v6' ||
      interpreter === 'semantic-assertions.v7') &&
    /^(?:current draw|input voltage range, auxiliary battery)/.test(label)
  )
    sourceConditions.push(fact.metadata.source_label!);
  if (
    (interpreter === 'semantic-assertions.v6' || interpreter === 'semantic-assertions.v7') &&
    ['pv_mpp_voltage', 'pv_mpp_current', 'pv_short_circuit_current'].includes(r.concept)
  )
    sourceConditions.push(fact.metadata.source_label!);
  const qualifiers: SourceRatingQualifiers = {
    ...(r.required_role && productRole ? { product_role: productRole } : {}),
    ...(domain ? { electrical_domain: domain } : {}),
    ...((r.direction ?? (label.match(/\b(input|output)\b/)?.[1] as 'input' | 'output' | undefined))
      ? {
          direction:
            pvModule && r.concept === 'pv_open_circuit_voltage'
              ? 'output'
              : (r.direction ?? (label.match(/\b(input|output)\b/)![1] as 'input' | 'output')),
        }
      : {}),
    ...(rating_basis ? { rating_basis } : {}),
    ...(voltage ? { battery_voltage_v: Number(voltage[1]) } : {}),
    ...(rms ? { measurement_basis: 'rms' } : {}),
    ...(relation
      ? {
          comparison: (
            {
              '<': 'less_than',
              '<=': 'less_than_or_equal',
              '≤': 'less_than_or_equal',
              '>': 'greater_than',
              '>=': 'greater_than_or_equal',
              '≥': 'greater_than_or_equal',
            } as const
          )[relation as '<'],
        }
      : {}),
    ...(sourceConditions.length
      ? { source_conditions: [...new Set(sourceConditions)].sort() }
      : {}),
    ...(fact.metadata.duration !== undefined ? { duration: fact.metadata.duration } : {}),
    ...(fact.metadata.temperature_context !== undefined
      ? { temperature_context: fact.metadata.temperature_context }
      : {}),
    ...(fact.metadata.revision_context !== undefined
      ? { revision_context: fact.metadata.revision_context }
      : {}),
  };
  // Consume only closed suffix syntax. The source assertion is never replaced;
  // original wording/units remain in the immutable referenced QualifiedFact.
  const valueText = (parenthesizedUnit ? `${unitSuffix![1]} ${unitSuffix![2]}` : raw)
    .replace(/^\s*(?:<=|>=|<|>|≤|≥)\s*/, '')
    .replace(/\s*\([^()]+\)\s*$/, '')
    .replace(/(?:\s+|(?<=A))rms\s*$/i, '')
    .trim();
  const parsed = parseExactUnitValue(
    valueText,
    rms ? assertedUnit?.replace(/\s*rms$/i, '') : assertedUnit,
  );
  const targetUnit = resolveUnit(r.unit);
  let normalized: JsonValue | undefined;
  if (parsed && parsed.unit.dimension === r.dimension && targetUnit?.dimension === r.dimension)
    normalized = targetUnit.fromCanonical(parsed.unit.toCanonical(parsed.value));
  if (r.dimension === 'ratio') {
    const percent = valueText.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (percent && (fact.metadata.source_unit === undefined || fact.metadata.source_unit === '%'))
      normalized = Number(percent[1]) / 100;
    if (/^\d+(?:\.\d+)?$/.test(valueText) && fact.metadata.source_unit === '%')
      normalized = Number(valueText) / 100;
    if (/^\d+(?:\.\d+)?$/.test(valueText) && fact.metadata.source_unit === 'fraction')
      normalized = Number(valueText);
    if (typeof normalized === 'number' && (normalized < 0 || normalized > 1))
      normalized = undefined;
  }
  if (normalized === undefined && r.dimension === 'voltage') {
    const range = valueText.match(
      /^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(V(?:ac|dc)?|mV|kV)?$/i,
    );
    const unit = resolveUnit(range?.[3] ?? assertedUnit ?? '');
    if (
      range &&
      unit?.dimension === 'voltage' &&
      (!range[3] || assertedUnit === undefined || resolveUnit(assertedUnit)?.id === unit.id)
    ) {
      const min = unit.toCanonical(Number(range[1])),
        max = unit.toCanonical(Number(range[2]));
      // Only targets with an explicit range contract may carry two endpoints;
      // neither a nominal scalar nor an unbounded numeric overflow is a range.
      if (
        [
          'electrical.input_voltage_v',
          'electrical.output_voltage_v',
          'battery.charging_voltage_range_v',
          'battery.float_voltage_range_v',
        ].includes(r.target) &&
        Number.isFinite(min) &&
        Number.isFinite(max) &&
        min <= max
      )
        normalized = { min, max };
    }
  }
  if (
    normalized === undefined ||
    (typeof normalized === 'number' && (!Number.isFinite(normalized) || normalized < 0))
  )
    reasons.push('value_or_unit_unresolved');
  // A source battery-voltage condition must be a positive finite voltage, as
  // required by the qualified-value contract; invalid conditions stay visible.
  if (
    qualifiers.battery_voltage_v !== undefined &&
    (!Number.isFinite(qualifiers.battery_voltage_v) || qualifiers.battery_voltage_v <= 0)
  )
    reasons.push('battery_voltage_condition_unresolved');
  const projection =
    r.projection === 'scalar' && Object.keys(qualifiers).length ? 'qualified' : r.projection;
  return {
    concept: r.concept,
    target: r.target,
    rule: {
      id: r.id,
      revision: r.revision,
      digest: artifactDigest({ rule: r, interpreter }),
      interpreter,
      definition: { ...r },
    },
    source_fact_id: fact.id,
    source_fact_digest: artifactDigest(fact),
    normalized_unit: r.unit,
    ...(normalized !== undefined ? { normalized_value: normalized } : {}),
    qualifiers,
    projection,
    review_required_reasons: reasons.sort(),
  };
};

export const semanticAssertionComparisonKey = (
  a: SemanticAssertion,
  fact: QualifiedFactArtifact,
  intakeDigest: string,
): string =>
  deterministicSerialize({
    intake: intakeDigest,
    concept: a.concept,
    target: a.target,
    applicability: {
      kind: fact.metadata.applicability.kind,
      value: fact.metadata.applicability.value,
    },
    qualifiers: a.qualifiers,
    // Uninterpreted contextual evidence cannot be compared as an absent
    // condition. Isolate by immutable source identity until a human resolves it.
    ...(a.review_required_reasons.includes('qualifier_context_unresolved')
      ? { unresolved_context_fact_digest: a.source_fact_digest }
      : {}),
  });

/** Only explicit supported archived/current versions can replay. A historic
 * assertion never acquires new grammar or context interpretation implicitly. */
export const replaySemanticAssertion = (
  fact: QualifiedFactArtifact,
  peers: readonly QualifiedFactArtifact[],
  stored: SemanticAssertion,
): SemanticAssertion | undefined => {
  const interpreter = stored.rule.interpreter;
  if (
    interpreter !== 'semantic-assertions.v2' &&
    interpreter !== 'semantic-assertions.v3' &&
    interpreter !== 'semantic-assertions.v4' &&
    interpreter !== 'semantic-assertions.v5' &&
    interpreter !== 'semantic-assertions.v6' &&
    interpreter !== SEMANTIC_RULE_INTERPRETER
  )
    return undefined;
  return recognizeSemanticAssertion(fact, peers, semanticRulesFor(interpreter), interpreter);
};

export const assertionQualifiedValue = (
  a: SemanticAssertion,
  factIds: readonly string[],
): CanonicalQualifiedValue =>
  ({
    id: `qualified-value.${artifactDigest({ target: a.target, value: a.normalized_value, qualifiers: a.qualifiers, facts: [...factIds].sort() }).slice(7, 31)}`,
    target: a.target,
    value: a.normalized_value!,
    // An explicit empty source condition set does not assert absence: direction,
    // basis, domain or a source label preserves the rating's unresolved scope.
    qualifiers: { kind: 'source_rating', ...a.qualifiers },
  }) as CanonicalQualifiedValue;
