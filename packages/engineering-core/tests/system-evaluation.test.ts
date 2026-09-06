import { describe, expect, it } from 'vitest';
import {
  composeLoadStateEnergy,
  evaluateLoadDemandScenario,
  evaluateLoadStateEnergy,
  evaluateMixedVoltageDomains,
  evaluateRechargeWindowFeasibility,
  evaluateStoredEnergySocObservation,
  evaluateStoredEnergyStateTrajectory,
  evaluateSystem,
  evaluateVariableSourceEnergySequence,
} from '../src/index.js';
import type { SystemEvaluationResult } from '../src/system-evaluation.js';

/**
 * Fixtures return freshly evaluated upstream results so each focused test can
 * assert reference retention and exact value copying independently.
 */

const resolvedLoads = () =>
  evaluateLoadDemandScenario({
    scenarioId: 'scenario-a',
    batteryVoltageV: 12,
    loads: [{ id: 'load-a', powerW: 100, runtimeHours: 2 }],
  });

const resolvedIdleState = () =>
  evaluateLoadStateEnergy({
    loadId: 'inverter',
    stateId: 'idle',
    stateClassification: 'idle',
    powerW: 20,
    durationHours: 10,
  });

const unknownDurationIdleState = () =>
  evaluateLoadStateEnergy({
    loadId: 'inverter',
    stateId: 'idle',
    stateClassification: 'idle',
    powerW: 20,
  });

const includedOverheadComposition = () =>
  composeLoadStateEnergy({
    compositionId: 'comp-1',
    contributions: [
      {
        contributionId: 'active',
        loadId: 'inverter',
        stateId: 'active',
        powerW: 200,
        durationHours: 2,
      },
      {
        contributionId: 'idle-included',
        loadId: 'inverter',
        stateId: 'idle',
        powerW: 20,
        durationHours: 10,
        includedInContributionId: 'active',
      },
    ],
  });

const resolvedSource = () =>
  evaluateVariableSourceEnergySequence({
    sequenceId: 'src',
    intervals: [{ intervalId: 'i1', contributions: [{ sourceId: 'solar', energyWh: 600 }] }],
  });

const explicitZeroSource = () =>
  evaluateVariableSourceEnergySequence({
    sequenceId: 'src-zero',
    intervals: [{ intervalId: 'i1', contributions: [{ sourceId: 'solar', energyWh: 0 }] }],
  });

const unknownSource = () =>
  evaluateVariableSourceEnergySequence({
    sequenceId: 'src-unknown',
    intervals: [{ intervalId: 'i1', contributions: [{ sourceId: 'solar' }] }],
  });

const normalStorage = () =>
  evaluateStoredEnergyStateTrajectory({
    trajectoryId: 'traj-normal',
    startingStoredEnergyWh: 600,
    lowerStoredEnergyBoundWh: 200,
    upperStoredEnergyBoundWh: 1000,
    intervals: [
      { intervalId: 'dusk', requestedNetEnergyWh: -200 },
      { intervalId: 'dawn', requestedNetEnergyWh: 100 },
    ],
  });

const curtailedStorage = () =>
  evaluateStoredEnergyStateTrajectory({
    trajectoryId: 'traj-curtail',
    startingStoredEnergyWh: 950,
    lowerStoredEnergyBoundWh: 200,
    upperStoredEnergyBoundWh: 1000,
    intervals: [{ intervalId: 'i1', requestedNetEnergyWh: 400 }],
  });

const unmetStorage = () =>
  evaluateStoredEnergyStateTrajectory({
    trajectoryId: 'traj-unmet',
    startingStoredEnergyWh: 300,
    lowerStoredEnergyBoundWh: 200,
    upperStoredEnergyBoundWh: 1000,
    intervals: [{ intervalId: 'i1', requestedNetEnergyWh: -340 }],
  });

const aboveReserveSoc = () =>
  evaluateStoredEnergySocObservation({
    storedEnergyWh: 600,
    lowerStoredEnergyBoundWh: 200,
    upperStoredEnergyBoundWh: 1000,
    desiredReserveSocPercent: 20,
  });

const belowReserveSoc = () =>
  evaluateStoredEnergySocObservation({
    storedEnergyWh: 300,
    lowerStoredEnergyBoundWh: 200,
    upperStoredEnergyBoundWh: 1000,
    desiredReserveSocPercent: 40,
  });

const exactRecharge = () =>
  evaluateRechargeWindowFeasibility({
    requirementId: 'rw-exact',
    requiredRecoveryEnergyWh: 400,
    recoveryDurationHours: 4,
    acceptedBatterySideChargingPowerW: 100,
  });

