import type { CapabilityType, ComponentLibraryRecord } from './component-library.js';
import type {
  FactState,
  FactProvenance,
  TradeoffFact,
  RecommendationContext,
  PreferenceCriterion,
  SelectionOptionSource,
  SystemOptionChoice,
} from './recommendation-contracts.js';
import { passportDigest } from './portable-json.js';

export const criterionFactKind = (criterion: PreferenceCriterion): string =>
  criterion.kind === 'optional_capability'
    ? `optional_capability.${criterion.capability}`
    : criterion.kind === 'optional_feature'
      ? `optional_feature.${criterion.feature}`
      : criterion.kind;

/** Cardinality mirrors the emitted semantic kinds, including the separately owned
 * advisory summary added by the orchestrator. This preflight controls option ×
 * component × optional-feature growth before passports/facts are allocated.
 */
export const tradeoffFactCount = (
  source: SelectionOptionSource,
  choice: SystemOptionChoice,
  context: RecommendationContext,
  criteria: readonly PreferenceCriterion[],
): number => {
  const capabilities = new Set([
    'monitoring',
    'communication',
    ...criteria.filter((c) => c.kind === 'optional_capability').map((c) => c.capability),
  ]);
  const features = new Set([
    ...context.features
      .filter((f) => choice.bindings.some((b) => b.component_id === f.component_id))
      .map((f) => f.feature),
    ...criteria.filter((c) => c.kind === 'optional_feature').map((c) => c.feature),
  ]);
  const componentKinds = [
    'weight',
    'dimensions',
    'manufacturer',
    'physical_quantity',
    'fixed_existing_quantity',
    'selected_power_paths',
    'purchase_cost',
  ];
  const systemKinds = [
    'weight',
    'purchase_cost',
    'component_count',
    'reuse_existing',
    'selected_power_path_count',
    'manufacturer_count',
    'advisory_context',
  ];
  return (
    systemKinds.length +
    capabilities.size +
    features.size +
    choice.bindings.reduce(
      (n, b) =>
        n +
        componentKinds.length +
        capabilities.size +
        features.size +
        (source.selection.input.corpus
          .find((c) => c.id === b.component_id)
          ?.qualified_values?.filter((q) => q.target === 'dimensions_mm').length ?? 0),
      0,
    )
  );
};
const known = (
  value: number | boolean | string | Readonly<Record<string, unknown>>,
): FactState => ({ state: 'known', value });
const unknown = (reason: string): FactState => ({ state: 'unknown', reason });
const complete = (state: FactState): TradeoffFact['completeness'] =>
  state.state === 'unknown'
    ? 'incomplete'
    : state.state === 'not_applicable'
      ? 'not_applicable'
      : 'complete';
const numeric = (fact: TradeoffFact): number | undefined =>
  fact.fact.state === 'known' && typeof fact.fact.value === 'number' ? fact.fact.value : undefined;
const derivation = (record: ComponentLibraryRecord, pointer: string): unknown => {
  const fields = record.derived_fields;
  return fields && typeof fields === 'object'
    ? (fields as Readonly<Record<string, unknown>>)[pointer.slice(1)]
    : undefined;
};
const productProvenance = (
  record: ComponentLibraryRecord,
  pointer: string,
  recordDigest: string,
): FactProvenance => ({
  owner: 'canonical_product',
  snapshot_digest: recordDigest,
  pointer,
  source_refs: record.source_refs ?? [],
  verification_status: record.verification_status,
  source_native_representation: 'not_retained_in_canonical_record',
  ...(derivation(record, pointer) === undefined
    ? {}
    : { product_derivation: derivation(record, pointer) }),
});
const contextProvenance = (
  contextDigest: string,
  pointer: string,
  source: import('./recommendation-contracts.js').ObservationSource,
): FactProvenance => ({
  owner: source.owner,
  snapshot_digest: contextDigest,
  pointer,
  source_refs: [
    {
      id: source.reference,
      title: source.context,
      ...(source.observed_at === undefined ? {} : { observed_at: source.observed_at }),
    },
  ],
});
const accepted = (record: ComponentLibraryRecord, value: unknown, reason: string): FactState =>
  record.verification_status !== 'verified'
    ? unknown('canonical_record_not_verified')
    : value === null || value === undefined
      ? unknown(reason)
      : known(value as number | Readonly<Record<string, unknown>>);

