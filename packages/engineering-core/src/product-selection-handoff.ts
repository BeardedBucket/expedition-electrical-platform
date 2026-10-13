import type { ComponentLibraryRecord } from './component-library.js';
import { bindInstalledPv, type InstalledPvScenario } from './installed-pv-bridge.js';
import type {
  WholeSystemEvaluationInput,
  InstalledSystemRequirements,
} from './engineering-passport-contracts.js';
import type {
  ProductSelectionResult,
  StorageAssemblyIntent,
} from './product-selection-contracts.js';
import { parseProductSelection } from './product-selection.js';
import { serializePassportValue } from './portable-json.js';
import type { ArchitectureDemandEndpoint } from './architecture-generation-contracts.js';

type ExactDemandSchedule = {
  readonly demand_id: string;
  readonly schedule: NonNullable<
    NonNullable<InstalledSystemRequirements['project_demands']>[number]['schedule']
  >;
};

/** Reference/ownership admission is reusable before option-space expansion, including
 * when no product choice can materialize. This does not evaluate schedule engineering.
 */
export const assertExactDemandSchedules = (
  demands: readonly ArchitectureDemandEndpoint[],
  schedules: readonly ExactDemandSchedule[],
): void => {
  if (new Set(schedules.map((s) => s.demand_id)).size !== schedules.length)
    throw new TypeError('Duplicate exact project demand schedule.');
  for (const schedule of schedules) {
    const demand = demands.find((d) => d.id === schedule.demand_id);
    if (!demand)
      throw new TypeError('Exact schedule references a missing requirement-owned demand.');
    if (
      demand.schedule !== undefined &&
      serializePassportValue(demand.schedule) !== serializePassportValue(schedule.schedule)
    )
      throw new TypeError('Exact timing cannot replace an upstream requirement-owned schedule.');
  }
};

export interface SelectedRoleBinding {
  readonly role_id: string;
  readonly component_id: string;
  readonly binding_id: string;
  readonly assembly?: StorageAssemblyIntent;
}

/** Caller selects exact witnesses; this adapter neither ranks nor picks one implicitly.
 * One distinct instance per Phase 4 role prevents accidental physical reuse of a model.
 * Missing/null witnesses are rejected: an exact system cannot manufacture absent ports
 * or a missing owned product. Such selection artifacts remain portable for upstream work.
 */