const excessRecharge = () =>
  evaluateRechargeWindowFeasibility({
    requirementId: 'rw-excess',
    requiredRecoveryEnergyWh: 400,
    recoveryDurationHours: 4,
    acceptedBatterySideChargingPowerW: 200,
  });

const shortfallRecharge = () =>
  evaluateRechargeWindowFeasibility({
    requirementId: 'rw-short',
    requiredRecoveryEnergyWh: 800,
    recoveryDurationHours: 4,
    acceptedBatterySideChargingPowerW: 100,
  });

const mixedVoltageDomains = (pathContinuousPowerW: number, requiredContinuousPowerW: number) =>
  evaluateMixedVoltageDomains({
    domains: [
      { id: 'dc-24', nominalVoltageV: 24, storage: 'present' },
      { id: 'dc-12', nominalVoltageV: 12, storage: 'absent' },
    ],
    paths: [
      {
        id: 'conv-24-12',
        sourceDomainId: 'dc-24',
        targetDomainId: 'dc-12',
        permission: 'allowed',
        available: 'available',
        capabilityStatus: 'resolved',
        continuousPowerW: pathContinuousPowerW,
      },
    ],
    requirements: [
      {
        id: 'req-12v',
        sourceDomainId: 'dc-24',
        targetDomainId: 'dc-12',
        relationship: 'required',
        pathId: 'conv-24-12',
        continuousPowerW: requiredContinuousPowerW,
      },
    ],
  });

const singleVoltageDomain = (nominalVoltageV: number) =>
  evaluateMixedVoltageDomains({
    domains: [{ id: `dc-${nominalVoltageV}`, nominalVoltageV, storage: 'present' }],
  });

const sameVoltageSeparateDomains = () =>
  evaluateMixedVoltageDomains({
    domains: [
      { id: 'house-12', nominalVoltageV: 12, storage: 'present' },
      { id: 'auxiliary-12', nominalVoltageV: 12, storage: 'present' },
    ],
    paths: [
      {
        id: 'link-12-12',
        sourceDomainId: 'house-12',
        targetDomainId: 'auxiliary-12',
        permission: 'allowed',
        available: 'available',
        capabilityStatus: 'resolved',
        continuousPowerW: 300,
      },
    ],
    requirements: [
      {
        id: 'req-link',
        sourceDomainId: 'house-12',
        targetDomainId: 'auxiliary-12',
        relationship: 'required',
        pathId: 'link-12-12',
        continuousPowerW: 100,
      },
    ],
  });

const warningSubsystem = () => ({
  severity: 'WARNING' as const,
  code: 'charging.derated_capability',
  message: 'Configured charging capability is below installed capability.',
});

type Indexed = Record<string, unknown>;
const asRecord = (value: unknown): Indexed => value as Indexed;
const observationValue = (result: SystemEvaluationResult, key: string, origin: string): unknown =>
  result.summaryObservations.find((entry) => entry.key === key && entry.origin === origin)?.value;

describe('evaluateSystem / evaluation scope and completeness', () => {
  it('returns CONDITIONAL for an evaluation with no subsystems', () => {
    expect(evaluateSystem({}).status).toBe('CONDITIONAL');
  });

  it('exposes no summary observations for an empty evaluation', () => {
    expect(evaluateSystem({}).summaryObservations).toEqual([]);
  });

  it('does not fabricate load, source, or storage results when nothing is supplied', () => {
    const result = evaluateSystem({});

    expect(result.loads).toBeUndefined();
    expect(result.variableSources).toBeUndefined();
    expect(result.storage).toBeUndefined();
    expect(result.subsystemResults).toEqual({});
  });

  it('retains a load-only evaluation as PASS', () => {
    const loads = resolvedLoads();
    const result = evaluateSystem({ scope: { loads: 'required' }, loads });

    expect(result.status).toBe('PASS');
    expect(result.loads).toBe(loads);
  });

  it('omits an unsupplied optional subsystem from subsystemResults', () => {
    const result = evaluateSystem({
      scope: { loads: 'required', variableSources: 'optional' },
      loads: resolvedLoads(),
    });

    expect(Object.keys(result.subsystemResults)).toEqual(['loads']);
  });

  it('does not create an unresolved dependency for an omitted optional subsystem', () => {
    const result = evaluateSystem({
      scope: { loads: 'required', storage: 'optional' },
      loads: resolvedLoads(),
    });

    expect(result.unresolvedDependencies).toEqual([]);
  });

  it('reports an unresolved dependency for a required-but-missing subsystem', () => {
    const result = evaluateSystem({
      scope: { loads: 'required', storage: 'required' },
      loads: resolvedLoads(),
    });

    expect(result.unresolvedDependencies).toHaveLength(1);
    expect(result.unresolvedDependencies[0]?.subsystem).toBe('storage');
    expect(result.unresolvedDependencies[0]?.required).toBe(true);
  });

  it('drives CONDITIONAL rather than FAIL for a required-but-missing subsystem', () => {
    const result = evaluateSystem({
      scope: { loads: 'required', storage: 'required' },
      loads: resolvedLoads(),
    });

    expect(result.status).toBe('CONDITIONAL');
  });

  it('distinguishes applicable subsystems from omitted subsystems', () => {
    const result = evaluateSystem({
      scope: { loads: 'required', variableSources: 'omitted' },
      loads: resolvedLoads(),
    });

    expect(result.scope.variableSources).toBe('omitted');
    expect(result.subsystemResults.variableSources).toBeUndefined();
    expect(result.unresolvedDependencies).toEqual([]);
  });

  it('does not represent an omitted source as zero energy', () => {
    const result = evaluateSystem({ loads: resolvedLoads() });

    expect(result.variableSources).toBeUndefined();
    expect(observationValue(result, 'totalSourceEnergyWh', 'variableSources')).toBeUndefined();
    expect(observationValue(result, 'knownSourceEnergyWh', 'variableSources')).toBeUndefined();
  });

  it('represents an explicit zero source as a resolved zero total', () => {
    const result = evaluateSystem({ variableSources: explicitZeroSource() });

    expect(result.status).toBe('PASS');
    expect(observationValue(result, 'totalSourceEnergyWh', 'variableSources')).toBe(0);
  });
});

