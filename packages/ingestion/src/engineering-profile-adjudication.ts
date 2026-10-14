import {
  parseEngineeringProfile,
  type EngineeringProfile,
} from '@expedition/engineering-core/engineering-profile';
import type { ProductFact, JsonValue, ProductSource } from './contracts.js';
import type {
  ProductIntake,
  QualifiedFactArtifact,
  DocumentExtractionArtifact,
} from './production-contracts.js';
import {
  previewHumanMapping,
  humanSourceContext,
  humanStatementFact,
  type HumanSourceStatement,
} from './human-adjudication.js';
import { deterministicSerialize } from './production-contracts.js';
import { readSourceOwnedSpecification } from './source-owned-specification.js';
export const PROFILE_ADJUDICATION_VERSION = 'engineering-profile-adjudication.v1';
export type ProfileQuantity =
  | 'voc_v'
  | 'vmp_v'
  | 'isc_a'
  | 'imp_a'
  | 'pmax_w'
  | 'max_system_v'
  | 'pv_absolute_voc_v'
  | 'pv_max_isc_a'
  | 'battery_cell_charge_range_c'
  | 'battery_discharge_range_c'
  | 'battery_series_max_count'
  | 'battery_parallel_max_count'
  | 'instrument_current_accuracy_percent'
  | 'instrument_voltage_accuracy_percent'
  | 'instrument_shunt_rating';
export const profileQuantityContracts: Record<
  ProfileQuantity,
  { unit: 'V' | 'A' | 'W' | 'structured'; meaning: RegExp }
> = {
  voc_v: { unit: 'V', meaning: /open[ -]?circuit voltage|\bVoc\b/i },
  vmp_v: { unit: 'V', meaning: /voltage at (?:Pmax|maximum power)|\bVmp\b/i },
  isc_a: { unit: 'A', meaning: /short[ -]?circuit current|\bIsc\b/i },
  imp_a: { unit: 'A', meaning: /current at (?:Pmax|maximum power)|\bImp\b/i },
  pmax_w: { unit: 'W', meaning: /maximum power|\bPmax\b/i },
  max_system_v: { unit: 'V', meaning: /max(?:imum)? system voltage/i },
  pv_absolute_voc_v: { unit: 'V', meaning: /maximum PV open circuit voltage/i },
  pv_max_isc_a: { unit: 'A', meaning: /max(?:imum)?\.? PV short circuit current/i },
  battery_cell_charge_range_c: {
    unit: 'structured',
    meaning: /^battery\s*\/\s*cell charge range$/i,
  },
  battery_discharge_range_c: { unit: 'structured', meaning: /^discharge temperature range$/i },
  battery_series_max_count: { unit: 'structured', meaning: /^series connections$/i },
  battery_parallel_max_count: { unit: 'structured', meaning: /^parallel connections$/i },
  instrument_current_accuracy_percent: {
    unit: 'structured',
    meaning: /^accuracy of current measurement$/i,
  },
  instrument_voltage_accuracy_percent: {
    unit: 'structured',
    meaning: /^accuracy of voltage measurement$/i,
  },
  instrument_shunt_rating: { unit: 'structured', meaning: /^shunt \(included\)$/i },
};
/** Historical scalar members keep their original normalizer. Conditional
 * members are new v2 meanings; discovery and composition share this dispatch. */
export function profileAdjudicationVersion(quantity: ProfileQuantity | undefined) {
  if (!quantity || !profileQuantityContracts[quantity])
    throw new Error('Choose a supported exact source quantity before discovery');
  return profileQuantityContracts[quantity].unit === 'structured'
    ? ('engineering-profile-adjudication.v2' as const)
    : PROFILE_ADJUDICATION_VERSION;
}
/** Atomic profile composition owns metadata, not the browser. Every contributing
 * member is an existing ready source-adjudication fact and reviewed semantic map;
 * its full source proof remains in the ordinary fact/audit stream. Partial facts
 * do not establish tracker grouping, reference conditions or intended-use fit. */
