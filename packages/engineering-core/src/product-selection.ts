/** Node-only parts picker. Selection never owns architecture, preferences or installed instances. */
export * from './product-selection-contracts.js';
export { bindProductSelection, type SelectedRoleBinding } from './product-selection-handoff.js';
import defaultPolicy from '../../../data/rules/product-selection.json' with { type: 'json' };
import type { ComponentLibraryRecord } from './component-library.js';
import { validateComponentLibraryRecord } from './component-library.js';
import { parseArchitectureGeneration } from './architecture-generation.js';
import type { RequiredProductRole } from './architecture-generation-contracts.js';
import { passportDigest, serializePassportValue } from './portable-json.js';
import { enumerateProductWitnesses, evaluateProductWitness } from './product-binding-evaluation.js';
import type {
  ProductCandidateEvaluation,
  ProductSelectionInput,
  ProductSelectionPolicy,
  ProductSelectionResult,
  StorageAssemblyIntent,
} from './product-selection-contracts.js';
import { assertSelectionSchema } from './product-selection-validation.js';

export const PRODUCT_SELECTOR_REVISION = 'product-selection/1.0.0';
const freeze = (v: unknown): void => {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
};
freeze(defaultPolicy);
export const productSelectionPolicy = defaultPolicy as ProductSelectionPolicy;
const compareId = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const unique = (values: readonly string[], label: string) => {
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${label}.`);
};

/** Minimum homogeneous counts are provable only for explicit scalar unit V/Wh and role V/Wh.
 * No quantity search, dispatch, efficiency or load-power arithmetic enters this reduction.
 * Unknown inputs retain a symbolic unresolved assembly, never an arbitrary quantity assumption.
 */
const minimumAssembly = (
  role: RequiredProductRole,
  record: ComponentLibraryRecord,
): StorageAssemblyIntent | undefined => {
  const voltageGates = role.constraints.filter((c) => c.kind === 'nominal_voltage');
  const energyGates = role.constraints.filter((c) => c.kind === 'minimum_nominal_storage_energy');
  const unitV = record.electrical?.nominal_voltage_v;
  const unitWh =
    record.battery?.nominal_energy_wh ??
    (typeof unitV === 'number' && typeof record.battery?.nominal_capacity_ah === 'number'
      ? unitV * record.battery.nominal_capacity_ah
      : undefined);
  if (
    record.verification_status !== 'verified' ||
    typeof unitV !== 'number' ||
    unitV <= 0 ||
    voltageGates.length !== 1 ||
    (energyGates.length && (unitWh === undefined || unitWh <= 0))
  )
    return undefined;
  const series = voltageGates[0]!.voltage_v / unitV;
  // A noninteger positive ratio cannot meet exact scalar nominal voltage with this
  // homogeneous unit. The direct candidate still records its actual contradiction.
  if (!Number.isSafeInteger(series) || series < 1)
    return { kind: 'homogeneous', component_id: record.id, series_count: 1, parallel_count: 1 };
  const requiredParallel = energyGates.length
    ? Math.max(1, ...energyGates.map((c) => Math.ceil(c.energy_wh / (unitWh! * series))))
    : 1;
  // A published minimum interconnected string count can raise the minimum
  // feasible bank above the energy-only minimum. A single native unit is not
  // an interconnected bank, so it does not inherit that stacking requirement.
  const parallel =
    requiredParallel > 1
      ? Math.max(requiredParallel, record.battery?.allowed_parallel_count?.min ?? requiredParallel)
      : requiredParallel;
  return {
    kind: 'homogeneous',
    component_id: record.id,
    series_count: series,
    parallel_count: parallel,
  };
};

export const evaluateProductSelection = (
  input: ProductSelectionInput,
  policy: ProductSelectionPolicy = productSelectionPolicy,
): ProductSelectionResult => {
  assertSelectionSchema(input, 'input');
  assertSelectionSchema(policy, 'policy');
  // Canonical encoding rejects hidden/accessor/nonportable input before cloning.
  // Complete Phase 4 reconstruction prevents a detached forged predicate becoming authority.
  const generation = parseArchitectureGeneration(serializePassportValue(input.generation));
  const cloned = JSON.parse(serializePassportValue(input)) as ProductSelectionInput;
  const snapshot = { ...cloned, corpus: [...cloned.corpus].sort(compareId) };
  const policySnapshot = JSON.parse(serializePassportValue(policy)) as ProductSelectionPolicy;
  const architecture = generation.candidates.find((c) => c.id === snapshot.candidate_id);
  if (!architecture) throw new TypeError('Selection references a missing Phase 4 candidate.');
  const corpus = [...snapshot.corpus].sort(compareId);
  if (corpus.length > policy.bounds.max_products)
    throw new TypeError('Product corpus exceeds policy bound; nothing was truncated.');
  unique(
    corpus.map((c) => c.id),
    'component ID',
  );
  unique(
    snapshot.fixed_existing.map((f) => f.role_id),
    'fixed role',
  );
  // Each explicit assembly requires at least one witness evaluation. This same
  // work budget also bounds intent admission, including duplicates, before scans.
  if (snapshot.assemblies.length > policy.bounds.max_total_bindings)
    throw new TypeError('Assembly intent admission exceeds policy bound; nothing was truncated.');
  // User intent is admitted before generated-candidate reuse. Duplicate explicit
  // requests and intents shadowed by a fixed role must never silently disappear.
  unique(
    snapshot.assemblies.map((a) => serializePassportValue(a)),
    'explicit assembly intent',
  );
  if (snapshot.assemblies.some((a) => snapshot.fixed_existing.some((f) => f.role_id === a.role_id)))
    throw new TypeError('A fixed role cannot also have standalone assembly intents.');
  for (const record of corpus) {
    const validation = validateComponentLibraryRecord(record);
    if (!validation.ok)
      throw new TypeError(
        `Invalid selection component '${record.id}': ${validation.errors.join('; ')}`,
      );
    if (
      record.unsupported_capabilities?.some((type) =>
        record.capabilities?.some((c) => c.type === type),
      )
    )
      throw new TypeError('Conflicting positive and negative capability assertions.');
  }
  for (const intent of [...snapshot.fixed_existing, ...snapshot.assemblies]) {
    const role = architecture.required_roles.find((r) => r.id === intent.role_id);
    if (!role) throw new TypeError('Binding intent references a nonmandatory role.');
    const assembly = 'series_count' in intent ? intent : intent.assembly;
    if (
      assembly &&
      (role.binding_scope !== 'storage_assembly' || assembly.component_id !== intent.component_id)
    )
      throw new TypeError('Assembly intent must bind its exact model to a storage-assembly role.');
  }
  let totalBindings = 0;
  const evaluate = (
    role: RequiredProductRole,
    record: ComponentLibraryRecord | undefined,
    componentId: string,
    fixed: boolean,
    assembly?: StorageAssemblyIntent,
  ): ProductCandidateEvaluation => {
    if (
      assembly &&
      (!Number.isSafeInteger(assembly.series_count * assembly.parallel_count) ||
        assembly.series_count * assembly.parallel_count > policy.bounds.max_assembly_units)
    )
      throw new TypeError('Assembly exceeds policy unit bound; nothing was truncated.');
    if (!record) {
      if (++totalBindings > policy.bounds.max_total_bindings)
        throw new TypeError('Total selection work exceeds policy bound; nothing was truncated.');
      // A missing owned record still gets every mandatory UNKNOWN gate. Null
      // witnesses assert no product port/path identity, and evidence stays empty.
      const witness = {
        interfaces: Object.fromEntries(
          role.constraints.filter((c) => c.kind === 'interface').map((c) => [c.interface_id, null]),
        ),
        paths: Object.fromEntries(
          role.constraints
            .filter((c) => c.kind === 'directed_power_path')
            .map((c) => [c.path_id, null]),
        ),
      };
      return {
        component_id: componentId,
        fixed_existing: fixed,
        ...(assembly ? { assembly } : {}),
        status: 'UNRESOLVED',
        reasons: ['fixed_component_record_missing'],
        bindings: [
          {
            id: `binding.${passportDigest({ component_id: componentId, witness, ...(assembly ? { assembly } : {}) }).slice(7)}`,
            witness,
            status: 'UNRESOLVED',
            gates: [...role.constraints].sort(compareId).map((constraint) => ({
              constraint,
              truth: 'UNKNOWN',
              reason: 'fixed_component_record_missing',
              evidence: [],
            })),
            assembly_gates: assembly
              ? (
                  [
                    ['series', assembly.series_count],
                    ['parallel', assembly.parallel_count],
                  ] as const
                )
                  .filter(([, count]) => count > 1)
                  .map(([axis, count]) => ({
                    axis,
                    count,
                    truth: 'UNKNOWN',
                    reason: 'fixed_component_record_missing',
                    evidence: [],
                  }))
              : [],
            calculations: [],
          },
        ],
      };
    }
    const witnesses = enumerateProductWitnesses(role, record, policySnapshot);
    if (totalBindings + witnesses.length > policy.bounds.max_total_bindings)
      throw new TypeError('Total selection work exceeds policy bound; nothing was truncated.');
    totalBindings += witnesses.length;
    const bindings = witnesses.map((w) =>
      evaluateProductWitness(architecture, role, record, w, assembly),
    );
    // Existential binding: one complete witness proves eligibility. Separate gate
    // truths from different witnesses are never unioned. Every witness remains retained.
    const status = bindings.some((b) => b.status === 'ELIGIBLE')
      ? 'ELIGIBLE'
      : bindings.some((b) => b.status === 'UNRESOLVED')
        ? 'UNRESOLVED'
        : 'BLOCKED';
    return {
      component_id: componentId,
      fixed_existing: fixed,
      ...(assembly ? { assembly } : {}),
      status,
      reasons: [
        ...new Set([
          ...bindings.flatMap((b) => [
            ...b.gates.map((g) => g.reason),
            ...b.assembly_gates.map((g) => g.reason),
          ]),
          ...(role.output_capacity.some(
            (c) => c.scope === 'required_output_sizing' && c.status === 'unresolved',
          )
            ? ['upstream_requirement_unresolved' as const]
            : []),
        ]),
      ].sort(),
      bindings,
    };
  };
  const roles = [...architecture.required_roles].sort(compareId).map((role) => {
    const fixed = snapshot.fixed_existing.find((f) => f.role_id === role.id);
    const candidates: ProductCandidateEvaluation[] = [];
    if (fixed)
      candidates.push(
        evaluate(
          role,
          corpus.find((c) => c.id === fixed.component_id),
          fixed.component_id,
          true,
          fixed.assembly,
        ),
      );
    else {
      for (const record of corpus) {
        candidates.push(evaluate(role, record, record.id, false));
        if (role.binding_scope !== 'storage_assembly') continue;
        const minimum = minimumAssembly(role, record);
        if (
          !minimum &&
          !(
            record.verification_status === 'verified' &&
            record.unsupported_capabilities?.includes('energy_storage')
          )
        )
          candidates.push({
            component_id: record.id,
            fixed_existing: false,
            assembly_generation: 'unresolved',
            status: 'UNRESOLVED',
            reasons: ['assembly_reduction_unresolved'],
            bindings: [],
          });
        else if (minimum && (minimum.series_count !== 1 || minimum.parallel_count !== 1))
          candidates.push(evaluate(role, record, record.id, false, minimum));
      }
      const explicit = snapshot.assemblies
        .filter((a) => a.role_id === role.id)
        .map(({ role_id: _role, ...a }) => a);
      for (const assembly of explicit) {
        const record = corpus.find((c) => c.id === assembly.component_id);
        if (!record) throw new TypeError('Explicit nonfixed assembly references a missing record.');
        if (
          !candidates.some(
            (c) =>
              c.assembly && serializePassportValue(c.assembly) === serializePassportValue(assembly),
          )
        )
          candidates.push(evaluate(role, record, record.id, false, assembly));
      }
    }
    candidates.sort((a, b) => {
      const x = serializePassportValue([
        a.component_id,
        a.assembly ?? null,
        a.assembly_generation ?? null,
      ]);
      const y = serializePassportValue([
        b.component_id,
        b.assembly ?? null,
        b.assembly_generation ?? null,
      ]);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return {
      role,
      candidates,
      upstream_unresolved: role.output_capacity.filter(
        (c) => c.scope === 'required_output_sizing' && c.status === 'unresolved',
      ),
      deferred_scopes: role.output_capacity.filter((c) => c.scope !== 'required_output_sizing'),
    };
  });
  const body = {
    schema_version: '1.0.0' as const,
    selector_revision: PRODUCT_SELECTOR_REVISION,
    input: snapshot,
    input_digest: passportDigest(snapshot),
    corpus_digest: passportDigest(corpus),
    architecture_digest: architecture.candidate_digest,
    policy: policySnapshot,
    policy_digest: passportDigest(policySnapshot),
    roles,
    warnings: policy.status === 'approved' ? [] : ['selection_policy_requires_human_review'],
  };
  return { ...body, result_digest: passportDigest(body) };
};

const reconstruct = (value: unknown): ProductSelectionResult => {
  assertSelectionSchema(value, 'result');
  const result = value as ProductSelectionResult;
  if (result.selector_revision !== PRODUCT_SELECTOR_REVISION)
    throw new TypeError('Unsupported selector revision.');
  const { result_digest: digest, ...body } = result;
  if (passportDigest(body) !== digest) throw new TypeError('Selection integrity mismatch.');
  const reproduced = evaluateProductSelection(result.input, result.policy);
  if (serializePassportValue(reproduced) !== serializePassportValue(result))
    throw new TypeError('Selection does not reproduce from exact authoritative inputs.');
  return reproduced;
};
export const serializeProductSelection = (result: ProductSelectionResult): string =>
  serializePassportValue(reconstruct(result));
export const parseProductSelection = (serialized: string): ProductSelectionResult =>
  reconstruct(JSON.parse(serialized) as unknown);
export const replayProductSelection = (
  result: ProductSelectionResult,
  input: ProductSelectionInput,
  policy: ProductSelectionPolicy = productSelectionPolicy,
): ProductSelectionResult => {
  const live = evaluateProductSelection(input, policy);
  if (live.input_digest !== result.input_digest || live.policy_digest !== result.policy_digest)
    throw new TypeError('Selection replay input/corpus/policy changed.');
  return reconstruct(result);
};