describe('evaluateSystem / severity and failure propagation', () => {
  it('preserves a local PASS and reports PASS', () => {
    const result = evaluateSystem({ loads: resolvedLoads() });

    expect(asRecord(result.loads).severity).toBe('PASS');
    expect(result.status).toBe('PASS');
  });

  it('preserves a local WARNING and reports WARNING', () => {
    const charging = warningSubsystem();
    const result = evaluateSystem({ charging });

    expect(result.charging).toBe(charging);
    expect(result.status).toBe('WARNING');
  });

  it('preserves a local CONDITIONAL and reports CONDITIONAL', () => {
    const variableSources = unknownSource();
    const result = evaluateSystem({ variableSources });

    expect(asRecord(result.variableSources).severity).toBe('CONDITIONAL');
    expect(result.status).toBe('CONDITIONAL');
  });

  it('preserves a local FAIL and reports FAIL', () => {
    const storage = unmetStorage();
    const result = evaluateSystem({ storage });

    expect(asRecord(result.storage).severity).toBe('FAIL');
    expect(result.status).toBe('FAIL');
  });

  it('escalates to FAIL when a local FAIL coexists with an unresolved subsystem', () => {
    const result = evaluateSystem({
      storage: unmetStorage(),
      variableSources: unknownSource(),
    });

    expect(result.status).toBe('FAIL');
  });

  it('ranks CONDITIONAL above WARNING at the top level', () => {
    const result = evaluateSystem({
      charging: warningSubsystem(),
      variableSources: unknownSource(),
    });

    expect(result.status).toBe('CONDITIONAL');
  });

  it('keeps a failing subsystem from erasing a passing subsystem result', () => {
    const result = evaluateSystem({
      storage: normalStorage(),
      mixedVoltage: mixedVoltageDomains(300, 700),
    });

    expect(result.status).toBe('FAIL');
    expect(asRecord(result.storage).severity).toBe('PASS');
    expect(asRecord(result.storage).endingStoredEnergyWh).toBe(500);
  });

  it('scopes a failed constraint to its owning subsystem', () => {
    const result = evaluateSystem({
      storage: normalStorage(),
      mixedVoltage: mixedVoltageDomains(300, 700),
    });

    expect(result.failedConstraints.map((entry) => entry.subsystem)).toEqual(['mixedVoltage']);
  });
});

