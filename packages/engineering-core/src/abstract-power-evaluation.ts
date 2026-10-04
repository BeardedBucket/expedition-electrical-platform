import type {
  AbstractPowerTopology,
  ArchitectureDemandEndpoint,
  RequiredProductRole,
  ArchitectureStructuralStatus,
} from './architecture-generation-contracts.js';
import type { InstalledElectricalDomain } from './installed-power-topology.js';
import type { PassportStatus } from './engineering-passport-contracts.js';
import {
  passiveDomainStates,
  powerPathDomainStates,
  statusOf,
} from './nominal-domain-semantics.js';
import { assertUniqueIds } from './architecture-generation-validation.js';

export const structuralStatus = (
  states: readonly PassportStatus[],
): ArchitectureStructuralStatus => {
  const status = statusOf(states);
  return status === 'satisfied' ? 'structurally_viable' : status;
};

/** This evaluates requested abstract relationships, not evidence that a device implements them. */
export const evaluateAbstractPowerTopology = (
  topology: AbstractPowerTopology,
  roles: readonly RequiredProductRole[],
  demandEndpoints: readonly ArchitectureDemandEndpoint[] = [],
): readonly {
  readonly id: string;
  readonly status: ArchitectureStructuralStatus;
  readonly code: string;
}[] => {
  assertUniqueIds(topology.domains, 'domain');
  assertUniqueIds(topology.bindings, 'binding');
  assertUniqueIds(topology.edges, 'edge');
  assertUniqueIds(topology.routes, 'route');
  assertUniqueIds(roles, 'role');
  assertUniqueIds(demandEndpoints, 'demand endpoint');
  const domains = new Map(topology.domains.map((domain) => [domain.id, domain]));
  const bindings = new Map(topology.bindings.map((binding) => [binding.id, binding]));
  const edges = new Map(topology.edges.map((edge) => [edge.id, edge]));
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  const demands = new Map(demandEndpoints.map((endpoint) => [endpoint.id, endpoint]));
  const observations: { id: string; status: ArchitectureStructuralStatus; code: string }[] = [];
  const statesByEdge = new Map<string, PassportStatus>();
  const endpointDomain = (id: string): InstalledElectricalDomain => {
    const domain = domains.get(bindings.get(id)?.domain_id ?? demands.get(id)?.domain_id ?? id);
    if (!domain) throw new TypeError(`Unknown topology endpoint '${id}'.`);
    return domain;
  };
  for (const endpoint of demandEndpoints) {
    if (bindings.has(endpoint.id) || domains.has(endpoint.id) || roleMap.has(endpoint.id))
      throw new TypeError('Demand endpoints and product/domain identities must be disjoint.');
    endpointDomain(endpoint.id);
    if (!topology.routes.some((route) => route.to === endpoint.id))
      throw new TypeError('Demand endpoint requires a supply route.');
  }
  const interfaceFor = (id: string) => {
    const binding = bindings.get(id);
    if (!binding) return undefined;
    return roleMap
      .get(binding.role_id)
      ?.constraints.find(
        (constraint) =>
          constraint.kind === 'interface' && constraint.interface_id === binding.interface_id,
      );
  };
  for (const domain of topology.domains) {
    if (bindings.has(domain.id))
      throw new TypeError('Domain and binding identities must be disjoint.');
    const states: PassportStatus[] = [];
    if (domain.nominal_voltage_v === undefined) states.push('unresolved');
    if (domain.kind === 'ac' && domain.frequency_hz === undefined) states.push('unresolved');
    if (domain.kind !== 'ac' && domain.frequency_hz !== undefined) states.push('blocked');
    observations.push({
      id: `domain.${domain.id}`,
      status: structuralStatus(states),
      code: 'domain_characteristics',
    });
  }
  for (const role of roles) {
    assertUniqueIds(role.constraints, 'constraint');
    const interfaces = role.constraints.filter((constraint) => constraint.kind === 'interface');
    const paths = role.constraints.filter(
      (constraint) => constraint.kind === 'directed_power_path',
    );
    if (
      new Set(interfaces.map((entry) => entry.interface_id)).size !== interfaces.length ||
      new Set(paths.map((entry) => entry.path_id)).size !== paths.length
    )
      throw new TypeError('Role interface/path identities must be unique.');
    for (const requirement of interfaces) {
      if (!domains.has(requirement.domain_id))
        throw new TypeError('Role interface references missing domain.');
      const matches = topology.bindings.filter(
        (binding) =>
          binding.role_id === role.id && binding.interface_id === requirement.interface_id,
      );
      if (matches.length !== 1 || matches[0]!.domain_id !== requirement.domain_id)
        throw new TypeError('Each required interface must have exactly one matching binding.');
    }
    for (const capacity of role.output_capacity) {
      if (!interfaces.some((entry) => entry.interface_id === capacity.interface_id))
        throw new TypeError('Capacity references missing output interface.');
      if (capacity.demand_endpoint_ids.some((id) => !demands.has(id)))
        throw new TypeError('Capacity references missing demand endpoint.');
      if (
        capacity.lower_bound_constraint_ids.some(
          (id) =>
            !role.constraints.some(
              (entry) =>
                entry.id === id &&
                entry.kind === 'minimum_output_power' &&
                entry.interface_id === capacity.interface_id,
            ),
        )
      )
        throw new TypeError('Capacity lower bound requires an individual output predicate.');
      if ((capacity.status === 'unresolved') !== capacity.unresolved_reasons.length > 0)
        throw new TypeError('Capacity status must retain unresolved reasons.');
    }
    for (const constraint of role.constraints) {
      if (
        'interface_id' in constraint &&
        !interfaces.some((entry) => entry.interface_id === constraint.interface_id)
      )
        throw new TypeError('Constraint references missing interface.');
      if (
        constraint.kind === 'distinct_interfaces' &&
        constraint.interface_ids.some(
          (id) => !interfaces.some((entry) => entry.interface_id === id),
        )
      )
        throw new TypeError('Distinct interface requirement references missing interface.');
      if (
        constraint.kind === 'isolation' &&
        !paths.some((path) => path.path_id === constraint.path_id)
      )
        throw new TypeError('Isolation references missing path.');
      if (constraint.kind === 'directed_power_path') {
        if (
          !interfaces.some((entry) => entry.interface_id === constraint.from_interface) ||
          !interfaces.some((entry) => entry.interface_id === constraint.to_interface)
        )
          throw new TypeError('Path references missing interface.');
        if (
          !role.constraints.some(
            (entry) => entry.kind === 'capability' && entry.capability === constraint.capability,
          )
        )
          throw new TypeError('Path must retain its required capability gate.');
      }
      if (constraint.kind === 'nominal_voltage' || constraint.kind === 'ac_frequency') {
        const iface = interfaces.find((entry) => entry.interface_id === constraint.interface_id)!;
        const domain = domains.get(iface.domain_id)!;
        const value =
          constraint.kind === 'nominal_voltage' ? domain.nominal_voltage_v : domain.frequency_hz;
        const expected =
          constraint.kind === 'nominal_voltage' ? constraint.voltage_v : constraint.frequency_hz;
        const state =
          value === undefined
            ? 'unresolved'
            : value === expected
              ? 'structurally_viable'
              : 'blocked';
        observations.push({
          id: `constraint.${role.id}.${constraint.id}`,
          status: state,
          code: 'interface_domain_requirement',
        });
      }
    }
  }
  for (const binding of topology.bindings) {
    endpointDomain(binding.id);
    if (!interfaceFor(binding.id))
      throw new TypeError('Binding references missing role/interface.');
  }
  for (const edge of topology.edges) {
    const from = endpointDomain(edge.from);
    const to = endpointDomain(edge.to);
    const fromInterface = interfaceFor(edge.from);
    const toInterface = interfaceFor(edge.to);
    let states: PassportStatus[];
    if (edge.kind === 'wire') {
      states = passiveDomainStates(from, to);
      // End-use endpoints consume; they never acquire a product's output authority.
      if (demands.has(edge.from)) states.push('blocked');
      if (fromInterface?.kind === 'interface' && fromInterface.direction === 'input')
        states.push('blocked');
      if (toInterface?.kind === 'interface' && toInterface.direction === 'output')
        states.push('blocked');
    } else {
      const role = roleMap.get(edge.role_id);
      const path = role?.constraints.find(
        (entry) => entry.kind === 'directed_power_path' && entry.path_id === edge.path_id,
      );
      if (!path || path.kind !== 'directed_power_path')
        throw new TypeError('Edge references missing required path.');
      states = powerPathDomainStates(path.capability, from, to);
      const fromBinding = bindings.get(edge.from);
      const toBinding = bindings.get(edge.to);
      if (
        !fromBinding ||
        !toBinding ||
        fromBinding.role_id !== role!.id ||
        toBinding.role_id !== role!.id ||
        fromBinding.interface_id !== path.from_interface ||
        toBinding.interface_id !== path.to_interface ||
        edge.from === edge.to
      )
        states.push('blocked');
      if (fromInterface?.kind === 'interface' && fromInterface.direction === 'output')
        states.push('blocked');
      if (toInterface?.kind === 'interface' && toInterface.direction === 'input')
        states.push('blocked');
    }
    const state = statusOf(states);
    statesByEdge.set(edge.id, state);
    observations.push({
      id: `edge.${edge.id}`,
      status: structuralStatus([state]),
      code: 'directed_abstract_edge',
    });
  }
  for (const route of topology.routes) {
    endpointDomain(route.from);
    endpointDomain(route.to);
    const states: PassportStatus[] = [];
    let cursor = route.from;
    const visited = new Set([cursor]);
    for (const id of route.edge_ids) {
      const edge = edges.get(id);
      if (!edge) throw new TypeError('Route references missing edge.');
      if (edge.from !== cursor || visited.has(edge.to)) states.push('blocked');
      cursor = edge.to;
      visited.add(cursor);
      states.push(statesByEdge.get(id)!);
    }
    if (route.edge_ids.length === 0 || cursor !== route.to) states.push('blocked');
    observations.push({
      id: `route.${route.id}`,
      status: structuralStatus(states),
      code: 'ordered_abstract_route',
    });
  }
  return observations;
};
