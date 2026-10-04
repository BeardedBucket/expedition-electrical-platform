import { passiveDomainStates, powerPathDomainStates } from './nominal-domain-semantics.js';
import type { PassportStatus } from './engineering-passport-contracts.js';
import { conversionPowerToCurrent, directPowerToCurrent } from './calculations.js';
import type { InstalledSystemContext } from './installed-system-context.js';
import { statusOf, dcKind, includesValue, maximum } from './installed-system-context.js';

/** Nominal compatibility and caller-selected directed routes, never architecture generation. */
export const evaluateInstalledPowerTopology = (
  context: InstalledSystemContext,
): Map<string, PassportStatus> => {
  const {
    request,
    bindings,
    edges,
    decide,
    derive,
    consume,
    getPort,
    banksByInstance,
    componentFor,
    endpointDomain,
  } = context;
  const bindingStates = new Map<string, PassportStatus>();
  for (const binding of bindings.values()) {
    const component = componentFor(binding.instance_id);
    const port = getPort(binding);
    const domain = endpointDomain(binding.id);
    const factIds: string[] = [];
    const observed = consume(component, `ports.${binding.port_id}`, port, factIds);
    let portVoltage = observed?.voltage_v;
    const bank = banksByInstance.get(binding.instance_id);
    if (bank && bank.domain_id !== binding.domain_id)
      throw new TypeError('Battery-bank ports must bind the declared bank domain.');
    if (bank && bank.series_count > 1) {
      const series = consume(
        component,
        'battery.allowed_series_count',
        component.battery?.allowed_series_count,
        factIds,
      );
      const parallel = consume(
        component,
        'battery.allowed_parallel_count',
        component.battery?.allowed_parallel_count,
        factIds,
      );
      if (
        !series ||
        !parallel ||
        bank.series_count < series.min ||
        bank.series_count > series.max ||
        bank.parallel_count < parallel.min ||
        bank.parallel_count > parallel.max
      )
        portVoltage = undefined;
      else if (typeof portVoltage === 'number') {
        const unitVoltage = portVoltage;
        portVoltage *= bank.series_count;
        derive(
          `bank-port:${binding.id}`,
          'bankPortVoltageV = unitPortVoltageV * explicitlyPermittedSeriesCount',
          { unit_voltage_v: unitVoltage, series_count: bank.series_count },
          portVoltage,
          'V',
          factIds,
        );
      } else portVoltage = undefined;
    }
    const voltageMatches =
      domain.nominal_voltage_v === undefined
        ? undefined
        : includesValue(portVoltage, domain.nominal_voltage_v);
    let state: PassportStatus =
      !observed || voltageMatches === undefined
        ? 'unresolved'
        : voltageMatches && observed.domain === dcKind(domain)
          ? 'satisfied'
          : 'blocked';
    if (observed && observed.domain !== dcKind(domain)) state = 'blocked';
    if (domain.kind === 'ac') {
      const frequencyMatches =
        domain.frequency_hz === undefined
          ? undefined
          : includesValue(observed?.frequency_hz, domain.frequency_hz);
      state = statusOf([
        state,
        frequencyMatches === undefined ? 'unresolved' : frequencyMatches ? 'satisfied' : 'blocked',
      ]);
    } else if (domain.frequency_hz !== undefined) state = 'blocked';
    // Flat port ratings must not erase constraints with temperature, PV Voc,
    // startup, hysteresis or cross-port context. This bounded nominal proof does
    // not interpret those contexts; their presence prevents a complete assertion.
    if (observed?.constraints?.length) state = statusOf([state, 'unresolved']);
    bindingStates.set(
      binding.id,
      decide(
        `binding:${binding.id}`,
        state,
        state === 'satisfied'
          ? 'port_domain_compatible'
          : state === 'blocked'
            ? 'port_domain_incompatible'
            : 'port_domain_evidence_missing',
        'Port compatibility uses explicit nominal domain and port-specific facts; absent or context-qualified ratings remain unresolved.',
        { binding, domain },
        factIds,
      ),
    );
  }

  const edgeStates = new Map<string, PassportStatus>();
  for (const edge of edges.values()) {
    const fromDomain = endpointDomain(edge.from);
    const toDomain = endpointDomain(edge.to);
    const from = bindings.get(edge.from);
    const to = bindings.get(edge.to);
    const factIds: string[] = [];
    const localStates: PassportStatus[] = [];
    for (const binding of [from, to]) if (binding) localStates.push(bindingStates.get(binding.id)!);
    if (edge.kind === 'wire' || edge.kind === 'conductive') {
      localStates.push(...passiveDomainStates(fromDomain, toDomain));
    }
    if (edge.kind === 'wire') {
      if (context.projectDemands.has(edge.from)) localStates.push('blocked');
      // Ports consume or provide power; a wire cannot turn an input port into a
      // source or drive an output-only port. Bus nodes have no invented roles.
      if (from) {
        const port = getPort(from);
        if (
          componentFor(from.instance_id).verification_status === 'verified' &&
          port?.direction === 'input'
        )
          localStates.push('blocked');
      }
      if (to) {
        const port = getPort(to);
        if (
          componentFor(to.instance_id).verification_status === 'verified' &&
          port?.direction === 'output'
        )
          localStates.push('blocked');
      }
    } else {
      const component = componentFor(edge.instance_id);
      if (
        !from ||
        !to ||
        from.instance_id !== edge.instance_id ||
        to.instance_id !== edge.instance_id
      )
        throw new TypeError(
          `Internal edge '${edge.id}' must bind two ports on its exact instance.`,
        );
      if (edge.kind === 'power_path') {
        const path = component.power_paths?.find((entry) => entry.id === edge.power_path_id);
        const observed = consume(component, `power_paths.${edge.power_path_id}`, path, factIds);
        if (!observed) localStates.push('unresolved');
        else if (observed.from_port !== from.port_id || observed.to_port !== to.port_id)
          localStates.push('blocked');
        const capability = component.capabilities?.find(
          (entry) => entry.id === path?.capability_id,
        );
        const observedCapability = consume(
          component,
          `capabilities.${path?.capability_id ?? 'missing'}`,
          capability,
          factIds,
        );
        if (!observedCapability) localStates.push('unresolved');
        else {
          localStates.push(...powerPathDomainStates(observedCapability.type, fromDomain, toDomain));
        }
        const fromPort = getPort(from);
        const toPort = getPort(to);
        if (
          component.verification_status === 'verified' &&
          (fromPort?.direction === 'output' || toPort?.direction === 'input')
        )
          localStates.push('blocked');
        if (
          component.verification_status === 'verified' &&
          ['fuse', 'breaker', 'disconnect', 'busbar', 'distribution_panel'].includes(
            component.product_role ?? '',
          )
        )
          localStates.push('blocked');
      } else {
        const relationship = component.conductive_relationships?.find(
          (entry) => entry.id === edge.relationship_id,
        );
        const observed = consume(
          component,
          `conductive_relationships.${edge.relationship_id}`,
          relationship,
          factIds,
        );
        if (!observed) localStates.push('unresolved');
        else {
          const hasPort = (id: string) =>
            observed.participants.some((entry) => entry.kind === 'port' && entry.id === id);
          localStates.push(
            hasPort(from.port_id) && hasPort(to.port_id) ? 'satisfied' : 'unresolved',
          );
          if (observed.constraints?.length) localStates.push('unresolved');
        }
        const switching = consume(component, 'switching', component.switching, factIds);
        if (
          component.verification_status === 'verified' &&
          component.product_role === 'disconnect' &&
          !switching?.controlled_relationship_ids.includes(edge.relationship_id)
        ) {
          // A relationship's existence does not establish a disconnect's closed
          // installed state. Missing control/configuration evidence is unknown.
          localStates.push('unresolved');
        }
        if (component.switching?.controlled_relationship_ids.includes(edge.relationship_id)) {
          const configuration = switching?.configurations.find(
            (entry) => entry.id === edge.switching_configuration_id,
          );
          localStates.push(
            !configuration
              ? 'unresolved'
              : configuration.active_relationship_ids.includes(edge.relationship_id)
                ? 'satisfied'
                : 'blocked',
          );
        } else if (edge.switching_configuration_id !== undefined) localStates.push('unresolved');
      }
    }
    edgeStates.set(
      edge.id,
      decide(
        `edge:${edge.id}`,
        statusOf(localStates),
        'installed_edge',
        'Directed continuity requires exact endpoints, compatible domains and canonical internal relationships.',
        edge,
        factIds,
      ),
    );
  }

  for (const supply of request.requirements.supplies) {
    endpointDomain(supply.from);
    endpointDomain(supply.to);
    const states: PassportStatus[] = [];
    const factIds: string[] = [];
    let cursor = supply.from;
    const visited = new Set([cursor]);
    for (const id of supply.edge_ids) {
      const edge = edges.get(id);
      if (!edge) throw new TypeError(`Supply '${supply.id}' references missing edge '${id}'.`);
      if (edge.from !== cursor || visited.has(edge.to)) states.push('blocked');
      cursor = edge.to;
      visited.add(cursor);
      states.push(edgeStates.get(id)!);
    }
    // Propagate one explicitly requested output demand backwards through the
    // selected route. Loss/current observations require a single-path DC device
    // with reviewed efficiency; a product-global efficiency on a multi-function
    // device cannot silently become a path-specific charging/inversion fact.
    let requiredPower = supply.required_power_w;
    const checkKnownPortLimits = (
      endpoint: string,
      powerW: number,
      edgeId: string,
      side: 'from' | 'to',
    ) => {
      const binding = bindings.get(endpoint);
      if (!binding) return;
      const component = componentFor(binding.instance_id);
      const port = getPort(binding);
      const domain = endpointDomain(endpoint);
      const powerLimit = maximum(
        consume(component, `ports.${binding.port_id}.power_w`, port?.power_w, factIds, 'W'),
      );
      if (powerLimit !== undefined) states.push(powerW <= powerLimit ? 'satisfied' : 'blocked');
      const currentLimit = maximum(
        consume(component, `ports.${binding.port_id}.current_a`, port?.current_a, factIds, 'A'),
      );
      if (currentLimit === undefined) return;
      if (dcKind(domain) !== 'dc' || domain.nominal_voltage_v === undefined) {
        states.push('unresolved');
        return;
      }
      // Independent published current limits cannot be erased by a larger power
      // rating. This is a DC nominal-point lower-bound demand, not ampacity or
      // loss-inclusive delivered current; AC current needs separate PF evidence.
      const current = directPowerToCurrent({ powerW, voltageV: domain.nominal_voltage_v });
      if (!current.ok) {
        states.push('blocked');
        return;
      }
      derive(
        `port-current:${supply.id}:${edgeId}:${side}`,
        'nominalPointCurrentA = requestedPointPowerW / nominalVoltageV (DC; conductor losses not modeled)',
        current.value,
        current.value.currentA,
        'A',
        factIds,
      );
      states.push(current.value.currentA <= currentLimit ? 'satisfied' : 'blocked');
    };
    for (const id of [...supply.edge_ids].reverse()) {
      const edge = edges.get(id)!;
      if (requiredPower === undefined) continue;
      if (edgeStates.get(id) !== 'satisfied') {
        requiredPower = undefined;
        continue;
      }
      checkKnownPortLimits(edge.to, requiredPower, id, 'to');
      if (edge.kind !== 'power_path') {
        checkKnownPortLimits(edge.from, requiredPower, id, 'from');
        continue;
      }
      const component = componentFor(edge.instance_id);
      const inputBinding = bindings.get(edge.from)!;
      const outputBinding = bindings.get(edge.to)!;
      const inputDomain = endpointDomain(edge.from);
      const outputDomain = endpointDomain(edge.to);
      const outputPort = getPort(outputBinding);
      const rating = consume(
        component,
        `ports.${outputBinding.port_id}.power_w`,
        outputPort?.power_w,
        factIds,
        'W',
      );
      const limit = maximum(rating);
      states.push(
        limit === undefined ? 'unresolved' : requiredPower <= limit ? 'satisfied' : 'blocked',
      );
      const efficiency = consume(
        component,
        'efficiency_fraction',
        component.efficiency_fraction,
        factIds,
        'fraction',
      );
      if (
        dcKind(inputDomain) !== 'dc' ||
        dcKind(outputDomain) !== 'dc' ||
        component.power_paths?.length !== 1 ||
        efficiency === undefined ||
        inputDomain.nominal_voltage_v === undefined
      ) {
        states.push('unresolved');
        requiredPower = undefined;
        continue;
      }
      const conversion = conversionPowerToCurrent({
        powerW: requiredPower,
        voltageV: inputDomain.nominal_voltage_v,
        efficiency,
      });
      if (!conversion.ok) {
        states.push('blocked');
        requiredPower = undefined;
        continue;
      }
      derive(
        `conversion:${supply.id}:${id}`,
        'inputPowerW = outputPowerW / efficiency; inputCurrentA = inputPowerW / inputVoltageV',
        conversion.value,
        conversion.value,
        'W,A',
        factIds,
      );
      const inputPort = getPort(inputBinding);
      const inputRating = consume(
        component,
        `ports.${inputBinding.port_id}.current_a`,
        inputPort?.current_a,
        factIds,
        'A',
      );
      const inputLimit = maximum(inputRating);
      states.push(
        inputLimit === undefined
          ? 'unresolved'
          : conversion.value.currentA <= inputLimit
            ? 'satisfied'
            : 'blocked',
      );
      requiredPower = conversion.value.inputPowerW;
      checkKnownPortLimits(edge.from, requiredPower, id, 'from');
    }
    if (cursor !== supply.to || supply.edge_ids.length === 0) states.push('blocked');
    // Isolation records are preserved in snapshots, but a complete installed
    // isolation assertion also requires separation across all parallel routes.
    // This nominal route proof deliberately leaves that assertion unresolved.
    if (supply.requires_isolation === true) states.push('unresolved');
    decide(
      `supply:${supply.id}`,
      statusOf(states),
      'supply_route',
      'Only the caller-selected ordered directed route is evaluated; isolation and shared capacity need separate operating context.',
      supply,
      factIds,
    );
  }
  if (request.requirements.supplies.length === 0)
    decide(
      'supply-scope',
      'unresolved',
      'supply_requirements_missing',
      'No explicit source/load route requirements were supplied.',
      {},
    );
  // Individual route powers cannot certify simultaneous shared-path capacity.
  // Preserve this boundary whenever routes share a converter rather than summing
  // loads whose operating simultaneity has not been explicitly modeled.
  const routeUse = new Map<string, number>();
  for (const supply of request.requirements.supplies)
    for (const id of supply.edge_ids)
      if (edges.get(id)?.kind === 'power_path') routeUse.set(id, (routeUse.get(id) ?? 0) + 1);
  for (const [id, count] of routeUse)
    if (count > 1)
      decide(
        `shared:${id}`,
        'unresolved',
        'shared_capacity_unresolved',
        'Multiple supplied routes share a converter; concurrency, losses and combined capacity are not asserted.',
        { edge_id: id, route_count: count },
      );

  return bindingStates;
};