export const bindProductSelection = (
  selection: ProductSelectionResult,
  choices: readonly SelectedRoleBinding[],
  options: {
    readonly installed_pv?: InstalledPvScenario;
    /** Solar source models are installation evidence, not new Phase 4 roles.
     * Each explicit module port is associated with an existing source endpoint;
     * no missing port, source capacity or manufacturer permission is inferred. */
    readonly pv_modules?: readonly {
      instance_id: string;
      record: ComponentLibraryRecord;
      port_id: string;
      source_endpoint_id: string;
    }[];
    readonly evaluation_hours?: number;
    readonly device_states?: InstalledSystemRequirements['load_states'];
    /** Later exact-evaluation timing for requirement-owned endpoints. Existing
     * Phase 4 schedules cannot be replaced; inherited conditions are never removed.
     * Timing does not assert shared capacity, dispatch or architecture feasibility.
     */
    readonly project_demand_schedules?: readonly ExactDemandSchedule[];
  } = {},
): {
  input: WholeSystemEvaluationInput;
  catalog: readonly ComponentLibraryRecord[];
  selection_digest: string;
  pv_binding?: ReturnType<typeof bindInstalledPv>;
} => {
  const result = parseProductSelection(serializePassportValue(selection));
  const candidate = result.input.generation.candidates.find(
    (c) => c.id === result.input.candidate_id,
  )!;
  if (
    choices.length !== result.roles.length ||
    new Set(choices.map((c) => c.role_id)).size !== choices.length
  )
    throw new TypeError('Exact handoff requires one explicit binding for every mandatory role.');
  const selected = result.roles.map((role) => {
    const choice = choices.find((c) => c.role_id === role.role.id);
    if (!choice) throw new TypeError('Missing mandatory role choice.');
    const product = role.candidates.find(
      (c) =>
        c.component_id === choice.component_id &&
        serializePassportValue(c.assembly ?? null) ===
          serializePassportValue(choice.assembly ?? null) &&
        c.bindings.some((b) => b.id === choice.binding_id),
    );
    const binding = product?.bindings.find((b) => b.id === choice.binding_id);
    if (
      !product ||
      !binding ||
      Object.values(binding.witness.interfaces).some((p) => p === null) ||
      Object.values(binding.witness.paths).some((p) => p === null)
    )
      throw new TypeError(
        'Selected exact witness is missing, unresolved in identity, or outside retained fixed intent.',
      );
    return { role, product, binding };
  });
  const mandatoryConditions: NonNullable<
    InstalledSystemRequirements['mandatory_conditions']
  >[number][] = selected
    .filter((s) => s.binding.status !== 'ELIGIBLE')
    .map((s) => ({
      id: s.role.role.id,
      subject_id: s.binding.id,
      artifact_digest: result.result_digest,
      status: s.binding.status === 'BLOCKED' ? 'blocked' : 'unresolved',
      // Model diagnostics include alternative witnesses; only this witness and
      // its required upstream capacity dependencies describe the installation.
      reason_codes: [
        ...new Set([
          ...s.binding.gates.filter((g) => g.truth !== 'YES').map((g) => g.reason),
          ...s.binding.assembly_gates.filter((g) => g.truth !== 'YES').map((g) => g.reason),
          ...(s.role.upstream_unresolved.length ? ['upstream_requirement_unresolved'] : []),
        ]),
      ].sort(),
    }));
  if (candidate.structural_evaluation.status !== 'structurally_viable')
    mandatoryConditions.push({
      id: 'architecture',
      subject_id: candidate.id,
      artifact_digest: candidate.candidate_digest,
      status: candidate.structural_evaluation.status,
      reason_codes: [
        ...candidate.structural_evaluation.unresolved_decision_ids,
        ...candidate.structural_evaluation.blocked_decision_ids,
      ],
    });
  const assumptions = [...result.input.generation.input.assumptions];
  const schedules = options.project_demand_schedules ?? [];
  assertExactDemandSchedules(candidate.demand_endpoints, schedules);
  const projectDemands = candidate.demand_endpoints.map((demand) => {
    const schedule = demand.schedule ?? schedules.find((s) => s.demand_id === demand.id)?.schedule;
    const pointer = demand.provenance.find((p) => p.kind === 'requirement');
    if (!pointer || pointer.kind !== 'requirement')
      throw new TypeError('Demand lacks exact requirement provenance.');
    return {
      id: demand.id,
      domain_id: demand.domain_id,
      provenance: {
        requirement_id: demand.source_requirement_id,
        pointer: pointer.pointer,
      },
      ...(demand.required_power_w === undefined
        ? {}
        : { required_power_w: demand.required_power_w }),
      ...(schedule === undefined
        ? {}
        : {
            schedule,
            // Upstream ownership wins even when late input repeats identical
            // timing. Otherwise the exact-evaluation declaration is its origin,
            // with no claim that the original requirement asserted this value.
            schedule_provenance:
              demand.schedule === undefined
                ? { origin: 'evaluation_input' as const }
                : {
                    origin: 'requirement' as const,
                    requirement_id: demand.source_requirement_id,
                    pointer: `${pointer.pointer}/schedule`,
                  },
          }),
    };
  });
  const byRole = new Map(selected.map((s) => [s.role.role.id, s]));
  let input: WholeSystemEvaluationInput = {
    assumptions,
    architecture: {
      installation: {
        schema_version: '1.0.0',
        id: 'phase5.bound-system',
        name: 'Explicit product role bindings',
        status: 'selected',
        component_instances: selected.map((s) => ({
          id: s.role.role.id,
          component_id: s.product.component_id,
          status: 'selected',
        })),
      },
      power_topology: {
        domains: candidate.topology.domains,
        bindings: candidate.topology.bindings.map((b) => ({
          id: b.id,
          instance_id: b.role_id,
          port_id: byRole.get(b.role_id)!.binding.witness.interfaces[b.interface_id]!,
          domain_id: b.domain_id,
        })),
        edges: candidate.topology.edges.map((e) =>
          e.kind === 'wire'
            ? e
            : {
                id: e.id,
                kind: 'power_path' as const,
                from: e.from,
                to: e.to,
                instance_id: e.role_id,
                power_path_id: byRole.get(e.role_id)!.binding.witness.paths[e.path_id]!,
              },
        ),
      },
    },
    requirements: {
      id: result.input.generation.input.requirements.id,
      house_domain_id: 'house',
      ...(options.evaluation_hours === undefined
        ? {}
        : { evaluation_hours: options.evaluation_hours }),
      project_demands: projectDemands,
      mandatory_conditions: mandatoryConditions,
      supplies: candidate.topology.routes.map((route) => {
        const endpoint = candidate.demand_endpoints.find((d) => d.id === route.to);
        return {
          id: route.id,
          from: route.from,
          to: route.to,
          edge_ids: route.edge_ids,
          ...(endpoint?.required_power_w === undefined
            ? {}
            : { required_power_w: endpoint.required_power_w }),
          ...(endpoint?.requires_isolation === undefined
            ? {}
            : { requires_isolation: endpoint.requires_isolation }),
        };
      }),
      load_states: options.device_states ?? [],
      battery_banks: selected
        .filter((s) => s.role.role.function === 'storage')
        .map((s) => {
          const energy = s.role.role.constraints.find(
            (c) => c.kind === 'minimum_nominal_storage_energy',
          );
          return {
            id: s.role.role.id,
            instance_id: s.role.role.id,
            domain_id: candidate.topology.bindings.find((b) => b.role_id === s.role.role.id)!
              .domain_id,
            series_count: s.product.assembly?.series_count ?? 1,
            parallel_count: s.product.assembly?.parallel_count ?? 1,
            ...(energy?.kind === 'minimum_nominal_storage_energy'
              ? { required_nominal_energy_wh: energy.energy_wh }
              : {}),
          };
        }),
    },
  };
  // Fresh ownership prevents edits to handoff schedules or bindings from mutating
  // the portable selection artifact. Canonical records stay real, exact snapshots.
  const catalog = [...result.input.corpus];
  if (options.pv_modules?.length) {
    if (!options.installed_pv)
      throw new Error('PV module materialization requires an explicit PV scenario');
    const modules = options.pv_modules;
    if (options.installed_pv.version !== 'installed-pv-scenario.v2')
      throw new Error('Unsupported physical PV inventory version');
    const inventory = Object.values(options.installed_pv.module_instances).flatMap((v) => v ?? []);
    if (new Set(inventory.map((m) => m.instance_id)).size !== inventory.length)
      throw new Error('Duplicate physical PV module ownership');
    if (
      modules.some(
        (m) => !inventory.some((p) => p.instance_id === m.instance_id && p.port_id === m.port_id),
      )
    )
      throw new Error('Unrelated PV module or mismatched physical port inventory');
    if (
      new Set(modules.map((m) => m.instance_id)).size !== modules.length ||
      modules.some((m) =>
        input.architecture.installation.component_instances?.some((i) => i.id === m.instance_id),
      )
    )
      throw new Error('Duplicate PV module instance');
    const pvBindings = modules.map((m) => {
      const endpoint = candidate.topology.domains.find((e) => e.id === m.source_endpoint_id);
      if (
        !endpoint ||
        endpoint.kind !== 'pv_dc' ||
        !result.input.generation.input.requirements.charging_sources.some(
          (s) => s.kind === 'solar' && `domain.source.${s.id}` === endpoint.id,
        )
      )
        throw new Error('PV module must bind an existing solar source endpoint');
      const ports = m.record.ports?.filter((p) => p.id === m.port_id) ?? [];
      const port = ports[0];
      if (ports.length !== 1 || !port || port.domain !== 'dc' || port.direction !== 'output')
        throw new Error('Exact declared DC output port required for PV source');
      const existing = catalog.find((r) => r.id === m.record.id);
      if (existing && serializePassportValue(existing) !== serializePassportValue(m.record))
        throw new Error('Conflicting PV record snapshots');
      if (!existing) catalog.push(m.record);
      return {
        id: `pv-module.${m.instance_id}`,
        instance_id: m.instance_id,
        port_id: m.port_id,
        domain_id: endpoint.id,
      };
    });
    input = {
      ...input,
      architecture: {
        ...input.architecture,
        installation: {
          ...input.architecture.installation,
          component_instances: [
            ...(input.architecture.installation.component_instances ?? []),
            ...modules.map((m) => ({
              id: m.instance_id,
              component_id: m.record.id,
              status: 'selected' as const,
            })),
          ],
        },
        power_topology: {
          ...input.architecture.power_topology,
          bindings: [...input.architecture.power_topology.bindings, ...pvBindings],
          // A source-domain association does not prove a wire. In particular,
          // wiring every series piece directly to the endpoint would fabricate
          // parallel connectivity. Keep the inherited graph; circuit proof is
          // explicitly unresolved in the PV bridge until a consumer models it.
          edges: input.architecture.power_topology.edges,
        },
      },
    };
  }
  const pvBinding = options.installed_pv
    ? bindInstalledPv(input, catalog, options.installed_pv)
    : undefined;
  return JSON.parse(
    serializePassportValue({
      input: pvBinding?.bound_input ?? input,
      catalog,
      ...(pvBinding ? { pv_binding: pvBinding } : {}),
      selection_digest: result.result_digest,
    }),
  ) as {
    input: WholeSystemEvaluationInput;
    catalog: readonly ComponentLibraryRecord[];
    selection_digest: string;
    pv_binding?: ReturnType<typeof bindInstalledPv>;
  };
};