describe('evaluateSystem / result and issue preservation', () => {
  it('retains the original subsystem result object by reference', () => {
    const storage = normalStorage();

    expect(evaluateSystem({ storage }).storage).toBe(storage);
  });

  it('retains every supplied subsystem result simultaneously', () => {
    const loads = resolvedLoads();
    const variableSources = resolvedSource();
    const storage = normalStorage();
    const socReserve = aboveReserveSoc();
    const result = evaluateSystem({ loads, variableSources, storage, socReserve });

    expect(result.loads).toBe(loads);
    expect(result.variableSources).toBe(variableSources);
    expect(result.storage).toBe(storage);
    expect(result.socReserve).toBe(socReserve);
  });

  it('aggregates nested subsystem issues into the system issue list', () => {
    const result = evaluateSystem({ mixedVoltage: mixedVoltageDomains(300, 700) });

    expect(
      result.issues.some((issue) => issue.code === 'continuous_path_capacity_insufficient'),
    ).toBe(true);
  });

  it('tags each aggregated issue with its owning subsystem', () => {
    const result = evaluateSystem({ mixedVoltage: mixedVoltageDomains(300, 700) });
    const issue = result.issues.find(
      (entry) => entry.code === 'continuous_path_capacity_insufficient',
    );

    expect(issue?.subsystem).toBe('mixedVoltage');
  });

  it('preserves the original issue code and message', () => {
    const result = evaluateSystem({ recharge: shortfallRecharge() });
    const issue = result.issues.find(
      (entry) => entry.code === 'recharge_window_feasibility.insufficient_charging_power',
    );

    expect(issue?.severity).toBe('FAIL');
    expect(issue?.message).toContain('insufficient');
  });

  it('does not emit issues for passing subsystems', () => {
    const result = evaluateSystem({ loads: resolvedLoads(), storage: normalStorage() });

    expect(result.issues).toEqual([]);
  });

  it('does not duplicate an identical issue', () => {
    const result = evaluateSystem({ mixedVoltage: mixedVoltageDomains(300, 700) });
    const codes = result.issues.map((issue) => `${issue.subsystem}:${issue.code}:${issue.message}`);

    expect(codes).toEqual([...new Set(codes)]);
  });

  it('reports unresolved dependencies with subsystem and reason', () => {
    const result = evaluateSystem({ variableSources: unknownSource() });

    expect(result.unresolvedDependencies[0]?.subsystem).toBe('variableSources');
    expect(result.unresolvedDependencies[0]?.reason.length).toBeGreaterThan(0);
  });

  it('does not classify a warning subsystem as an unresolved dependency', () => {
    const result = evaluateSystem({ charging: warningSubsystem() });

    expect(result.unresolvedDependencies).toEqual([]);
  });

  it('keeps full local detail available alongside summary observations', () => {
    const storage = normalStorage();
    const result = evaluateSystem({ storage });

    expect(asRecord(result.storage).intervals).toBe(asRecord(storage).intervals);
    expect(result.summaryObservations.length).toBeGreaterThan(0);
  });
});

describe('evaluateSystem / load and load-state integration', () => {
  it('preserves a resolved idle load-state contribution', () => {
    const loadStates = resolvedIdleState();
    const result = evaluateSystem({ loadStates });

    expect(result.loadStates).toBe(loadStates);
    expect(asRecord(result.loadStates).energyWh).toBe(200);
  });

  it('keeps an unknown idle duration unresolved', () => {
    const result = evaluateSystem({ loadStates: unknownDurationIdleState() });

    expect(asRecord(result.loadStates).severity).toBe('CONDITIONAL');
    expect(result.status).toBe('CONDITIONAL');
  });

  it('does not convert an unknown idle duration into zero energy', () => {
    const result = evaluateSystem({ loadStates: unknownDurationIdleState() });

    expect(asRecord(result.loadStates).energyWh).toBeUndefined();
    expect(asRecord(result.loadStates).durationHours).toBeUndefined();
  });

  it('does not re-add an included-overhead idle contribution', () => {
    const result = evaluateSystem({ loadStates: includedOverheadComposition() });

    expect(asRecord(result.loadStates).totalEnergyWh).toBe(400);
    expect(observationValue(result, 'totalEnergyWh', 'loadStates')).toBe(400);
  });

  it('represents an independent idle contribution alongside active loads', () => {
    const result = evaluateSystem({ loads: resolvedLoads(), loadStates: resolvedIdleState() });

    expect(observationValue(result, 'totalLoadEnergyWh', 'loads')).toBe(200);
    expect(observationValue(result, 'energyWh', 'loadStates')).toBe(200);
  });

  it('does not insert a baseline idle load when only loads are supplied', () => {
    const result = evaluateSystem({ loads: resolvedLoads() });

    expect(result.loadStates).toBeUndefined();
    expect(observationValue(result, 'totalLoadEnergyWh', 'loads')).toBe(200);
  });
});

