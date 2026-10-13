import type { ComponentLibraryRecord } from './component-library.js';
import type { WholeSystemEvaluationInput } from './engineering-passport-contracts.js';
import { hasCurrentCanonicalVerification } from './canonical-verification.js';
import { buildPortableEngineeringEnvelope } from './engineering-envelope-replay.js';
import type { PvInstallation } from './engineering-envelope.js';
import { passportDigest, serializePassportValue } from './portable-json.js';
import { evaluateInstalledSystem } from './whole-system-evaluator.js';

export interface InstalledPvScenario {
  version: 'installed-pv-scenario.v2';
  controller_instance_id: string;
  /** Ordered physical pieces, not SKUs. Omission/null is unknown inventory.
   * Catalog snapshots own manufacturer/model/revision; each piece owns its port.
   * Ordering declares string membership, not proof of series wiring. */
  module_instances: Record<string, { instance_id: string; port_id: string }[] | null>;
  pv: PvInstallation;
}
/** This additive seam feeds existing inherited mandatory predicates. It cannot
 * promote Phase 4 roles, Phase 5 witnesses or Phase 3 installation prerequisites.
 * No positive installation claim is available until protection, routing, thermal
 * and bond consumers exist. A supplied evidence ID is not such a consumer. */
export function bindInstalledPv(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  scenario: InstalledPvScenario,
) {
  if (
    scenario.version !== 'installed-pv-scenario.v2' ||
    Object.keys(scenario).some(
      (k) => !['version', 'controller_instance_id', 'module_instances', 'pv'].includes(k),
    )
  )
    throw new Error('Unsupported installed PV scenario; v1 physical inventory is unprovable');
  const instances = input.architecture.installation.component_instances ?? [];
  if (new Set(catalog.map((r) => r.id)).size !== catalog.length)
    throw new Error('Ambiguous PV catalog identity');
  if (instances.filter((i) => i.id === scenario.controller_instance_id).length > 1)
    throw new Error('Ambiguous controller instance identity');
  const topology = input.architecture.power_topology;
  const recordFor = (id: string) =>
    catalog.find((r) => r.id === instances.find((i) => i.id === id)?.component_id);
  const controller = recordFor(scenario.controller_instance_id);
  const reasons: string[] = [];
  let contradiction = false;
  let inventoryEstablished = true;
  const unknownInventory = (reason: string) => {
    inventoryEstablished = false;
    reasons.push(reason);
  };
  const no = (reason: string) => {
    contradiction = true;
    unknownInventory(reason);
  };
  if (!controller) unknownInventory('controller_instance_identity_unknown');
  else if (controller.id !== scenario.pv.controller_id) {
    no('controller_instance_identity_contradiction');
  }
  const records: ComponentLibraryRecord[] = [];
  if (controller) records.push(controller);
  if (new Set(scenario.pv.strings.map((s) => s.id)).size !== scenario.pv.strings.length)
    throw new Error('Duplicate PV string identity');
  if (
    Object.keys(scenario.module_instances).some(
      (id) => !scenario.pv.strings.some((s) => s.id === id),
    )
  )
    throw new Error('Unrelated PV string inventory');
  if (!scenario.pv.strings.length) unknownInventory('pv_string_inventory_unknown');
  const seen = new Set<string>();
  const physicalInventory: {
    string_id: string;
    instance_id: string;
    port_id: string;
    component_id: string;
    manufacturer: string | null;
    model: string | null;
    manufacturer_revision: string | null;
  }[] = [];
  for (const s of scenario.pv.strings) {
    const members = scenario.module_instances[s.id];
    if (!Number.isSafeInteger(s.series_count) || s.series_count < 1)
      throw new Error('Invalid physical series count');
    if (members == null) unknownInventory(`module_instance_inventory_unknown:${s.id}`);
    else if (!Array.isArray(members)) throw new Error('Invalid physical module inventory');
    else if (members.length !== s.series_count) no(`module_instance_count_contradiction:${s.id}`);
    // Missing bindings are incomplete evidence. Declared wrong ports/domains are
    // contradictions. Neither domain membership nor generated source wires prove
    // the internal series circuit; that remains a mandatory installation UNKNOWN.
    const cb = topology?.bindings.find(
      (b) => b.instance_id === scenario.controller_instance_id && b.port_id === s.terminal_id,
    );
    const domain = topology?.domains.find((d) => d.id === cb?.domain_id);
    const cp = controller?.ports?.find((p) => p.id === s.terminal_id);
    const terminalOwner = controller?.engineering_profile?.trackers?.find(
      (t) => t.grouping_status === 'source_supported' && t.terminal_ids?.includes(s.terminal_id),
    );
    if (terminalOwner && terminalOwner.id !== s.tracker_id) {
      contradiction = true;
      reasons.push(`pv_tracker_terminal_contradiction:${s.id}`);
    }
    if (!cp) reasons.push(`controller_port_identity_unknown:${s.id}`);
    else if (cp.domain !== 'dc' || cp.direction !== 'input') {
      contradiction = true;
      reasons.push(`controller_port_contradiction:${s.id}`);
    }
    if (!cb || !domain) reasons.push(`controller_terminal_topology_unknown:${s.id}`);
    else if (domain.kind !== 'pv_dc') {
      contradiction = true;
      reasons.push(`pv_terminal_topology_mismatch:${s.id}`);
    }
    for (const member of members ?? []) {
      if (
        !member ||
        Object.keys(member).some((k) => !['instance_id', 'port_id'].includes(k)) ||
        !member.instance_id ||
        !member.port_id
      )
        throw new Error('Invalid physical module witness');
      if (seen.has(member.instance_id)) no(`module_instance_reused:${member.instance_id}`);
      if (member.instance_id === scenario.controller_instance_id)
        no(`module_controller_instance_reused:${member.instance_id}`);
      seen.add(member.instance_id);
      const owners = instances.filter((i) => i.id === member.instance_id);
      if (owners.length > 1) no(`module_instance_owner_ambiguous:${member.instance_id}`);
      const module = recordFor(member.instance_id);
      if (!module) {
        unknownInventory(`module_instance_identity_unknown:${member.instance_id}`);
        continue;
      }
      if (module.id !== s.module_id)
        no(`module_instance_identity_contradiction:${member.instance_id}`);
      records.push(module);
      physicalInventory.push({
        string_id: s.id,
        ...member,
        component_id: module.id,
        manufacturer: module.manufacturer ?? null,
        model: module.model ?? null,
        manufacturer_revision: module.manufacturer_revision ?? null,
      });
      if (!module.model || !module.manufacturer)
        unknownInventory(`module_model_identity_unknown:${member.instance_id}`);
      const ports = module.ports?.filter((p) => p.id === member.port_id) ?? [];
      if (ports.length > 1) no(`module_port_identity_ambiguous:${member.instance_id}`);
      const port = ports[0];
      if (!port) unknownInventory(`module_port_identity_unknown:${member.instance_id}`);
      else if (port.domain !== 'dc' || port.direction !== 'output')
        no(`module_port_contradiction:${member.instance_id}`);
      const mb = topology?.bindings.find(
        (b) => b.instance_id === member.instance_id && b.port_id === member.port_id,
      );
      if (!mb) reasons.push(`module_terminal_topology_unknown:${member.instance_id}`);
      else if (cb && mb.domain_id !== cb.domain_id)
        no(`pv_terminal_topology_mismatch:${member.instance_id}`);
      const md = topology?.domains.find((d) => d.id === mb?.domain_id);
      if (md && md.kind !== 'pv_dc') no(`pv_terminal_topology_mismatch:${member.instance_id}`);
    }
  }
  reasons.push('pv_series_parallel_connection_proof_unmodeled');
  const distinct = [...new Map(records.map((r) => [r.id, r])).values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  for (const r of distinct) {
    if (r.verification_status !== 'verified' || !hasCurrentCanonicalVerification(r))
      reasons.push(`profile_authority_unresolved:${r.id}`);
    if (
      !r.engineering_profile ||
      r.engineering_profile.model !== r.model ||
      r.engineering_profile.manufacturer_revision === null ||
      r.engineering_profile.manufacturer_revision !== r.manufacturer_revision
    )
      reasons.push(`profile_identity_revision_unresolved:${r.id}`);
    if (
      r.engineering_profile &&
      (r.engineering_profile.component_id !== r.id ||
        r.engineering_profile.model !== r.model ||
        (r.manufacturer_revision != null &&
          r.engineering_profile.manufacturer_revision != null &&
          r.manufacturer_revision !== r.engineering_profile.manufacturer_revision))
    )
      no(`profile_identity_revision_contradiction:${r.id}`);
  }
  // Null deliberately withholds numerical Ns/Np conclusions when hardware count,
  // identity or output port is unproven. A present envelope is a model diagnostic,
  // never an installed wiring assertion or manufacturer/installation approval.
  const envelope = inventoryEstablished
    ? buildPortableEngineeringEnvelope({
        schema_version: 'engineering-envelope-input.v1',
        profiles: distinct.flatMap((r) => (r.engineering_profile ? [r.engineering_profile] : [])),
        pv: scenario.pv,
      })
    : null;
  // All unmodeled installation prerequisites remain mandatory UNKNOWN. Positive
  // synthetic model checks are useful diagnostics, never live admission.
  reasons.push(...(envelope?.result.unmodeled_constraints ?? ['wiring_and_protection_design']));
  reasons.push(
    ...(envelope?.result.checks ?? [])
      .filter((c) => c.status !== 'ELIGIBLE')
      .map((c) => `${c.status.toLowerCase()}:${c.code}:${c.subject}`),
  );
  const status =
    contradiction || envelope?.result.envelope_status === 'BLOCKED'
      ? ('BLOCKED' as const)
      : ('UNRESOLVED' as const);
  const body = {
    version: 'installed-pv-binding.v2' as const,
    input,
    catalog,
    scenario,
    physical_inventory: physicalInventory,
    envelope_scope: 'inventory-bound-model-diagnostic' as const,
    envelope,
    status,
    reason_codes: [...new Set(reasons)].sort(),
  };
  const content = JSON.parse(serializePassportValue(body)) as typeof body;
  const digest = passportDigest(content);
  if (input.requirements.mandatory_conditions?.some((c) => c.id === 'installed_pv'))
    throw new Error('PV gate already bound; rebuild from original input');
  const bound = JSON.parse(
    serializePassportValue({
      ...input,
      requirements: {
        ...input.requirements,
        mandatory_conditions: [
          ...(input.requirements.mandatory_conditions ?? []),
          {
            id: 'installed_pv',
            subject_id: scenario.controller_instance_id,
            artifact_digest: digest,
            status: status === 'BLOCKED' ? 'blocked' : 'unresolved',
            reason_codes: content.reason_codes,
          },
        ],
      },
    }),
  ) as WholeSystemEvaluationInput;
  return { ...content, digest, bound_input: bound };
}
export function evaluateInstalledPv(
  input: WholeSystemEvaluationInput,
  catalog: readonly ComponentLibraryRecord[],
  scenario: InstalledPvScenario,
) {
  const binding = bindInstalledPv(input, catalog, scenario);
  return { binding, passport: evaluateInstalledSystem(binding.bound_input, catalog) };
}
export function replayInstalledPv(raw: ReturnType<typeof evaluateInstalledPv>) {
  const b = raw.binding,
    replayed = evaluateInstalledPv(b.input, b.catalog, b.scenario);
  if (serializePassportValue(raw) !== serializePassportValue(replayed))
    throw new Error('Installed PV exact replay mismatch');
  return replayed;
}
