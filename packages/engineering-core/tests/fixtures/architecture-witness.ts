import type {
  ArchitectureCandidate,
  RequiredProductRole,
} from '../../src/architecture-generation.js';
import type { ComponentLibraryRecord } from '../../src/component-library.js';
import type { WholeSystemEvaluationInput } from '../../src/engineering-passport.js';

/**
 * TEST ONLY: project-authored records witness nominal structural instantiation.
 * This deliberately supplies no route power or efficiency proof. The 1 W/1 hour
 * component observations/schedules and a one-unit permitted storage bank are synthetic
 * complete inputs for Phase 3's other required scopes, not inferred idle facts,
 * product feasibility, architecture semantics or runtime bank construction.
 */
export const architectureWitness = (
  candidate: ArchitectureCandidate,
): {
  input: WholeSystemEvaluationInput;
  catalog: ComponentLibraryRecord[];
} => {
  const domains = new Map(candidate.topology.domains.map((domain) => [domain.id, domain]));
  // Phase 3 needs concrete load ports. These local synthetic witnesses are an
  // explicit test adapter, never Phase 4 mandatory product selection roles.
  const witnessRoles: (Omit<RequiredProductRole, 'function'> & {
    function: RequiredProductRole['function'] | 'load';
  })[] = [
    ...candidate.required_roles,
    ...candidate.demand_endpoints.map((endpoint) => ({
      id: endpoint.id,
      function: 'load' as const,
      binding_scope: 'single_device' as const,
      output_capacity: [],
      constraints: [
        {
          id: 'c0',
          kind: 'capability' as const,
          capability: 'load_consumption' as const,
          provenance: endpoint.provenance,
        },
        {
          id: 'c1',
          kind: 'interface' as const,
          interface_id: 'input',
          direction: 'input' as const,
          domain_id: endpoint.domain_id,
          provenance: endpoint.provenance,
        },
      ],
    })),
  ];
  const bindings = [
    ...candidate.topology.bindings,
    ...candidate.demand_endpoints.map((endpoint) => ({
      id: endpoint.id,
      role_id: endpoint.id,
      interface_id: 'input',
      domain_id: endpoint.domain_id,
    })),
  ];
  const catalog: ComponentLibraryRecord[] = witnessRoles.map((role) => {
    const interfaces = role.constraints.filter((c) => c.kind === 'interface');
    const capabilities = role.constraints.filter((c) => c.kind === 'capability');
    const paths = role.constraints.filter((c) => c.kind === 'directed_power_path');
    const storage = role.function === 'storage';
    const energy = role.constraints.find((c) => c.kind === 'minimum_nominal_storage_energy');
    const houseV = candidate.choices.house_voltage_v;
    const record: ComponentLibraryRecord = {
      id: `witness.${role.id}`,
      manufacturer: 'Project-authored test witness',
      model: role.id,
      category: 'synthetic',
      source_type: 'synthetic',
      source_refs: [
        {
          id: 'fixture.nominal-witness',
          title: 'Test-only nominal role instantiation, not manufacturer data',
        },
      ],
      verification_status: 'verified',
      product_role: storage
        ? 'battery'
        : role.function === 'load'
          ? 'load'
          : role.function === 'inverter_charger'
            ? 'inverter_charger'
            : role.function === 'inverter'
              ? 'inverter'
              : role.function === 'charger'
                ? 'charger'
                : role.function === 'solar_charge_control'
                  ? 'solar_charge_controller'
                  : 'dc_dc_converter',
      capabilities: capabilities.map((c) => ({ id: `cap.${c.capability}`, type: c.capability })),
      ports: interfaces.map((c) => {
        const domain = domains.get(c.domain_id)!;
        return {
          id: c.interface_id,
          domain: domain.kind === 'pv_dc' ? 'dc' : domain.kind,
          direction: c.direction,
          ...(domain.nominal_voltage_v === undefined
            ? {}
            : { voltage_v: domain.nominal_voltage_v }),
          ...(domain.frequency_hz === undefined ? {} : { frequency_hz: domain.frequency_hz }),
        };
      }),
      power_paths: paths.map((c) => ({
        id: c.path_id,
        capability_id: `cap.${c.capability}`,
        from_port: c.from_interface,
        to_port: c.to_interface,
      })),
      electrical: { power_consumption_w: 1, ...(storage ? { nominal_voltage_v: houseV } : {}) },
      ...(storage
        ? {
            battery: {
              nominal_capacity_ah:
                (energy?.kind === 'minimum_nominal_storage_energy' ? energy.energy_wh : houseV) /
                houseV,
              nominal_energy_wh:
                energy?.kind === 'minimum_nominal_storage_energy' ? energy.energy_wh : houseV,
              allowed_series_count: { min: 1, max: 1 },
              allowed_parallel_count: { min: 1, max: 1 },
            },
          }
        : {}),
    };
    return record;
  });
  const input: WholeSystemEvaluationInput = {
    assumptions: [
      {
        id: 'test-only.schedule',
        origin: 'project',
        statement:
          'Synthetic 1 W per role for one hour, without a runtime device-demand or efficiency assertion.',
      },
    ],
    requirements: {
      id: 'fixture.abstract-instantiation',
      house_domain_id: 'house',
      evaluation_hours: 1,
      supplies: candidate.topology.routes.map((route) => ({
        id: route.id,
        from: route.from,
        to: route.to,
        edge_ids: route.edge_ids,
      })),
      load_states: witnessRoles.map((role) => ({
        id: role.id,
        binding_id: bindings.find((binding) => binding.role_id === role.id)!.id,
        state: 'active',
        duration_hours: 1,
        power: { kind: 'component' },
      })),
      battery_banks: witnessRoles
        .filter((role) => role.function === 'storage')
        .map((role) => ({
          id: role.id,
          instance_id: role.id,
          domain_id: 'house',
          series_count: 1,
          parallel_count: 1,
        })),
    },
    architecture: {
      installation: {
        schema_version: '1.0.0',
        id: 'fixture.nominal-instantiation',
        name: 'Phase 4 test-only witnesses',
        status: 'selected',
        component_instances: witnessRoles.map((role) => ({
          id: role.id,
          component_id: `witness.${role.id}`,
          status: 'selected',
        })),
      },
      power_topology: {
        domains: candidate.topology.domains,
        bindings: bindings.map((binding) => ({
          id: binding.id,
          instance_id: binding.role_id,
          port_id: binding.interface_id,
          domain_id: binding.domain_id,
        })),
        edges: candidate.topology.edges.map((edge) =>
          edge.kind === 'wire'
            ? edge
            : {
                id: edge.id,
                kind: 'power_path',
                from: edge.from,
                to: edge.to,
                instance_id: edge.role_id,
                power_path_id: edge.path_id,
              },
        ),
      },
    },
  };
  return { input, catalog };
};