describe('evaluateSystem / variable source integration', () => {
  it('preserves a resolved variable source contribution', () => {
    const variableSources = resolvedSource();
    const result = evaluateSystem({ variableSources });

    expect(result.variableSources).toBe(variableSources);
    expect(observationValue(result, 'totalSourceEnergyWh', 'variableSources')).toBe(600);
  });

  it('does not produce a source total for an unresolved source', () => {
    const result = evaluateSystem({ variableSources: unknownSource() });

    expect(observationValue(result, 'totalSourceEnergyWh', 'variableSources')).toBeUndefined();
  });

  it('retains knownSourceEnergyWh as a partial fact for an unresolved source', () => {
    const result = evaluateSystem({ variableSources: unknownSource() });

    expect(observationValue(result, 'knownSourceEnergyWh', 'variableSources')).toBe(0);
    expect(asRecord(result.variableSources).completeSequence).toBe(false);
  });

  it('resolves an explicit zero source total', () => {
    const result = evaluateSystem({ variableSources: explicitZeroSource() });

    expect(asRecord(result.variableSources).completeSequence).toBe(true);
    expect(observationValue(result, 'totalSourceEnergyWh', 'variableSources')).toBe(0);
  });

  it('keeps modeled source energy distinct from stored energy', () => {
    const result = evaluateSystem({
      variableSources: resolvedSource(),
      storage: curtailedStorage(),
    });

    expect(observationValue(result, 'totalSourceEnergyWh', 'variableSources')).toBe(600);
    expect(observationValue(result, 'totalStoredChargingEnergyWh', 'storage')).toBe(50);
  });

  it('traces the source summary observation to the variableSources subsystem', () => {
    const result = evaluateSystem({ variableSources: resolvedSource() });
    const observation = result.summaryObservations.find(
      (entry) => entry.key === 'totalSourceEnergyWh',
    );

    expect(observation?.origin).toBe('variableSources');
    expect(observation?.provenance).toEqual(['variableSources']);
  });
});

describe('evaluateSystem / storage integration', () => {
  it('preserves a normal bounded storage transfer', () => {
    const result = evaluateSystem({ storage: normalStorage() });

    expect(result.status).toBe('PASS');
    expect(observationValue(result, 'endingStoredEnergyWh', 'storage')).toBe(500);
  });

  it('preserves curtailed energy reported by storage', () => {
    const result = evaluateSystem({ storage: curtailedStorage() });

    expect(observationValue(result, 'totalCurtailedEnergyWh', 'storage')).toBe(350);
  });

  it('does not fail or penalize an evaluation solely because energy was curtailed', () => {
    const result = evaluateSystem({ storage: curtailedStorage() });

    expect(result.status).toBe('PASS');
    expect(result.issues).toEqual([]);
    expect(result.failedConstraints).toEqual([]);
  });

  it('preserves unmet discharge energy reported by storage', () => {
    const result = evaluateSystem({ storage: unmetStorage() });

    expect(observationValue(result, 'totalUnmetEnergyWh', 'storage')).toBe(240);
  });

  it('escalates a storage local FAIL to the top-level status', () => {
    const result = evaluateSystem({ storage: unmetStorage() });

    expect(result.status).toBe('FAIL');
    expect(result.failedConstraints[0]?.subsystem).toBe('storage');
  });

  it('copies storage totals without recomputing them', () => {
    const storage = curtailedStorage();
    const result = evaluateSystem({ storage });

    expect(observationValue(result, 'totalCurtailedEnergyWh', 'storage')).toBe(
      asRecord(storage).totalCurtailedEnergyWh,
    );
    expect(observationValue(result, 'minimumStoredEnergyWh', 'storage')).toBe(
      asRecord(storage).minimumStoredEnergyWh,
    );
  });
});

describe('evaluateSystem / SOC and reserve integration', () => {
  it('preserves the usable-window SOC observation', () => {
    const result = evaluateSystem({ socReserve: aboveReserveSoc() });

    expect(observationValue(result, 'usableWindowSocPercent', 'socReserve')).toBe(50);
  });

  it('preserves stored-energy bounds and ending stored energy alongside SOC', () => {
    const result = evaluateSystem({ socReserve: aboveReserveSoc(), storage: normalStorage() });

    expect(asRecord(result.socReserve).lowerStoredEnergyBoundWh).toBe(200);
    expect(asRecord(result.socReserve).upperStoredEnergyBoundWh).toBe(1000);
    expect(observationValue(result, 'endingStoredEnergyWh', 'storage')).toBe(500);
  });

  it('preserves the reserve margin reported by the SOC evaluator', () => {
    const result = evaluateSystem({ socReserve: aboveReserveSoc() });

    expect(observationValue(result, 'reserveMarginPercentagePoints', 'socReserve')).toBe(30);
    expect(observationValue(result, 'reserveMarginWh', 'socReserve')).toBe(240);
  });

  it('preserves a below-reserve state without upstream severity change', () => {
    const socReserve = belowReserveSoc();
    const result = evaluateSystem({ socReserve });

    expect(asRecord(result.socReserve).reserveState).toBe('below-reserve');
    expect(asRecord(result.socReserve).severity).toBe(asRecord(socReserve).severity);
  });

  it('does not convert a reserve breach into a hard system failure', () => {
    const result = evaluateSystem({ socReserve: belowReserveSoc() });

    expect(result.status).toBe('PASS');
    expect(result.failedConstraints).toEqual([]);
  });
});