/** Counts are selected physical units, including bank units. Project demand endpoints
 * are not devices. A reused model in separate roles contributes separately.
 * Optional capability aggregation means a product function exists somewhere in
 * this exact system; it proves no installed protocol, integration or measurement target.
 */
export const deriveTradeoffFacts = (
  optionId: string,
  source: SelectionOptionSource,
  choice: SystemOptionChoice,
  context: RecommendationContext,
  criteria: readonly PreferenceCriterion[],
): TradeoffFact[] => {
  const facts: TradeoffFact[] = [];
  // Snapshot identity is evaluation-local. Hash unchanged context/records once,
  // rather than reserializing a large observation set for every derived fact.
  const contextDigest = passportDigest(context);
  const system = { kind: 'system' as const };
  const selection = source.selection;
  const add = (
    kind: string,
    subject: TradeoffFact['subject'],
    fact: FactState,
    unit: string | null,
    provenance: readonly FactProvenance[],
    calculation?: TradeoffFact['calculation'],
  ): TradeoffFact => {
    const id = `fact.${passportDigest({ option_id: optionId, kind, subject }).slice(7)}`;
    const value: TradeoffFact = {
      id,
      kind,
      option_id: optionId,
      subject,
      fact,
      unit,
      provenance,
      identity:
        calculation ||
        provenance.some(
          (p) => p.owner === 'engineering_derived' || p.product_derivation !== undefined,
        )
          ? 'derived'
          : 'direct',
      completeness: complete(fact),
      ...(calculation ? { calculation } : {}),
    };
    facts.push(value);
    return value;
  };
  const selected = choice.bindings.map((binding) => {
    const role = selection.roles.find((r) => r.role.id === binding.role_id)!;
    const candidate = role.candidates.find(
      (c) =>
        c.component_id === binding.component_id &&
        c.bindings.some((b) => b.id === binding.binding_id),
    )!;
    const record = selection.input.corpus.find((c) => c.id === binding.component_id)!;
    const quantity = binding.assembly
      ? binding.assembly.series_count * binding.assembly.parallel_count
      : 1;
    const roleIndex = selection.roles.indexOf(role);
    const candidateIndex = role.candidates.indexOf(candidate);
    const witness = candidate.bindings.find((b) => b.id === binding.binding_id)!;
    const witnessPointer = `/roles/${roleIndex}/candidates/${candidateIndex}/bindings/${candidate.bindings.indexOf(witness)}`;
    return {
      binding,
      candidate,
      record,
      recordDigest: passportDigest(record),
      quantity,
      witness,
      witnessPointer,
      subject: {
        kind: 'component' as const,
        role_id: binding.role_id,
        component_id: binding.component_id,
        quantity,
      },
    };
  });
  const weights: TradeoffFact[] = [];
  const costs: TradeoffFact[] = [];
  const reuse: TradeoffFact[] = [];
  const manufacturers: TradeoffFact[] = [];
  const quantities: TradeoffFact[] = [];
  const stages: TradeoffFact[] = [];
  const capabilities = [
    ...new Set([
      'monitoring',
      'communication',
      ...criteria.filter((c) => c.kind === 'optional_capability').map((c) => c.capability),
    ]),
  ].sort() as CapabilityType[];
  const features = [
    ...new Set([
      ...context.features
        .filter((f) => selected.some((s) => s.record.id === f.component_id))
        .map((f) => f.feature),
      ...criteria.filter((c) => c.kind === 'optional_feature').map((c) => c.feature),
    ]),
  ].sort();
  const optional = new Map<string, TradeoffFact[]>();
  const remember = (kind: string, fact: TradeoffFact) =>
    optional.set(kind, [...(optional.get(kind) ?? []), fact]);
  for (const s of selected) {
    const canonicalProvenance = (pointer: string) =>
      productProvenance(s.record, pointer, s.recordDigest);
    weights.push(
      add('weight', s.subject, accepted(s.record, s.record.weight_kg, 'weight_missing'), 'kg', [
        canonicalProvenance('/weight_kg'),
      ]),
    );
    add(
      'dimensions',
      s.subject,
      accepted(s.record, s.record.dimensions_mm, 'dimensions_missing'),
      'mm',
      [canonicalProvenance('/dimensions_mm')],
    );
    // Qualified body assertions remain individually scoped and never become an envelope.
    for (const [index, q] of (s.record.qualified_values ?? []).entries())
      if (q.target === 'dimensions_mm')
        add(
          `qualified_dimensions.${q.id}`,
          s.subject,
          accepted(s.record, { value: q.value, qualifiers: q.qualifiers }, 'dimensions_missing'),
          'mm',
          [canonicalProvenance(`/qualified_values/${index}`)],
        );
    manufacturers.push(
      add(
        'manufacturer',
        s.subject,
        s.record.manufacturer.trim()
          ? known(s.record.manufacturer)
          : unknown('manufacturer_missing'),
        null,
        [canonicalProvenance('/manufacturer')],
      ),
    );
    const selectionProvenance: FactProvenance[] = [
      {
        owner: 'engineering_derived',
        snapshot_digest: selection.result_digest,
        pointer: s.witnessPointer,
        source_refs: [],
      },
    ];
    const rawCalculation = (
      value: number,
      formula: string,
      inputs: readonly { pointer: string; value: unknown; unit: string | null }[],
    ): TradeoffFact['calculation'] => ({
      formula,
      inputs: [],
      source_inputs: inputs.map((i) => ({ ...i, snapshot_digest: selection.result_digest })),
      known_subtotals: [{ value, unit: 'count' }],
      unresolved_contributors: [],
    });
    const quantityInput = s.binding.assembly
      ? {
          pointer: s.witnessPointer.replace(/\/bindings\/[^/]+$/, '') + '/assembly',
          value: s.binding.assembly,
          unit: 'count',
        }
      : {
          pointer: s.witnessPointer.replace(/\/candidates\/.+$/, '/role'),
          value: selection.roles.find((r) => r.role.id === s.binding.role_id)!.role,
          unit: null,
        };
    const quantityFact = add(
      'physical_quantity',
      s.subject,
      known(s.quantity),
      'count',
      selectionProvenance,
      rawCalculation(
        s.quantity,
        s.binding.assembly
          ? 'series_count * parallel_count'
          : 'one selected single-device role = one physical instance',
        [quantityInput],
      ),
    );
    quantities.push(quantityFact);
    const reused = s.candidate.fixed_existing ? s.quantity : 0;
    reuse.push(
      add('fixed_existing_quantity', s.subject, known(reused), 'count', selectionProvenance, {
        ...rawCalculation(reused, 'fixed_existing ? selected_physical_quantity : 0', [
          {
            pointer: s.witnessPointer.replace(/\/bindings\/[^/]+$/, '') + '/fixed_existing',
            value: s.candidate.fixed_existing,
            unit: null,
          },
        ])!,
        inputs: [{ fact_id: quantityFact.id, quantity: 1 }],
      }),
    );
    // Count exact selected functional paths, not every function offered by a product.
    const pathCount = Object.keys(s.witness.witness.paths).length;
    stages.push(
      add(
        'selected_power_paths',
        s.subject,
        known(pathCount),
        'count',
        selectionProvenance,
        rawCalculation(pathCount, 'count(exact selected functional path identities)', [
          {
            pointer: s.witnessPointer + '/witness/paths',
            value: s.witness.witness.paths,
            unit: 'count',
          },
        ]),
      ),
    );
    const ownedIndex = context.owned_acquisition.findIndex(
      (o) => o.selection_digest === selection.result_digest && o.role_id === s.binding.role_id,
    );
    const priceIndex = context.prices.findIndex((p) => p.component_id === s.record.id);
    const owned = context.owned_acquisition[ownedIndex];
    const price = context.prices[priceIndex];
    costs.push(
      owned
        ? add('purchase_cost', s.subject, known(0), owned.currency, [
            contextProvenance(contextDigest, `/owned_acquisition/${ownedIndex}`, owned.source),
          ])
        : price
          ? add('purchase_cost', s.subject, known(price.amount), price.currency, [
              contextProvenance(contextDigest, `/prices/${priceIndex}`, price.source),
            ])
          : add('purchase_cost', s.subject, unknown('purchase_cost_missing'), null, [
              {
                owner: 'commercial',
                snapshot_digest: contextDigest,
                pointer: '/prices',
                source_refs: [],
              },
            ]),
    );
    for (const capability of capabilities) {
      const present = s.record.capabilities?.some((c) => c.type === capability);
      const absent = s.record.unsupported_capabilities?.includes(capability);
      const fact: FactState =
        s.record.verification_status !== 'verified'
          ? unknown('canonical_record_not_verified')
          : present
            ? known(true)
            : absent
              ? { state: 'absent' }
              : unknown('optional_capability_unknown');
      const kind = `optional_capability.${capability}`;
      remember(
        kind,
        add(kind, s.subject, fact, null, [
          canonicalProvenance(present ? '/capabilities' : '/unsupported_capabilities'),
        ]),
      );
    }
    for (const feature of features) {
      const index = context.features.findIndex(
        (f) => f.feature === feature && f.component_id === s.record.id,
      );
      const observation = context.features[index];
      const kind = `optional_feature.${feature}`;
      remember(
        kind,
        add(
          kind,
          s.subject,
          observation?.fact ?? unknown('optional_feature_unknown'),
          null,
          observation
            ? [contextProvenance(contextDigest, `/features/${index}`, observation.source)]
            : [
                {
                  owner: 'user',
                  snapshot_digest: contextDigest,
                  pointer: '/features',
                  source_refs: [],
                },
              ],
        ),
      );
    }
  }
  const total = (kind: string, inputs: readonly TradeoffFact[], unit: string | null) => {
    const unresolved = inputs
      .filter((f) => numeric(f) === undefined)
      .map((f) => ({
        fact_id: f.id,
        reason: f.fact.state === 'unknown' ? f.fact.reason : 'comparison_incomplete',
      }));
    const byUnit = new Map<string, number>();
    for (const f of inputs)
      if (numeric(f) !== undefined && f.unit !== null)
        byUnit.set(
          f.unit,
          (byUnit.get(f.unit) ?? 0) +
            numeric(f)! * (f.subject.kind === 'component' ? f.subject.quantity : 1),
        );
    if (!inputs.length && unit !== null) byUnit.set(unit, 0);
    const mixed = byUnit.size > 1;
    if (mixed) for (const f of inputs) unresolved.push({ fact_id: f.id, reason: 'mixed_currency' });
    const knownSubtotals = [...byUnit]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([unit, value]) => ({ unit, value }));
    if (knownSubtotals.some((s) => !Number.isFinite(s.value)))
      throw new TypeError('Tradeoff arithmetic overflow.');
    const resultUnit = knownSubtotals.length === 1 ? knownSubtotals[0]!.unit : unit;
    add(
      kind,
      system,
      !unresolved.length && knownSubtotals.length === 1
        ? known(knownSubtotals[0]!.value)
        : unknown(
            mixed
              ? 'mixed_currency'
              : unresolved.length
                ? 'comparison_incomplete'
                : 'cost_currency_missing',
          ),
      resultUnit,
      inputs.flatMap((f) => f.provenance),
      {
        formula:
          'sum(per_unit_value * selected_physical_quantity), independently per unit/currency',
        inputs: inputs.map((f) => ({
          fact_id: f.id,
          quantity: f.subject.kind === 'component' ? f.subject.quantity : 1,
        })),
        known_subtotals: knownSubtotals,
        unresolved_contributors: unresolved,
      },
    );
  };
  total('weight', weights, 'kg');
  total('purchase_cost', costs, null);
  // Quantity facts already represent whole-role counts; do not multiply bank counts twice.
  const count = (kind: string, inputs: readonly TradeoffFact[], formula: string) =>
    add(
      kind,
      system,
      known(inputs.reduce((n, f) => n + numeric(f)!, 0)),
      'count',
      inputs.flatMap((f) => f.provenance),
      {
        formula,
        inputs: inputs.map((f) => ({ fact_id: f.id, quantity: 1 })),
        known_subtotals: [{ value: inputs.reduce((n, f) => n + numeric(f)!, 0), unit: 'count' }],
        unresolved_contributors: [],
      },
    );
  count('component_count', quantities, 'sum(selected_physical_quantity)');
  count('reuse_existing', reuse, 'sum(fixed_existing_physical_quantity)');
  count(
    'selected_power_path_count',
    stages,
    'sum(number_of_exact_selected_functional_paths_per_role)',
  );
  const manufacturerUnknown = manufacturers.filter((f) => f.fact.state !== 'known');
  const manufacturerCount = new Set(
    manufacturers.flatMap((f) => (f.fact.state === 'known' ? [f.fact.value] : [])),
  ).size;
  add(
    'manufacturer_count',
    system,
    manufacturerUnknown.length ? unknown('manufacturer_missing') : known(manufacturerCount),
    'count',
    manufacturers.flatMap((f) => f.provenance),
    {
      formula: 'count(distinct exact manufacturer identities)',
      inputs: manufacturers.map((f) => ({ fact_id: f.id, quantity: 1 })),
      known_subtotals: [{ value: manufacturerCount, unit: 'count' }],
      unresolved_contributors: manufacturerUnknown.map((f) => ({
        fact_id: f.id,
        reason: 'manufacturer_missing',
      })),
    },
  );
  for (const [kind, inputs] of optional) {
    const anyPresent = inputs.some((f) => f.fact.state === 'known' && f.fact.value === true);
    const applicable = inputs.filter((f) => f.fact.state !== 'not_applicable');
    const allAbsent =
      applicable.length > 0 &&
      applicable.every(
        (f) => f.fact.state === 'absent' || (f.fact.state === 'known' && f.fact.value === false),
      );
    const fact: FactState = anyPresent
      ? known(true)
      : allAbsent
        ? { state: 'absent' }
        : !applicable.length
          ? { state: 'not_applicable', reason: 'no_applicable_selected_component' }
          : unknown('optional_capability_unknown');
    add(
      kind,
      system,
      fact,
      null,
      inputs.flatMap((f) => f.provenance),
      {
        formula:
          'any selected component explicitly present; else every applicable component explicitly absent; else unknown',
        inputs: inputs.map((f) => ({ fact_id: f.id, quantity: 1 })),
        known_subtotals: [],
        // Even when one present product proves existential availability, remaining
        // component unknowns stay visible. They do not invalidate that narrower proof.
        unresolved_contributors: inputs
          .filter((f) => f.fact.state === 'unknown')
          .map((f) => ({
            fact_id: f.id,
            reason: f.fact.state === 'unknown' ? f.fact.reason : 'comparison_incomplete',
          })),
      },
    );
  }
  // No components still needs explicit system facts for requested optional criteria.
  for (const criterion of criteria)
    if (!facts.some((f) => f.subject.kind === 'system' && f.kind === criterionFactKind(criterion)))
      add(
        criterionFactKind(criterion),
        system,
        { state: 'not_applicable', reason: 'no_applicable_selected_component' },
        null,
        [],
      );
  return facts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};
