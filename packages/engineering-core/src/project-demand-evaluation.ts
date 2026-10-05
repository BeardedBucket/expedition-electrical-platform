import { evaluateLoadStateEnergy } from './load-state-energy.js';
import type { InstalledSystemContext } from './installed-system-context.js';
import type { UnresolvedEnergyContribution } from './engineering-passport-contracts.js';

/** Project W/schedules are explicit intent. They never enter canonical product evidence.
 * Duration accounting follows the existing exclusive-state contract; it establishes
 * no concurrency, dispatch or battery-side energy, and invents no idle/zero states.
 */
export const evaluateProjectOwnedDemand = (context: InstalledSystemContext) => {
  const unresolved: UnresolvedEnergyContribution[] = [];
  let subtotal = 0;
  let stateCount = 0;
  for (const demand of context.projectDemands.values()) {
    const assumptionIds = demand.provenance.assumption_ids ?? [];
    // Never infer timing ownership from the endpoint locator. Legacy omission
    // stays unknown in the trace without changing the caller's input snapshot.
    const scheduleProvenance = demand.schedule_provenance ?? { origin: 'unknown' as const };
    const states = demand.schedule ?? [];
    let hours = 0;
    const reasons: string[] = [];
    if (!states.length) reasons.push('schedule_missing');
    for (const [index, state] of states.entries()) {
      stateCount++;
      // Active W comes from this exact endpoint's declared requirement when the
      // schedule lacks a separate W declaration; other states have no fallback.
      const power =
        state.power_w ?? (state.state === 'active' ? demand.required_power_w : undefined);
      const result = evaluateLoadStateEnergy({
        contributionId: `${demand.id}.${index}`,
        loadId: demand.id,
        stateId: state.state,
        stateClassification: state.state,
        ...(power === undefined ? {} : { powerW: power }),
        ...(state.duration_hours === undefined ? {} : { durationHours: state.duration_hours }),
        powerBasis: 'device-side',
      });
      if (result.energyWh === undefined)
        reasons.push(power === undefined ? 'power_unknown' : 'duration_unknown');
      else {
        subtotal += result.energyWh;
        context.derive(
          `project-energy:${demand.id}.${index}`,
          'energyWh = explicitProjectPowerW * explicitDurationHours',
          {
            power_w: power,
            duration_hours: state.duration_hours,
            provenance: demand.provenance,
            schedule_provenance: scheduleProvenance,
          },
          result.energyWh,
          'Wh',
          [],
          assumptionIds,
        );
      }
      if (state.duration_hours === undefined) reasons.push('duration_unknown');
      else hours += state.duration_hours;
    }
    if (context.request.requirements.evaluation_hours === undefined)
      reasons.push('horizon_unknown');
    else if (hours !== context.request.requirements.evaluation_hours)
      reasons.push('horizon_mismatch');
    const distinctReasons = [...new Set(reasons)].sort();
    if (distinctReasons.length)
      unresolved.push({ kind: 'project_demand', demand_id: demand.id, reasons: distinctReasons });
    context.decide(
      `project-demand:${demand.id}`,
      distinctReasons.length ? 'unresolved' : 'satisfied',
      'project_owned_demand',
      'Project demand remains separate from a product assertion; missing W/durations remain unknown.',
      { ...demand, schedule_provenance: scheduleProvenance },
      [],
      assumptionIds,
    );
  }
  if (!Number.isFinite(subtotal)) throw new TypeError('Project demand energy overflow.');
  return { subtotal, unresolved, stateCount };
};