describe('evaluateSystem / recharge integration', () => {
  it('preserves an exactly feasible recharge window as PASS', () => {
    const result = evaluateSystem({ recharge: exactRecharge() });

    expect(result.status).toBe('PASS');
    expect(observationValue(result, 'recoveryFeasible', 'recharge')).toBe(true);
  });

  it('treats excess recovery capability as a neutral observation', () => {
    const result = evaluateSystem({ recharge: excessRecharge() });

    expect(result.status).toBe('PASS');
    expect(observationValue(result, 'energySurplusWh', 'recharge')).toBe(400);
    expect(result.failedConstraints).toEqual([]);
  });

  it('preserves a recharge shortfall and its local FAIL', () => {
    const result = evaluateSystem({ recharge: shortfallRecharge() });

    expect(result.status).toBe('FAIL');
    expect(observationValue(result, 'energyShortfallWh', 'recharge')).toBe(400);
  });

  it('does not invent a recovery requirement when recharge is omitted', () => {
    const result = evaluateSystem({ storage: unmetStorage(), socReserve: belowReserveSoc() });

    expect(result.recharge).toBeUndefined();
    expect(observationValue(result, 'requiredRecoveryEnergyWh', 'recharge')).toBeUndefined();
  });
});

describe('evaluateSystem / mixed-voltage integration', () => {
  it('preserves a valid mixed-voltage conversion path as PASS', () => {
    const mixedVoltage = mixedVoltageDomains(600, 500);
    const result = evaluateSystem({ mixedVoltage });

    expect(result.mixedVoltage).toBe(mixedVoltage);
    expect(result.status).toBe('PASS');
  });

  it('preserves an inadequate conversion path as a local FAIL', () => {
    const result = evaluateSystem({ mixedVoltage: mixedVoltageDomains(300, 700) });

    expect(asRecord(result.mixedVoltage).severity).toBe('FAIL');
    expect(result.status).toBe('FAIL');
  });

  it('keeps storage PASS visible after a mixed-voltage path FAIL', () => {
    const result = evaluateSystem({
      storage: normalStorage(),
      mixedVoltage: mixedVoltageDomains(300, 700),
    });

    expect(asRecord(result.storage).severity).toBe('PASS');
    expect(observationValue(result, 'endingStoredEnergyWh', 'storage')).toBe(500);
  });

  it('does not penalize an evaluation merely because conversion exists', () => {
    const result = evaluateSystem({ mixedVoltage: mixedVoltageDomains(600, 500) });
    const observations = asRecord(result.mixedVoltage).observations as {
      conversionRequired?: boolean;
    }[];

    expect(observations[0]?.conversionRequired).toBe(true);
    expect(result.status).toBe('PASS');
    expect(result.issues).toEqual([]);
  });

  it('keeps same-voltage separate domains distinct', () => {
    const result = evaluateSystem({ mixedVoltage: sameVoltageSeparateDomains() });
    const domains = asRecord(result.mixedVoltage).domains as { domainId: string }[];

    expect(domains.map((domain) => domain.domainId)).toEqual(['house-12', 'auxiliary-12']);
    expect(result.status).toBe('PASS');
  });

  it('treats 12 V and 24 V architectures identically', () => {
    const twelve = evaluateSystem({ mixedVoltage: singleVoltageDomain(12) });
    const twentyFour = evaluateSystem({ mixedVoltage: singleVoltageDomain(24) });

    expect(twelve.status).toBe(twentyFour.status);
    expect(twelve.failedConstraints).toEqual(twentyFour.failedConstraints);
  });
});

describe('evaluateSystem / temporal and aggregation semantics', () => {
  it('preserves caller interval order', () => {
    const result = evaluateSystem({ storage: normalStorage() });
    const intervals = asRecord(result.storage).intervals as { intervalId: string }[];

    expect(intervals.map((interval) => interval.intervalId)).toEqual(['dusk', 'dawn']);
  });

  it('does not extend partial temporal coverage to a full day', () => {
    const result = evaluateSystem({ storage: normalStorage() });
    const intervals = asRecord(result.storage).intervals as unknown[];

    expect(intervals).toHaveLength(2);
    expect(asRecord(result.storage).coverageHours).toBeUndefined();
  });

  it('introduces no calendar or day fields', () => {
    const serialized = JSON.stringify(evaluateSystem({ storage: normalStorage() }));

    expect(serialized).not.toMatch(/"(day|date|calendar|dayIndex|week|month)":/i);
  });

  it('preserves alternative case results without summing them', () => {
    const alternatives = [normalStorage(), curtailedStorage()];
    const result = evaluateSystem({ operatingScenarios: alternatives });

    expect(result.operatingScenarios).toBe(alternatives);
    expect(observationValue(result, 'endingStoredEnergyWh', 'operatingScenarios')).toBeUndefined();
  });

  it('escalates when an alternative-case array contains a local FAIL', () => {
    const result = evaluateSystem({ operatingScenarios: [normalStorage(), unmetStorage()] });

    expect(result.status).toBe('FAIL');
  });

  it('does not sum values across different subsystems', () => {
    const result = evaluateSystem({ loads: resolvedLoads(), loadStates: resolvedIdleState() });
    const combinedTotals = result.summaryObservations.filter((entry) => entry.value === 400);

    expect(combinedTotals).toEqual([]);
  });
});

