import type { ComponentLibraryRecord } from './component-library.js';
import type {
  EngineeringPassport,
  WholeSystemEvaluationInput,
} from './engineering-passport-contracts.js';
import { evaluateSystem } from './system-evaluation.js';
import { passportDigest, serializePassportValue } from './passport-integrity.js';
import {
  createInstalledSystemContext,
  statusOf,
  severityOf,
  installedSystemRuleData as ruleData,
  WHOLE_SYSTEM_EVALUATOR_REVISION,
} from './installed-system-context.js';
import { evaluateInstalledPowerTopology } from './installed-power-evaluation.js';
import {
  evaluateInstalledScheduledDemand,
  evaluateInstalledBatteryBanks,
} from './installed-energy-evaluation.js';
export {
  installedSystemRuleData,
  WHOLE_SYSTEM_EVALUATOR_REVISION,
} from './installed-system-context.js';

/** Pure synchronous backend composition over canonical product data and existing core primitives. */
export const evaluateInstalledSystem = (
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
): EngineeringPassport => {
  const context = createInstalledSystemContext(input, catalog);
  const {
    request,
    topology,
    installation,
    instances,
    components,
    domains,
    decisions,
    calculations,
    facts,
    digests,
    warnings,
    decide,
    validation,
    componentFor,
    endpointDomain,
  } = context;
  // Rule status is existing lifecycle metadata, not an execution/approval gate.
  // Keep it visible beside the scoped result; executing a draft never promotes it.
  if (ruleData.status !== 'approved')
    warnings.push({
      code: 'rule_review_required',
      message: `Rule lifecycle remains ${ruleData.status}; nominal satisfaction does not assert rule approval.`,
    });
  for (const condition of request.requirements.mandatory_conditions ?? [])
    decide(
      `inherited:${condition.id}`,
      condition.status,
      'inherited_mandatory_condition',
      'A retained upstream mandatory failure or unknown cannot disappear in exact-system evaluation. Content identity is not supporting engineering evidence.',
      condition,
    );
  for (const instance of instances.values()) {
    const component = componentFor(instance.id);
    if (instance.status !== 'selected' && instance.status !== 'installed')
      decide(
        `instance:${instance.id}`,
        'unresolved',
        'instance_not_selected',
        'Installation selection is unresolved.',
        instance,
      );
    if (instance.quantity !== undefined && instance.quantity !== null && instance.quantity !== 1)
      decide(
        `quantity:${instance.id}`,
        'unresolved',
        'aggregate_instance_quantity',
        'Power topology requires individually addressed devices; bank multiplicity is declared separately.',
        instance,
      );
    if (component.verification_status !== 'verified')
      decide(
        `review:${instance.id}`,
        'unresolved',
        'product_review_required',
        'Canonical record remains unverified or partially verified; observations are retained but cannot satisfy engineering evidence.',
        {
          instance_id: instance.id,
          component_id: component.id,
          verification_status: component.verification_status,
        },
      );
    warnings.push({
      code: 'installed_envelope_unresolved',
      instance_id: instance.id,
      message:
        'Physical dimensions, if present in the snapshot, do not establish mounted envelope, ventilation or access clearances.',
    });
    if (component.advisory_refs?.length)
      warnings.push({
        code: 'advisory_review_required',
        instance_id: instance.id,
        message:
          'Canonical advisory references remain visible in the component snapshot; no advisory assessment or rating is inferred.',
      });
    if (
      component.terminals?.some(
        (terminal) => terminal.function === 'chassis_ground' || terminal.polarity === 'ground',
      )
    )
      warnings.push({
        code: 'bonding_role_unresolved',
        instance_id: instance.id,
        message:
          'Ground/chassis terminal wording is preserved; intended fault/current role and domain-specific bonding require separate review.',
      });
  }
  for (const issue of validation.issues)
    decide(`installation:${issue.path}:${issue.code}`, 'unresolved', issue.code, issue.message, {
      path: issue.path,
    });
  if (instances.size === 0 || domains.size === 0)
    decide(
      'empty-system',
      'unresolved',
      'empty_system',
      'No complete installed system was supplied.',
      { instance_count: instances.size, domain_count: domains.size },
    );
  if (request.requirements.house_domain_id && !domains.has(request.requirements.house_domain_id))
    throw new TypeError('House domain is not present.');
  for (const [index, source] of (request.requirements.source_availability ?? []).entries()) {
    endpointDomain(source.domain_id);
    decide(
      `availability:${index}:${source.domain_id}`,
      'unresolved',
      'source_schedule_not_evaluated',
      'Availability is retained; route compatibility does not prove recharge or source energy.',
      source,
    );
  }
  if (request.requirements.desired_autonomy_hours !== undefined)
    decide(
      'autonomy',
      'unresolved',
      'autonomy_not_evaluated',
      'Nominal bank capacity alone does not prove autonomy: usable fraction, reserve and charging trajectory are not supplied by this contract.',
      { desired_autonomy_hours: request.requirements.desired_autonomy_hours },
    );
  if (request.requirements.environment !== undefined)
    decide(
      'environment',
      'unresolved',
      'environment_not_evaluated',
      'Environment is preserved, but a complete product operating/packaging interpretation is not implemented in this nominal proof.',
      request.requirements.environment,
    );

  const bindingStates = evaluateInstalledPowerTopology(context);
  const energy = evaluateInstalledScheduledDemand(context, bindingStates);
  evaluateInstalledBatteryBanks(context);
  for (const context of topology.bonding_contexts ?? []) {
    const component = componentFor(context.instance_id);
    endpointDomain(context.domain_id);
    if (!component.terminals?.some((terminal) => terminal.id === context.terminal_id))
      throw new TypeError('Bonding context references a missing terminal.');
    if (context.source_ref_ids.some((id) => !component.source_refs?.some((ref) => ref.id === id)))
      throw new TypeError('Bonding context references missing source evidence.');
    decide(
      `bonding:${context.id}`,
      'unresolved',
      'bonding_not_evaluated',
      'Intended installed role is preserved as supplied context; terminology and references do not prove grounding/bonding compatibility.',
      context,
    );
  }
  const energyStatus = energy.status;
  const status = statusOf(decisions.map((decision) => decision.status));
  const subsystem = {
    severity: severityOf(status),
    code: 'installed_system.proof',
    message: 'Scoped installed-system evidence evaluation.',
    issues: decisions
      .filter((decision) => decision.status !== 'satisfied')
      .map((decision) => ({
        severity: severityOf(decision.status),
        code: decision.code,
        message: `${decision.id}: ${decision.message}`,
      })),
  };
  const aggregate = evaluateSystem({
    systemId: installation.id,
    scope: { mixedVoltage: 'required', loadStates: 'required' },
    mixedVoltage: subsystem,
    loadStates: {
      severity: severityOf(energyStatus),
      code: 'installed_system.energy',
      message: 'Device-side scheduled energy.',
      ...energy,
    },
  });
  const componentBindings = [...components.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((record) => ({
      component_id: record.id,
      record_digest: digests.get(record.id)!,
      record,
      manufacturer_revision: record.manufacturer_revision
        ? {
            state: 'recorded' as const,
            value: record.manufacturer_revision,
            verification_status: record.verification_status,
          }
        : { state: 'unknown' as const },
    }));
  const body = {
    schema_version: '2.0.0' as const,
    evaluator_revision: WHOLE_SYSTEM_EVALUATOR_REVISION,
    input: request,
    input_digest: passportDigest(request),
    component_bindings: componentBindings,
    corpus_digest: passportDigest(
      componentBindings.map(({ component_id, record_digest }) => ({ component_id, record_digest })),
    ),
    rule_data: ruleData,
    rule_data_digest: passportDigest(ruleData),
    examined_evidence: [...facts.values()],
    decisions,
    calculations,
    result: {
      status,
      assertion_scope: 'nominal-connectivity-and-device-demand' as const,
      installation_safety: 'not_evaluated' as const,
      rule_lifecycle_status: ruleData.status,
      energy,
      system_evaluation: aggregate,
      warnings,
      limitations: [
        'Satisfied means only the declared nominal connectivity, individual route ratings, device-side schedules and nominal banks; it is not installation safety approval.',
        'Operating voltage envelopes, contextual port constraints, combined/concurrent ratings, efficiency/losses, charging acceptance and source-energy trajectories are not certified.',
        'Conductor ampacity/protection, switching interruption, installed clearance/orientation, isolation across parallel paths and grounding/bonding need separate review.',
        'Advisory assessments are not loaded or inferred; record advisory references stay visible. No builder or recommendation policy is accepted.',
      ],
    },
  };
  // Validate before copying: JSON.stringify alone could silently convert a
  // non-finite calculation to null or erase an unresolved undefined field.
  const portableBody = JSON.parse(serializePassportValue(body)) as typeof body;
  return { ...portableBody, passport_digest: passportDigest(portableBody) };
};