export function composeAdjudicatedProfile(
  intake: ProductIntake,
  componentId: string,
  facts: readonly ProductFact[],
  sources: readonly ProductSource[],
): EngineeringProfile {
  const profile: EngineeringProfile = {
    schema_version: 'engineering-profile.v1',
    component_id: componentId,
    model: intake.product_model,
    manufacturer_revision: null,
    evidence: [],
  };
  const seen = new Set<string>();
  for (const fact of facts) {
    const qf = fact.human_source as QualifiedFactArtifact | undefined;
    const proof = qf?.human_source;
    const mapping = proof?.statement.mapping;
    if (!qf || !proof || mapping?.kind !== 'engineering_profile_fact')
      throw new Error('Profile requires existing human-source proof');
    if (
      proof.intake.product_model !== intake.product_model ||
      proof.intake.manufacturer !== intake.manufacturer ||
      proof.intake.manufacturer_part_number !== intake.manufacturer_part_number
    )
      throw new Error('Profile source belongs to a different intake identity');
    const q = mapping.quantity,
      member = previewHumanMapping(qf, mapping).normalized_value as Record<string, JsonValue>;
    if (seen.has(q))
      throw new Error('Competing profile member; explicit source correction required');
    seen.add(q);
    const eId = qf.id;
    const capture = proof.documents.find((d) => d.id === proof.statement.citations[0]?.document_id);
    if (!capture) throw new Error('Missing retained profile source document');
    const source = sources.find((s) => s.id === fact.source_id);
    if (!source) throw new Error('Profile source metadata missing');
    if (
      capture.source_capture.digest !== qf.source_capture.digest ||
      // Reproduce the existing projectSource ID protocol: seven characters of
      // 'sha256:' then 24 hex characters. Full capture-reference equality above
      // remains separate from this intentionally coupled display/lookup ID.
      source.id !== `production-source.${qf.source_capture.digest.slice(7, 31)}`
    )
      throw new Error('Profile fact/source capture ownership mismatch');
    const sourceUri = source.uri;
    profile.evidence.push({
      id: eId,
      source_url: sourceUri,
      publisher: source.publisher,
      model: intake.product_model,
      manufacturer_revision: null,
      retrieved_at: source.retrieved_at,
      source_digest: source.content_hash?.replace(/^sha256:/, '') ?? null,
      locator: deterministicSerialize(proof.statement.citations),
      statement: proof.statement.wording,
      conditions: [
        humanSourceContext(proof.statement, proof.documents).text,
        ...(proof.statement.conditions ?? []),
        'Human source interpretation; reference/revision and full intended-use prerequisites remain unresolved',
      ],
      origin: 'source_stated',
      rights: 'metadata_and_limited_facts_only',
      human_interpretation: {
        version: profileAdjudicationVersion(q),
        event_id: proof.event_id,
        fact_id: qf.id,
        source_document_revision: source.document_revision ?? null,
        source_unit:
          proof.statement.unit ??
          (q === 'battery_cell_charge_range_c' || q === 'battery_discharge_range_c'
            ? '°C / °F'
            : q === 'battery_series_max_count' || q === 'battery_parallel_max_count'
              ? 'batteries'
              : q === 'instrument_shunt_rating'
                ? 'A / mV'
                : q.startsWith('instrument_')
                  ? '%'
                  : String(member.unit)),
        ...(profileQuantityContracts[q].unit === 'structured' ? { quantity: q } : {}),
      },
    });
    const value = { value: member.value, unit: member.unit, evidence_ids: [eId] };
    if (q.startsWith('battery_')) {
      profile.battery_operating ??= { version: 'battery-operating.v1' };
      const key =
        q === 'battery_cell_charge_range_c'
          ? 'charge_range'
          : q === 'battery_discharge_range_c'
            ? 'discharge_range'
            : q === 'battery_series_max_count'
              ? 'series_permission'
              : 'parallel_permission';
      (profile.battery_operating as unknown as Record<string, unknown>)[key] = {
        ...member,
        evidence_ids: [eId],
      };
    } else if (q.startsWith('instrument_')) {
      profile.instrumentation ??= { version: 'instrumentation.v1' };
      if (q === 'instrument_shunt_rating')
        profile.instrumentation.shunt = {
          ...member,
          evidence_ids: [eId],
        } as unknown as NonNullable<EngineeringProfile['instrumentation']>['shunt'];
      else {
        profile.instrumentation.accuracy ??= [];
        profile.instrumentation.accuracy.push({
          ...member,
          evidence_ids: [eId],
        } as unknown as NonNullable<
          NonNullable<EngineeringProfile['instrumentation']>['accuracy']
        >[number]);
      }
    } else if (q.startsWith('pv_')) {
      profile.trackers ??= [
        { id: 'pv_input_unassigned', grouping_status: 'unresolved', evidence_ids: [] },
      ];
      (profile.trackers[0] as unknown as Record<string, unknown>)[
        q === 'pv_absolute_voc_v' ? 'absolute_voc_v' : 'max_isc_a'
      ] = value;
      profile.trackers[0]!.evidence_ids.push(eId);
    } else {
      profile.pv ??= {};
      (profile.pv as Record<string, unknown>)[q] = value;
    }
  }
  return parseEngineeringProfile(profile);
}
export function profileMemberValue(
  q: ProfileQuantity,
  raw: string,
  unit: string | undefined,
  context: string,
  nativeLabel?: string,
): JsonValue {
  const contract = profileQuantityContracts[q];
  if (
    !contract ||
    !contract.meaning.test(contract.unit === 'structured' ? (nativeLabel ?? '') : context)
  )
    throw new Error('Exact source quantity meaning is not established');
  if (contract.unit === 'structured') {
    if (!nativeLabel || !contract.meaning.test(nativeLabel) || unit !== undefined)
      throw new Error(
        'Conditional quantities require an independently owned complete native source row',
      );
    if (q === 'battery_cell_charge_range_c' || q === 'battery_discharge_range_c') {
      const r =
        /^(-?\d+(?:\.\d+)?)\s*°C to (-?\d+(?:\.\d+)?)\s*°C\s*\/\s*(-?\d+(?:\.\d+)?)\s*°F to (-?\d+(?:\.\d+)?)\s*°F( after heating)?$/.exec(
          raw.trim(),
        );
      if (
        !r ||
        ![r[1], r[2], r[3], r[4]].every((v) => Number.isFinite(Number(v))) ||
        Number(r[1]) > Number(r[2]) ||
        (Number(r[1]) * 9) / 5 + 32 !== Number(r[3]) ||
        (Number(r[2]) * 9) / 5 + 32 !== Number(r[4])
      )
        throw new Error('A complete, consistent Celsius/Fahrenheit source range is required');
      return {
        min_c: Number(r[1]),
        max_c: Number(r[2]),
        unit: 'degC',
        measurement_point: q === 'battery_cell_charge_range_c' ? 'battery_cell' : 'unknown',
        prerequisite: r[5] ? 'after_heating' : 'unknown',
      };
    }
    if (q === 'battery_series_max_count' || q === 'battery_parallel_max_count') {
      const direction = q === 'battery_series_max_count' ? 'series' : 'parallel';
      const r = new RegExp(
        `^Max (\\d+) batteries in ${direction}, up to \\d+(?:\\.\\d+)?(?:V|Ah at \\d+(?:\\.\\d+)?V)$`,
        'i',
      ).exec(raw.trim());
      if (!r || !Number.isSafeInteger(Number(r[1])) || Number(r[1]) < 1)
        throw new Error('Explicit source permission and positive count required');
      return {
        max_count: Number(r[1]),
        // The published voltage/Ah clause is retained without guessing whether
        // it denotes nominal class, maximum operating voltage or usable capacity.
        unmodeled_conditions: [raw],
        requires_matched_bank:
          /Use matched batteries of the same model, age, capacity, and state of charge/i.test(
            context,
          )
            ? true
            : null,
      };
    }
    if (q === 'instrument_shunt_rating') {
      const r = /^(\d+(?:\.\d+)?)\s*A\s*\/\s*(\d+(?:\.\d+)?)\s*mV$/.exec(raw.trim());
      if (
        !r ||
        ![r[1], r[2]].every((v) => Number.isFinite(Number(v))) ||
        Number(r[1]) <= 0 ||
        Number(r[2]) <= 0
      )
        throw new Error('Explicit shunt current/drop source pair required');
      return {
        nominal_current_a: Number(r[1]),
        nominal_drop_mv: Number(r[2]),
        electrical_domain: 'unknown',
      };
    }
    const r = /^±\s*(\d+(?:\.\d+)?)\s*%$/.exec(raw.trim());
    if (!r || !Number.isFinite(Number(r[1])))
      throw new Error(
        'Explicit published percentage accuracy required; resolution is a separate quantity',
      );
    const shunt = /with a (\d+(?:\.\d+)?)\s*A shunt/i.exec(context);
    // The retained BMV source supplies no denominator/range/calibration proof.
    // No interpretation of a bare percentage may supply reading or full-scale.
    return {
      quantity: q === 'instrument_current_accuracy_percent' ? 'current' : 'voltage',
      electrical_domain: 'unknown',
      percent: Number(r[1]),
      basis: 'unknown',
      ...(shunt && Number.isFinite(Number(shunt[1])) && Number(shunt[1]) > 0
        ? { required_shunt_a: Number(shunt[1]) }
        : {}),
    };
  }
  if (
    (q === 'voc_v' && /maximum PV open circuit voltage/i.test(context)) ||
    (q === 'isc_a' && /max(?:imum)?\.? PV short circuit current/i.test(context))
  )
    throw new Error('Controller input limit is not a module reference quantity');
  const m = /^([+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(V|A|W)?$/.exec(raw.trim());
  if (
    !m ||
    !Number.isFinite(Number(m[1])) ||
    Number(m[1]) <= 0 ||
    (m[2] ?? unit) !== contract.unit ||
    (unit !== undefined && unit !== contract.unit)
  )
    throw new Error('Profile member needs exact positive published value/unit');
  // Quantity and literal must be adjacent in the retained context. Finding Voc
  // anywhere in a paragraph cannot license assigning that paragraph's Vmp value.
  const literal = m[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Native source pairs establish adjacency structurally. Remove only published
  // parenthetical quantity symbols for this test; complete source wording and
  // conditions remain in the fact/profile proof. No field label typed by the
  // operator reaches this argument.
  const association = nativeLabel
    ? `${nativeLabel.replace(/\((?:Voc|Vmp|Isc|Imp|Pmax)\)/gi, '').trim()} ${raw}`
    : context;
  if (
    nativeLabel &&
    !new RegExp(`^(?:${contract.meaning.source})$`, 'i').test(
      nativeLabel.replace(/\((?:Voc|Vmp|Isc|Imp|Pmax)\)/gi, '').trim(),
    )
  )
    throw new Error(
      'The complete native label must name this quantity; a symbol inside another quantity is not its rating',
    );
  if (
    !new RegExp(
      `(?:${contract.meaning.source})\\s*[:=]?\\s*${literal}\\s*${contract.unit}\\b`,
      'i',
    ).test(association)
  )
    throw new Error('Profile quantity/literal association is not source established');
  return { value: Number(m[1]), unit: contract.unit };
}
/** Read-only source suggestions use the same complete-context qualification as
 * durable human corrections. A machine suggestion has no actor/event authority;
 * it neither writes a ready fact nor supplies missing model columns/conditions.
 * PDF page text and native table cells are not silently joined into assertions. */
export function suggestEngineeringProfileSources(
  intake: ProductIntake,
  documents: readonly DocumentExtractionArtifact[],
  facts: readonly QualifiedFactArtifact[] = [],
) {
  const suggestions: {
    authority: 'unreviewed_source_suggestion';
    statement: HumanSourceStatement;
    missing: string[];
    replaces_fact_ids?: string[];
    source_context?: string;
  }[] = [];
  const model = new RegExp(
    `(^|[^a-z0-9])${intake.product_model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
    'i',
  );
  for (const d of documents)
    for (const b of d.blocks) {
      if (b.kind === 'structured') {
        const citation = { document_id: d.id, block_id: b.id, quote: b.content ?? '' };
        try {
          const row = readSourceOwnedSpecification(citation, documents);
          if (![intake.product_model, intake.manufacturer_part_number].includes(row.identity))
            continue;
          if (
            facts.some((f) =>
              f.human_source?.statement.citations.some(
                (c) => c.document_id === d.id && c.block_id === b.id,
              ),
            )
          )
            continue;
          for (const [quantity, contract] of Object.entries(profileQuantityContracts)) {
            if (!contract.meaning.test(row.label)) continue;
            const statement: HumanSourceStatement = {
              label: row.label,
              value: row.value,
              wording: row.statement,
              citations: [citation],
              applicability: { relationship: 'source_record', citation },
              mapping: {
                kind: 'engineering_profile_fact',
                target: 'engineering_profile',
                quantity: quantity as ProfileQuantity,
              },
            };
            try {
              const fact = humanStatementFact({
                version: 'human-adjudication.v1',
                event_id: 'read-only-native-suggestion',
                statement_index: 0,
                intake,
                statement,
                documents,
              });
              previewHumanMapping(fact, statement.mapping!);
              const originals = facts.filter(
                (f) =>
                  f.source_capture.digest === d.source_capture.digest &&
                  !f.human_source &&
                  f.evidence?.some(
                    (e) => e.role === 'value' && e.locator?.path === row.value_locator,
                  ),
              );
              if (originals.length > 1) continue;
              suggestions.push({
                authority: 'unreviewed_source_suggestion',
                statement,
                source_context: row.containing_context,
                replaces_fact_ids: originals.map((f) => f.id),
                missing: [
                  'human_source_decision',
                  'manufacturer_revision',
                  'complete_intended_use_review',
                ],
              });
            } catch {
              /* Unsupported quantity/value or uncertain context remains visible raw evidence. */
            }
          }
        } catch {
          /* Old diagnostic structured blocks do not acquire new ownership. */
        }
        continue;
      }
      if (!b.content || !model.test(b.content)) continue;
      for (const [quantity, contract] of Object.entries(profileQuantityContracts)) {
        const re = new RegExp(
          `(?:${contract.meaning.source})\\s*[:=]?\\s*([+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))\\s*${contract.unit}\\b`,
          'gi',
        );
        const matches = [...b.content.matchAll(re)];
        if (matches.length !== 1) continue;
        const citation = { document_id: d.id, block_id: b.id, quote: b.content };
        const statement: HumanSourceStatement = {
          label: quantity,
          value: matches[0]![1]!,
          unit: contract.unit,
          wording: b.content,
          citations: [citation],
          applicability: { relationship: 'statement', citation },
          mapping: {
            kind: 'engineering_profile_fact',
            target: 'engineering_profile',
            quantity: quantity as ProfileQuantity,
          },
        };
        try {
          const fact = humanStatementFact({
            version: 'human-adjudication.v1',
            event_id: 'read-only-profile-suggestion',
            statement_index: 0,
            intake,
            statement,
            documents,
          });
          previewHumanMapping(fact, statement.mapping!);
          suggestions.push({
            authority: 'unreviewed_source_suggestion',
            statement,
            missing: [
              'human_source_decision',
              'manufacturer_revision',
              'reference_and_temperature_context',
              'installed_intended_use_review',
            ],
          });
        } catch {
          /* Missing complete source ownership/context withholds the suggestion. */
        }
      }
    }
  return suggestions;
}