describe('evaluateSystem / summary observations and traceability', () => {
  it('copies an upstream summary value exactly', () => {
    const loads = resolvedLoads();
    const result = evaluateSystem({ loads });

    expect(observationValue(result, 'totalLoadEnergyWh', 'loads')).toBe(
      asRecord(loads).totalLoadEnergyWh,
    );
  });

  it('identifies the owning subsystem for every summary observation', () => {
    const result = evaluateSystem({
      loads: resolvedLoads(),
      storage: normalStorage(),
      socReserve: aboveReserveSoc(),
    });

    for (const observation of result.summaryObservations) {
      expect(Object.keys(result.subsystemResults)).toContain(observation.origin);
    }
  });

  it('exposes failed constraints as neutral factual entries', () => {
    const result = evaluateSystem({ recharge: shortfallRecharge() });

    expect(result.failedConstraints).toHaveLength(1);
    expect(result.failedConstraints[0]).toMatchObject({
      subsystem: 'recharge',
      severity: 'FAIL',
      code: 'recharge_window_feasibility.insufficient_charging_power',
    });
  });

  it('exposes unresolved dependencies as neutral factual entries', () => {
    const result = evaluateSystem({
      scope: { storage: 'required' },
      variableSources: unknownSource(),
    });

    expect(result.unresolvedDependencies.map((entry) => entry.subsystem).sort()).toEqual([
      'storage',
      'variableSources',
    ]);
  });

  it('derives no summary field that is absent from its owning result', () => {
    const result = evaluateSystem({
      loads: resolvedLoads(),
      storage: normalStorage(),
      socReserve: aboveReserveSoc(),
      recharge: exactRecharge(),
    });

    for (const observation of result.summaryObservations) {
      const owner = asRecord(result.subsystemResults[observation.origin]);
      expect(owner[observation.key]).toBe(observation.value);
    }
  });
});

describe('evaluateSystem / representative whole-system cases', () => {
  it('evaluates a fully resolved multi-subsystem model as PASS', () => {
    const result = evaluateSystem({
      scope: { loads: 'required', variableSources: 'required', storage: 'required' },
      loads: resolvedLoads(),
      loadStates: resolvedIdleState(),
      variableSources: resolvedSource(),
      storage: normalStorage(),
      socReserve: aboveReserveSoc(),
      recharge: exactRecharge(),
      mixedVoltage: mixedVoltageDomains(600, 500),
    });

    expect(result.status).toBe('PASS');
    expect(result.failedConstraints).toEqual([]);
    expect(result.unresolvedDependencies).toEqual([]);
  });

  it('evaluates a representative curtailment system', () => {
    const result = evaluateSystem({
      variableSources: resolvedSource(),
      storage: curtailedStorage(),
    });

    expect(result.status).toBe('PASS');
    expect(observationValue(result, 'totalSourceEnergyWh', 'variableSources')).toBe(600);
    expect(observationValue(result, 'totalCurtailedEnergyWh', 'storage')).toBe(350);
  });

  it('evaluates a representative unmet-load system', () => {
    const result = evaluateSystem({ loads: resolvedLoads(), storage: unmetStorage() });

    expect(result.status).toBe('FAIL');
    expect(observationValue(result, 'totalUnmetEnergyWh', 'storage')).toBe(240);
    expect(asRecord(result.loads).severity).toBe('PASS');
  });

  it('evaluates a representative reserve-crossing system', () => {
    const result = evaluateSystem({ storage: normalStorage(), socReserve: belowReserveSoc() });

    expect(result.status).toBe('PASS');
    expect(asRecord(result.socReserve).reserveState).toBe('below-reserve');
  });

  it('evaluates a representative recharge-shortfall system', () => {
    const result = evaluateSystem({ storage: normalStorage(), recharge: shortfallRecharge() });

    expect(result.status).toBe('FAIL');
    expect(result.failedConstraints.map((entry) => entry.subsystem)).toEqual(['recharge']);
    expect(asRecord(result.storage).severity).toBe('PASS');
  });

  it('evaluates a representative valid mixed-voltage system', () => {
    const result = evaluateSystem({
      storage: normalStorage(),
      mixedVoltage: mixedVoltageDomains(600, 500),
    });

    expect(result.status).toBe('PASS');
    expect(result.issues).toEqual([]);
  });

  it('evaluates a representative unresolved partial model', () => {
    const result = evaluateSystem({
      scope: { loads: 'required', variableSources: 'required', storage: 'omitted' },
      loads: resolvedLoads(),
      variableSources: unknownSource(),
    });

    expect(result.status).toBe('CONDITIONAL');
    expect(result.storage).toBeUndefined();
    expect(asRecord(result.loads).severity).toBe('PASS');
  });
});

