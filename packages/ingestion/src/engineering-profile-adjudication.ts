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
export const PROFILE_ADJUDICATION_VERSION = 'engineering-profile-adjudication.v1';
export type ProfileQuantity =
  | 'voc_v'
  | 'vmp_v'
  | 'isc_a'
  | 'imp_a'
  | 'pmax_w'
  | 'max_system_v'
  | 'pv_absolute_voc_v'
  | 'pv_max_isc_a';
export const profileQuantityContracts: Record<
  ProfileQuantity,
  { unit: 'V' | 'A' | 'W'; meaning: RegExp }
> = {
  voc_v: { unit: 'V', meaning: /open[ -]?circuit voltage|\bVoc\b/i },
  vmp_v: { unit: 'V', meaning: /voltage at (?:Pmax|maximum power)|\bVmp\b/i },
  isc_a: { unit: 'A', meaning: /short[ -]?circuit current|\bIsc\b/i },
  imp_a: { unit: 'A', meaning: /current at (?:Pmax|maximum power)|\bImp\b/i },
  pmax_w: { unit: 'W', meaning: /maximum power|\bPmax\b/i },
  max_system_v: { unit: 'V', meaning: /max(?:imum)? system voltage/i },
  pv_absolute_voc_v: { unit: 'V', meaning: /maximum PV open circuit voltage/i },
  pv_max_isc_a: { unit: 'A', meaning: /max(?:imum)?\.? PV short circuit current/i },
};
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
      member = previewHumanMapping(qf, mapping).normalized_value as { value: number; unit: string };
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
        version: PROFILE_ADJUDICATION_VERSION,
        event_id: proof.event_id,
        fact_id: qf.id,
        source_document_revision: source.document_revision ?? null,
        source_unit: proof.statement.unit ?? member.unit,
      },
    });
    const value = { value: member.value, unit: member.unit, evidence_ids: [eId] };
    if (q.startsWith('pv_')) {
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
): JsonValue {
  const contract = profileQuantityContracts[q];
  if (!contract || !contract.meaning.test(context))
    throw new Error('Exact source quantity meaning is not established');
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
  if (
    !new RegExp(
      `(?:${contract.meaning.source})\\s*[:=]?\\s*${literal}\\s*${contract.unit}\\b`,
      'i',
    ).test(context)
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
) {
  const suggestions: {
    authority: 'unreviewed_source_suggestion';
    statement: HumanSourceStatement;
    missing: string[];
  }[] = [];
  const model = new RegExp(
    `(^|[^a-z0-9])${intake.product_model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`,
    'i',
  );
  for (const d of documents)
    for (const b of d.blocks) {
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
