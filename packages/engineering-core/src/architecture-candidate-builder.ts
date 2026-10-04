import type {
  AbstractPowerTopology,
  ArchitectureDemandEndpoint,
  ArchitectureCandidate,
  ArchitectureDecision,
  ArchitectureGenerationInput,
  ArchitectureGenerationPolicy,
  ArchitectureProvenance,
  ArchitectureStructuralStatus,
  RequiredProductRole,
  RequiredRoleConstraint,
  RoleConstraintPredicate,
} from './architecture-generation-contracts.js';
import type { CapabilityType, PortDirection } from './component-library.js';
import type { InstalledElectricalDomain } from './installed-power-topology.js';
import { evaluateAbstractPowerTopology } from './abstract-power-evaluation.js';
import { groupArchitectureDemands } from './architecture-demand-groups.js';
import { passportDigest } from './portable-json.js';

export const ARCHITECTURE_GENERATOR_REVISION = 'architecture-generation/2.0.0';

/** One local builder owns each candidate; no mutable output aliases input or another candidate. */
export const buildArchitectureCandidate = (
  input: ArchitectureGenerationInput,
  policy: ArchitectureGenerationPolicy,
  inputDigest: string,
  policyDigest: string,
  choices: ArchitectureCandidate['choices'],
): ArchitectureCandidate => {
  const req = input.requirements;
  const domains: InstalledElectricalDomain[] = [
    { id: 'house', kind: 'dc', nominal_voltage_v: choices.house_voltage_v },
  ];
  const roles: {
    id: string;
    function: RequiredProductRole['function'];
    binding_scope: RequiredProductRole['binding_scope'];
    constraints: RequiredRoleConstraint[];
    output_capacity: RequiredProductRole['output_capacity'][number][];
  }[] = [];
  const demandEndpoints: ArchitectureDemandEndpoint[] = [];
  const bindings: AbstractPowerTopology['bindings'][number][] = [];
  const edges: AbstractPowerTopology['edges'][number][] = [];
  const routes: AbstractPowerTopology['routes'][number][] = [];
  const decisions: ArchitectureDecision[] = [];
  const decide = (
    id: string,
    code: string,
    status: ArchitectureStructuralStatus,
    pointers: readonly string[],
    subjects: readonly string[],
    message: string,
  ): void => {
    decisions.push({
      id,
      code,
      status,
      policy_id: policy.id,
      policy_revision: policy.version,
      requirement_pointers: pointers,
      subject_ids: subjects,
      message,
    });
  };
  const provenance = (pointer: string, decision: string): ArchitectureProvenance[] => [
    { kind: 'requirement', pointer },
    { kind: 'generation_decision', decision_id: decision },
  ];
  const addRole = (id: string, fn: RequiredProductRole['function']) => {
    const role = {
      id,
      function: fn,
      binding_scope: fn === 'storage' ? ('storage_assembly' as const) : ('single_device' as const),
      constraints: [] as RequiredRoleConstraint[],
      output_capacity: [] as RequiredProductRole['output_capacity'][number][],
    };
    roles.push(role);
    return role;
  };
  type Role = ReturnType<typeof addRole>;
  const constrain = (
    role: Role,
    predicate: RoleConstraintPredicate,
    refs: readonly ArchitectureProvenance[],
  ) => {
    const id = `c${role.constraints.length}`;
    role.constraints.push({ ...predicate, id, provenance: refs });
    return id;
  };
  const addInterface = (
    role: Role,
    name: string,
    domain: InstalledElectricalDomain,
    direction: PortDirection,
    refs: readonly ArchitectureProvenance[],
  ) => {
    const id = `${role.id}.${name}`;
    constrain(
      role,
      { kind: 'interface', interface_id: name, domain_id: domain.id, direction },
      refs,
    );
    if (domain.nominal_voltage_v !== undefined)
      constrain(
        role,
        { kind: 'nominal_voltage', interface_id: name, voltage_v: domain.nominal_voltage_v },
        refs,
      );
    if (domain.kind === 'ac' && domain.frequency_hz !== undefined)
      constrain(
        role,
        { kind: 'ac_frequency', interface_id: name, frequency_hz: domain.frequency_hz },
        refs,
      );
    bindings.push({ id, role_id: role.id, interface_id: name, domain_id: domain.id });
    return id;
  };
  const wire = (from: string, to: string): string => {
    const id = `e${edges.length}`;
    edges.push({ id, kind: 'wire', from, to });
    return id;
  };
  const internalPath = (
    role: Role,
    name: string,
    fromName: string,
    toName: string,
    capability: CapabilityType,
    refs: readonly ArchitectureProvenance[],
  ): string => {
    if (
      !role.constraints.some(
        (entry) => entry.kind === 'capability' && entry.capability === capability,
      )
    )
      constrain(role, { kind: 'capability', capability }, refs);
    constrain(
      role,
      {
        kind: 'directed_power_path',
        path_id: name,
        from_interface: fromName,
        to_interface: toName,
        capability,
      },
      refs,
    );
    const id = `e${edges.length}`;
    edges.push({
      id,
      kind: 'required_power_path',
      from: `${role.id}.${fromName}`,
      to: `${role.id}.${toName}`,
      role_id: role.id,
      path_id: name,
    });
    return id;
  };
  const outputDemand = (
    role: Role,
    iface: string,
    power: number | undefined,
    pointer: string,
    decision: string,
  ) => {
    if (power === undefined)
      decide(
        `missing-power.${role.id}.${iface}`,
        'output_power_requirement_unknown',
        'unresolved',
        [pointer],
        [role.id],
        'Output demand is unknown; no zero rating, input current or efficiency is supplied.',
      );
    const lowerBounds =
      power === undefined
        ? []
        : [
            constrain(
              role,
              { kind: 'minimum_output_power', interface_id: iface, power_w: power },
              provenance(pointer, decision),
            ),
          ];
    role.output_capacity.push({
      interface_id: iface,
      scope: 'required_output_sizing',
      status: power === undefined ? 'unresolved' : 'specified',
      demand_endpoint_ids: [],
      lower_bound_constraint_ids: lowerBounds,
      unresolved_reasons: power === undefined ? ['demand_power_unknown'] : [],
      provenance: provenance(pointer, decision),
    });
  };
  const isolation = (
    role: Role,
    path: string,
    requested: boolean | undefined,
    pointer: string,
    decision: string,
  ) => {
    if (requested === true) {
      constrain(
        role,
        { kind: 'isolation', path_id: path, required: true },
        provenance(pointer, decision),
      );
      decide(
        `isolation.${role.id}`,
        'isolation_architecture_unmodeled',
        'unresolved',
        [pointer],
        [role.id],
        'The product gate is retained; complete installed isolation across parallel paths requires later engineering interpretation.',
      );
    }
  };
  const house = domains[0]!;
  decide(
    'house-voltage',
    'house_voltage_choice',
    policy.candidate_house_voltages_v.includes(choices.house_voltage_v)
      ? 'structurally_viable'
      : 'blocked',
    [
      req.fixed_house_voltage_v === undefined
        ? '/requirements'
        : '/requirements/fixed_house_voltage_v',
    ],
    ['house'],
    req.fixed_house_voltage_v === undefined
      ? 'House voltage is explored from explicit project policy independently of source voltage.'
      : 'Fixed house voltage is preserved; a policy exclusion is an explicit blocked candidate.',
  );
  decide(
    'ac-arrangement',
    'ac_function_arrangement',
    'structurally_viable',
    ['/requirements/loads', '/requirements/charging_sources'],
    [],
    'Functional arrangement is a policy choice, without product availability or preference.',
  );
  const hasInversionAndCharging =
    req.loads.some((load) => load.domain.kind === 'ac') &&
    req.charging_sources.some((source) => source.kind === 'shore');
  if (
    hasInversionAndCharging &&
    choices.ac_function_arrangement === 'separate' &&
    !policy.ac_function_arrangements.includes('separate')
  )
    decide(
      'ac-arrangement-unmodeled',
      'combined_cardinality_unmodeled',
      'unresolved',
      ['/requirements/loads', '/requirements/charging_sources'],
      [],
      'Only combined functions were permitted but multiple AC functional domains/sources exceed the supported one-domain/one-shore combination rule. Separate topology is retained for diagnostic inspection, not asserted to satisfy that policy.',
    );
  if (req.loads.length === 0)
    decide(
      'loads-missing',
      'load_requirements_missing',
      'unresolved',
      ['/requirements/loads'],
      [],
      'No load requirements establish an end-system supply objective.',
    );

  if (req.storage === undefined)
    decide(
      'storage-unknown',
      'storage_requirement_unknown',
      'unresolved',
      ['/requirements'],
      ['house'],
      'Storage intent is unknown; no battery or bank is invented.',
    );
  else if (req.storage.required) {
    decide(
      'storage',
      'abstract_storage_required',
      'structurally_viable',
      ['/requirements/storage/required'],
      ['storage'],
      'Storage is an installed-domain role; series/parallel construction and usable energy are not asserted.',
    );
    const role = addRole('storage', 'storage');
    const refs = provenance('/requirements/storage/required', 'storage');
    constrain(role, { kind: 'capability', capability: 'energy_storage' }, refs);
    // Co-location establishes nominal continuity, not storage dispatch. End-use
    // power and converter losses provide no storage discharge rating authority.
    role.output_capacity.push({
      interface_id: 'dc',
      scope: 'storage_dispatch',
      status: 'unresolved',
      demand_endpoint_ids: [],
      lower_bound_constraint_ids: [],
      unresolved_reasons: ['storage_dispatch_not_asserted'],
      provenance: refs,
    });
    const port = addInterface(role, 'dc', house, 'bidirectional', [
      ...refs,
      { kind: 'generation_decision', decision_id: 'house-voltage' },
    ]);
    routes.push({
      id: 'storage.supply',
      from: port,
      to: house.id,
      edge_ids: [wire(port, house.id)],
      provenance: refs,
    });
    routes.push({
      id: 'storage.charge',
      from: house.id,
      to: port,
      edge_ids: [wire(house.id, port)],
      provenance: refs,
    });
    if (req.storage.minimum_nominal_energy_wh !== undefined)
      constrain(
        role,
        {
          kind: 'minimum_nominal_storage_energy',
          energy_wh: req.storage.minimum_nominal_energy_wh,
        },
        provenance('/requirements/storage/minimum_nominal_energy_wh', 'storage'),
      );
    else
      decide(
        'storage-energy',
        'nominal_storage_energy_unknown',
        'unresolved',
        ['/requirements/storage'],
        ['storage'],
        'Required nominal capacity is unspecified; reserve, usable fraction and autonomy are not defaults.',
      );
  } else {
    if (
      req.storage.minimum_nominal_energy_wh !== undefined ||
      req.storage.desired_autonomy_hours !== undefined
    )
      decide(
        'storage-contradiction',
        'storage_requirement_contradiction',
        'blocked',
        ['/requirements/storage'],
        ['house'],
        'Storage explicitly absent contradicts a supplied storage capacity/autonomy requirement.',
      );
    // Direct source-only operating modes require source availability and balancing;
    // source existence alone does not prove continuous supply to house loads.
    decide(
      'source-only',
      'storage_free_supply_unmodeled',
      'unresolved',
      ['/requirements/storage'],
      ['house'],
      'Storage-free operation requires unmodeled source availability and operating balance.',
    );
  }
  if (req.storage?.desired_autonomy_hours !== undefined)
    decide(
      'autonomy',
      'autonomy_unmodeled',
      'unresolved',
      ['/requirements/storage/desired_autonomy_hours'],
      ['house'],
      'Desired autonomy is retained; nominal energy alone does not prove usable capacity, reserve, source availability or conversion losses.',
    );

  // Shared nominal domains own one functional boundary. Branch routes share
  // the same supply edges; load endpoints retain their own exact requirements.
  // Neither endpoint count nor an unasserted schedule creates product capacity.
  let combinedRole: Role | undefined;
  for (const group of groupArchitectureDemands(req.loads)) {
    const domain: InstalledElectricalDomain = {
      id: `domain.load-group.${group.id}`,
      ...group.domain,
    };
    domains.push(domain);
    const differs =
      domain.nominal_voltage_v !== undefined &&
      domain.nominal_voltage_v !== house.nominal_voltage_v;
    const needsPath =
      domain.kind !== 'dc' ||
      differs ||
      group.members.some(({ load }) => load.requires_isolation === true);
    const refs: ArchitectureProvenance[] = [];
    const endpointIds: string[] = [];
    for (const { load, index } of group.members) {
      const pointer = `/requirements/loads/${index}`;
      const decision = `load.${load.id}`;
      const endpoint = `demand.${load.id}`;
      decide(
        decision,
        domain.nominal_voltage_v === undefined
          ? 'load_domain_voltage_unknown'
          : needsPath
            ? domain.kind === 'ac'
              ? 'inversion_required'
              : 'dc_conversion_required'
            : 'direct_same_voltage_supply',
        domain.nominal_voltage_v === undefined ? 'unresolved' : 'structurally_viable',
        [pointer],
        [domain.id, endpoint],
        'Explicit demand domain is preserved; compatible complete domains share a boundary. Unknown DC voltage leaves continuity unresolved without asserting conversion is necessary.',
      );
      const memberRefs = provenance(pointer, decision);
      refs.push(...memberRefs);
      endpointIds.push(endpoint);
      demandEndpoints.push({
        id: endpoint,
        kind: 'end_use_demand',
        product_binding: 'not_required',
        source_requirement_id: load.id,
        domain_id: domain.id,
        ...(load.required_power_w === undefined ? {} : { required_power_w: load.required_power_w }),
        ...(load.schedule === undefined
          ? {}
          : { schedule: load.schedule.map((entry) => ({ ...entry })) }),
        ...(load.requires_isolation === undefined
          ? {}
          : { requires_isolation: load.requires_isolation }),
        provenance: memberRefs,
      });
      if (load.required_power_w === undefined)
        decide(
          `load-power.${load.id}`,
          'load_power_requirement_unknown',
          'unresolved',
          [pointer],
          [endpoint],
          'Individual demand is unknown; it is retained without a zero or final device rating.',
        );
      if (load.schedule !== undefined)
        decide(
          `schedule.${load.id}`,
          'schedule_energy_unmodeled',
          'unresolved',
          [`${pointer}/schedule`],
          [endpoint],
          'Schedule is preserved without inferring overlap, diversity, storage energy or dispatch.',
        );
      if (domain.kind === 'pv_dc')
        decide(
          `load-context.${load.id}`,
          'pv_load_interpretation_unmodeled',
          'unresolved',
          [`${pointer}/domain`],
          [domain.id],
          'PV consumption context is not interpreted as an ordinary DC load.',
        );
    }
    let prefix: string[];
    if (!needsPath) {
      prefix = [wire(house.id, domain.id)];
    } else {
      const ac = domain.kind === 'ac';
      const combined = ac && choices.ac_function_arrangement === 'combined';
      const role = addRole(
        `conversion.${group.id}`,
        combined ? 'inverter_charger' : ac ? 'inverter' : 'dc_conversion',
      );
      const conversionRefs = [
        ...refs,
        { kind: 'generation_decision' as const, decision_id: 'house-voltage' },
      ];
      if (!ac && !policy.allow_dc_load_conversion)
        decide(
          `conversion-policy.${group.id}`,
          'dc_load_conversion_disallowed',
          'blocked',
          group.members.map(({ index }) => `/requirements/loads/${index}`),
          [role.id],
          'Required conversion is explicitly disallowed by supplied generation policy.',
        );
      addInterface(role, 'dc', house, combined ? 'bidirectional' : 'input', conversionRefs);
      addInterface(role, 'output', domain, 'output', refs);
      constrain(role, { kind: 'distinct_interfaces', interface_ids: ['dc', 'output'] }, refs);
      const edge = internalPath(
        role,
        'supply',
        'dc',
        'output',
        ac ? 'inversion' : 'dc_to_dc_conversion',
        conversionRefs,
      );
      const lowerBounds: string[] = [];
      for (const { load, index } of group.members) {
        const pointer = `/requirements/loads/${index}`;
        if (load.required_power_w !== undefined)
          lowerBounds.push(
            constrain(
              role,
              {
                kind: 'minimum_output_power',
                interface_id: 'output',
                power_w: load.required_power_w,
              },
              provenance(`${pointer}/required_power_w`, `load.${load.id}`),
            ),
          );
        isolation(
          role,
          'supply',
          load.requires_isolation,
          `${pointer}/requires_isolation`,
          `load.${load.id}`,
        );
      }
      const reasons: RequiredProductRole['output_capacity'][number]['unresolved_reasons'][number][] =
        [];
      if (group.members.length > 1) reasons.push('concurrency_not_asserted');
      if (group.members.some(({ load }) => load.required_power_w === undefined))
        reasons.push('demand_power_unknown');
      role.output_capacity.push({
        interface_id: 'output',
        scope: 'required_output_sizing',
        status: reasons.length ? 'unresolved' : 'specified',
        demand_endpoint_ids: endpointIds,
        lower_bound_constraint_ids: lowerBounds,
        unresolved_reasons: reasons,
        provenance: refs,
      });
      if (reasons.length)
        decide(
          `capacity.${role.id}`,
          'shared_output_capacity_unresolved',
          'unresolved',
          group.members.map(({ index }) => `/requirements/loads/${index}`),
          [role.id, ...endpointIds],
          'Individual lower bounds remain required; unknown concurrency or demand prevents a final rating. The shared topology remains a candidate.',
        );
      prefix = [wire(house.id, `${role.id}.dc`), edge, wire(`${role.id}.output`, domain.id)];
      if (combined) combinedRole = role;
    }
    for (const { load, index } of group.members)
      routes.push({
        id: `supply.${load.id}`,
        from: house.id,
        to: `demand.${load.id}`,
        edge_ids: [...prefix, wire(domain.id, `demand.${load.id}`)],
        provenance: provenance(`/requirements/loads/${index}`, `load.${load.id}`),
      });
  }

  for (const { item: source, index } of req.charging_sources
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))) {
    const pointer = `/requirements/charging_sources/${index}`;
    const decision = `source.${source.id}`;
    const domain: InstalledElectricalDomain = {
      id: `domain.source.${source.id}`,
      ...source.domain,
    };
    domains.push(domain);
    const expectedKind = source.kind === 'shore' ? 'ac' : source.kind === 'solar' ? 'pv_dc' : 'dc';
    decide(
      decision,
      source.kind === 'solar'
        ? 'solar_context_and_conversion'
        : source.kind === 'shore'
          ? 'ac_charging_required'
          : 'vehicle_charging_boundary',
      source.domain.kind !== expectedKind ? 'blocked' : 'structurally_viable',
      [pointer],
      [domain.id, 'house'],
      'Source context and charging direction are explicit; source capacity and efficiency are not inferred.',
    );
    if (source.kind === 'vehicle' && domain.kind === 'dc')
      decide(
        `source-voltage.${source.id}`,
        domain.nominal_voltage_v === undefined
          ? 'source_voltage_unknown'
          : domain.nominal_voltage_v === house.nominal_voltage_v
            ? 'same_voltage_charging_function'
            : 'source_to_house_voltage_conversion',
        domain.nominal_voltage_v === undefined ? 'unresolved' : 'structurally_viable',
        [`${pointer}/domain`],
        [domain.id, house.id],
        'A charging path retains both source and house design points; known disparity requires conversion within that explicit functional boundary. Unknown source voltage remains unspecified.',
      );
    const refs = provenance(pointer, decision);
    const role =
      source.kind === 'shore' && combinedRole
        ? combinedRole
        : addRole(
            `charging.${source.id}`,
            source.kind === 'solar' ? 'solar_charge_control' : 'charger',
          );
    const combined = role === combinedRole;
    addInterface(role, 'input', domain, 'input', refs);
    if (!combined)
      addInterface(role, 'dc', house, 'output', [
        ...refs,
        { kind: 'generation_decision', decision_id: 'house-voltage' },
      ]);
    // AC input and output remain distinct even when a single device owns both.
    constrain(
      role,
      {
        kind: 'distinct_interfaces',
        interface_ids: combined ? ['input', 'output', 'dc'] : ['input', 'dc'],
      },
      refs,
    );
    const edge = internalPath(
      role,
      'charge',
      'input',
      'dc',
      source.kind === 'solar' ? 'solar_energy_conversion' : 'charging',
      refs,
    );
    outputDemand(
      role,
      'dc',
      source.required_output_power_w,
      `${pointer}/required_output_power_w`,
      decision,
    );
    // Generic charging includes equal-voltage controlled implementations. Only a
    // known nominal disparity additionally gates conversion on this same device;
    // the function label does not require a particular catalog product category.
    if (
      source.kind === 'vehicle' &&
      domain.kind === 'dc' &&
      domain.nominal_voltage_v !== undefined &&
      domain.nominal_voltage_v !== house.nominal_voltage_v
    )
      constrain(
        role,
        { kind: 'capability', capability: 'dc_to_dc_conversion' },
        provenance(`${pointer}/domain`, `source-voltage.${source.id}`),
      );
    isolation(role, 'charge', source.requires_isolation, `${pointer}/requires_isolation`, decision);
    routes.push({
      id: `charge.${source.id}`,
      from: domain.id,
      to: house.id,
      edge_ids: [wire(domain.id, `${role.id}.input`), edge, wire(`${role.id}.dc`, house.id)],
      provenance: refs,
    });
  }
  for (const [index, unsupported] of (req.unsupported_requirements ?? []).entries())
    decide(
      `unsupported.${unsupported.id}`,
      `${unsupported.kind}_unmodeled`,
      'unresolved',
      [`/requirements/unsupported_requirements/${index}`],
      [],
      'Requested interpretation is preserved without inventing protection, switching, bonding or installation topology.',
    );
  const topology: AbstractPowerTopology = { domains, bindings, edges, routes };
  for (const observation of evaluateAbstractPowerTopology(topology, roles, demandEndpoints))
    decide(
      `structure.${observation.id}`,
      observation.code,
      observation.status,
      [],
      [observation.id],
      'Shared nominal-domain semantics and explicit directed abstract relationships establish only structural status.',
    );
  const unresolved = decisions
    .filter((decision) => decision.status === 'unresolved')
    .map((decision) => decision.id);
  const blocked = decisions
    .filter((decision) => decision.status === 'blocked')
    .map((decision) => decision.id);
  const body = {
    input_digest: inputDigest,
    policy_digest: policyDigest,
    generator_revision: ARCHITECTURE_GENERATOR_REVISION,
    choices,
    required_roles: roles,
    demand_endpoints: demandEndpoints,
    topology,
    used_assumption_ids: [],
    decisions,
    structural_evaluation: {
      status: blocked.length
        ? ('blocked' as const)
        : unresolved.length
          ? ('unresolved' as const)
          : ('structurally_viable' as const),
      assertion_scope: 'abstract-nominal-topology-and-role-requirements' as const,
      product_binding: 'not_evaluated' as const,
      installation_safety: 'not_evaluated' as const,
      policy_lifecycle_status: policy.status,
      unresolved_decision_ids: unresolved,
      blocked_decision_ids: blocked,
      deferred_checks: [
        'exact_product_evidence_and_binding',
        'operating_voltage_and_pv_windows',
        'conversion_losses_and_input_ratings',
        'usable_storage_and_bank_permission',
        'storage_discharge_dispatch_and_capacity',
        'simultaneous_operating_balance',
        'protection_conductors_and_bonding',
        'installation_access_ventilation_and_clearances',
        'advisories_and_recommendation',
      ],
    },
  };
  const digest = passportDigest(body);
  return {
    id: `architecture.${digest.slice('sha256:'.length)}`,
    ...body,
    candidate_digest: digest,
  };
};