describe('evaluateSystem / boundary and anti-feature guarantees', () => {
  it('produces identical results for repeated evaluation', () => {
    const build = () => ({
      loads: resolvedLoads(),
      storage: normalStorage(),
      socReserve: aboveReserveSoc(),
    });

    expect(evaluateSystem(build())).toEqual(evaluateSystem(build()));
  });

  it('introduces no timestamp or environment dependent field', () => {
    const serialized = JSON.stringify(evaluateSystem({ storage: normalStorage() }));

    expect(serialized).not.toMatch(/"(timestamp|evaluatedAt|generatedAt|createdAt|now)":/i);
  });

  it('exposes no score, rating, or grade field', () => {
    const serialized = JSON.stringify(
      evaluateSystem({ loads: resolvedLoads(), storage: normalStorage() }),
    );

    expect(serialized).not.toMatch(/"(score|rating|grade|quality|efficiencyScore)":/i);
  });

  it('emits no recommendation language in orchestrator authored text', () => {
    const result = evaluateSystem({
      storage: unmetStorage(),
      mixedVoltage: mixedVoltageDomains(300, 700),
    });
    const authored = [
      result.message,
      ...result.issues
        .filter((issue) => issue.code.startsWith('system_evaluation.'))
        .map((issue) => issue.message),
      ...result.unresolvedDependencies.map((entry) => entry.reason),
    ].join(' ');

    expect(authored).not.toMatch(/\brecommend|\bshould\b|\badd (another|more)\b|\buse a larger\b/i);
  });

  it('generates no additional architectures or candidates', () => {
    const result = evaluateSystem({ mixedVoltage: mixedVoltageDomains(300, 700) });

    expect(Object.keys(result.subsystemResults)).toEqual(['mixedVoltage']);
    expect(asRecord(result).alternatives).toBeUndefined();
    expect(asRecord(result).candidates).toBeUndefined();
  });

  it('introduces no product, SKU, or manufacturer field', () => {
    const result = evaluateSystem({ loads: resolvedLoads(), storage: normalStorage() });

    expect(asRecord(result).productId).toBeUndefined();
    expect(asRecord(result).sku).toBeUndefined();
    expect(asRecord(result).manufacturer).toBeUndefined();
  });

  it('ignores non-engineering identity when composing status', () => {
    const first = evaluateSystem({
      systemId: 'system-a',
      loads: resolvedLoads(),
      storage: normalStorage(),
    });
    const second = evaluateSystem({
      systemId: 'system-b',
      loads: resolvedLoads(),
      storage: normalStorage(),
    });

    expect(first.status).toBe(second.status);
    expect(first.summaryObservations).toEqual(second.summaryObservations);
  });

  it('applies no hidden efficiency to supplied energy values', () => {
    const loads = resolvedLoads();
    const result = evaluateSystem({ loads });

    expect(observationValue(result, 'totalLoadEnergyWh', 'loads')).toBe(200);
    expect(asRecord(result.loads).totalBatteryEnergyWh).toBe(asRecord(loads).totalBatteryEnergyWh);
  });

  it('applies no hidden default runtime to an unresolved duration', () => {
    const result = evaluateSystem({ loadStates: unknownDurationIdleState() });

    expect(asRecord(result.loadStates).durationHours).toBeUndefined();
    expect(asRecord(result.loadStates).energyWh).toBeUndefined();
  });

  it('evaluates a stationary system with no vehicle domain', () => {
    const result = evaluateSystem({
      scope: { loads: 'required', storage: 'required' },
      loads: resolvedLoads(),
      storage: normalStorage(),
      mixedVoltage: singleVoltageDomain(48),
    });

    expect(result.status).toBe('PASS');
    expect(JSON.stringify(result)).not.toMatch(/chassis|alternator|vehicle|tow|van\b/i);
  });
});
