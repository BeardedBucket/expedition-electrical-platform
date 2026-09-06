import { describe, expect, it } from 'vitest';
import {
  evaluateBatteryChargeAcceptance,
  evaluateChargingSourceScenario,
  evaluateLoadDemandScenario,
  evaluateOperatingPowerEnvelope,
  evaluateOperatingPowerBalance,
  type BatteryEngineeringInput,
  type OperatingPowerBalanceResult,
} from '../src/index.js';

const balance = (
  operatingCaseId: string,
  values: {
    deficitW?: number;
    surplusW?: number;
    severity?: OperatingPowerBalanceResult['severity'];
    demandScenarioId?: string;
    sourceScenarioId?: string;
    issues?: readonly string[];
  },
): OperatingPowerBalanceResult => ({
  operatingCaseId,
  demandScenarioId: values.demandScenarioId ?? `${operatingCaseId}-loads`,
  sourceScenarioId: values.sourceScenarioId ?? `${operatingCaseId}-charging`,
  batteryId: 'battery',
  selectedTopology: { seriesCount: 1, parallelCount: 1 },
  severity: values.severity ?? 'PASS',
  code: 'operating_power_balance.pass',
  message: 'resolved',
  demandBatteryPowerW: 0,
  acceptedChargingPowerW: values.surplusW,
  netBatteryPowerW:
    values.deficitW !== undefined
      ? -values.deficitW
      : values.surplusW !== undefined
        ? values.surplusW
        : undefined,
  chargingSurplusW: values.surplusW ?? (values.severity === 'CONDITIONAL' ? undefined : 0),
  dischargeDeficitW: values.deficitW ?? (values.severity === 'CONDITIONAL' ? undefined : 0),
  balanceState: values.deficitW !== undefined && values.deficitW > 0 ? 'discharging' : 'charging',
  unresolvedFacts: [],
  issues: values.issues ?? [],
  provenance: {
    demandSeverity: 'PASS',
    chargeAcceptanceSeverity: values.severity ?? 'PASS',
    selectedBankVoltageV: 24,
    sourceAvailableCapability: {
      powerW: values.surplusW ?? 0,
      totalResolved: values.surplusW !== undefined,
      sourceIds: ['source'],
    },
    demandBatteryPowerW: 0,
    acceptedChargingPowerW: values.surplusW,
  },
});

describe('operating power envelope', () => {
  it('finds the greatest resolved discharge deficit', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [
        balance('case-a', { deficitW: 100 }),
        balance('case-b', { deficitW: 600 }),
        balance('case-c', { deficitW: 250 }),
      ],
    });

    expect(result.dischargeDeficit).toMatchObject({
      valueW: 600,
      governingOperatingCaseIds: ['case-b'],
      status: 'resolved',
    });
  });

  it('finds the greatest resolved charging surplus', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [
        balance('case-a', { surplusW: 400 }),
        balance('case-b', { surplusW: 1200 }),
        balance('case-c', { surplusW: 0 }),
      ],
    });

    expect(result.chargingSurplus).toMatchObject({
      valueW: 1200,
      governingOperatingCaseIds: ['case-b'],
      status: 'resolved',
    });
  });

  it('does not sum alternative deficits or surpluses', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [
        balance('campground', { deficitW: 300, surplusW: 1000 }),
        balance('night', { deficitW: 400, surplusW: 500 }),
      ],
    });

    expect(result.dischargeDeficit.valueW).toBe(400);
    expect(result.chargingSurplus.valueW).toBe(1000);
  });

  it('retains all tied governing case IDs in deterministic order', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [
        balance('case-b', { deficitW: 600, surplusW: 800 }),
        balance('case-a', { deficitW: 600, surplusW: 800 }),
      ],
    });

    expect(result.dischargeDeficit.governingOperatingCaseIds).toEqual(['case-a', 'case-b']);
    expect(result.chargingSurplus.governingOperatingCaseIds).toEqual(['case-a', 'case-b']);
  });

  it('resolves all-zero directional envelopes', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [
        balance('balanced-a', { deficitW: 0, surplusW: 0 }),
        balance('balanced-b', { deficitW: 0, surplusW: 0 }),
      ],
    });

    expect(result.severity).toBe('PASS');
    expect(result.dischargeDeficit).toMatchObject({ valueW: 0, status: 'resolved' });
    expect(result.chargingSurplus).toMatchObject({ valueW: 0, status: 'resolved' });
    expect(result.dischargeDeficit.governingOperatingCaseIds).toEqual(['balanced-a', 'balanced-b']);
  });

  it('retains known maxima but marks each affected dimension unresolved', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [
        balance('known', { deficitW: 500, surplusW: 1000 }),
        balance('unknown', {
          severity: 'CONDITIONAL',
          issues: ['accepted charging power unresolved'],
        }),
      ],
    });

    expect(result.severity).toBe('CONDITIONAL');
    expect(result.dischargeDeficit).toMatchObject({
      valueW: 500,
      governingOperatingCaseIds: ['known'],
      status: 'unresolved',
      unresolvedOperatingCaseIds: ['unknown'],
    });
    expect(result.chargingSurplus).toMatchObject({
      valueW: 1000,
      governingOperatingCaseIds: ['known'],
      status: 'unresolved',
      unresolvedOperatingCaseIds: ['unknown'],
    });
  });

  it('fails overall for a failed case while preserving other known values', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [
        balance('valid', { deficitW: 300 }),
        balance('failed', { severity: 'FAIL', deficitW: 100 }),
      ],
    });

    expect(result.severity).toBe('FAIL');
    expect(result.failedOperatingCaseIds).toEqual(['failed']);
    expect(result.dischargeDeficit.valueW).toBe(300);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringContaining('failed')]));
  });

  it('preserves warning provenance when the warning case governs', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [
        balance('warning', {
          surplusW: 1000,
          severity: 'WARNING',
          issues: ['recommended charge target exceeded'],
        }),
        balance('pass', { surplusW: 500 }),
      ],
    });

    expect(result).toMatchObject({
      severity: 'WARNING',
      chargingSurplus: {
        valueW: 1000,
        governingOperatingCaseIds: ['warning'],
        status: 'resolved',
      },
    });
    expect(result.issues).toContain('warning: recommended charge target exceeded');
  });

  it('returns an unresolved empty envelope without fabricated zeros', () => {
    const result = evaluateOperatingPowerEnvelope({ cases: [] });

    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      evaluatedCaseCount: 0,
      dischargeDeficit: { status: 'unresolved' },
      chargingSurplus: { status: 'unresolved' },
    });
    expect(result.dischargeDeficit).not.toHaveProperty('valueW');
    expect(result.chargingSurplus).not.toHaveProperty('valueW');
  });

  it('rejects duplicate operating case IDs', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [balance('duplicate', { deficitW: 100 }), balance('duplicate', { deficitW: 200 })],
    });

    expect(result.severity).toBe('FAIL');
    expect(result.issues).toContain('Duplicate operating case ID: duplicate.');
  });

  it('orders provenance independently of input order and exposes upstream links', () => {
    const result = evaluateOperatingPowerEnvelope({
      envelopeId: 'system-envelope',
      cases: [
        balance('case-b', {
          deficitW: 200,
          demandScenarioId: 'b-loads',
          sourceScenarioId: 'b-source',
        }),
        balance('case-a', {
          deficitW: 300,
          demandScenarioId: 'a-loads',
          sourceScenarioId: 'a-source',
        }),
      ],
    });

    expect(result.envelopeId).toBe('system-envelope');
    expect(result.evaluatedOperatingCaseIds).toEqual(['case-a', 'case-b']);
    expect(result.caseProvenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operatingCaseId: 'case-a',
          demandScenarioId: 'a-loads',
          sourceScenarioId: 'a-source',
        }),
      ]),
    );
  });

  it('does not expose energy, duration, or current envelopes', () => {
    const result = evaluateOperatingPowerEnvelope({
      cases: [balance('case-a', { deficitW: 100 })],
    });

    expect(result).not.toHaveProperty('netEnergyWh');
    expect(result).not.toHaveProperty('runtimeHours');
    expect(result).not.toHaveProperty('currentEnvelope');
  });

  it('composes a full evaluated demand-to-envelope chain without pairing cases automatically', () => {
    const battery: BatteryEngineeringInput = {
      id: 'synthetic-battery',
      nominalVoltageV: 24,
      nominalCapacityAh: 100,
      allowedSeriesCount: { min: 1, max: 1 },
      allowedParallelCount: { min: 1, max: 1 },
      chargeCurrent: { recommendedA: 50 },
    };
    const demandScenario = evaluateLoadDemandScenario({
      scenarioId: 'driving-loads',
      batteryVoltageV: 24,
      loads: [{ id: 'loads', supplyType: 'dc', powerW: 100, runtimeHours: 1 }],
    });
    const drivingSources = evaluateChargingSourceScenario({
      scenarioId: 'driving-charging',
      batteryVoltageV: 24,
      sources: [
        {
          id: 'alternator',
          sourceType: 'alternator_dc_dc',
          active: true,
          availability: 'available',
          installedCurrentA: 30,
        },
      ],
    });
    const drivingAcceptance = evaluateBatteryChargeAcceptance({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: drivingSources,
    });
    const drivingBalance = evaluateOperatingPowerBalance({
      operatingCaseId: 'driving-daylight',
      demandScenario,
      chargeAcceptance: drivingAcceptance,
    });
    const nightDemand = evaluateLoadDemandScenario({
      scenarioId: 'night-loads',
      batteryVoltageV: 24,
      loads: [{ id: 'loads', supplyType: 'dc', powerW: 200, runtimeHours: 1 }],
    });
    const nightSources = evaluateChargingSourceScenario({
      scenarioId: 'night-charging',
      batteryVoltageV: 24,
      sources: [
        {
          id: 'alternator',
          sourceType: 'alternator_dc_dc',
          active: false,
          availability: 'available',
          installedCurrentA: 30,
        },
      ],
    });
    const nightAcceptance = evaluateBatteryChargeAcceptance({
      battery,
      selectedTopology: { seriesCount: 1, parallelCount: 1 },
      chargingScenario: nightSources,
    });
    const nightBalance = evaluateOperatingPowerBalance({
      operatingCaseId: 'parked-night',
      demandScenario: nightDemand,
      chargeAcceptance: nightAcceptance,
    });
    const result = evaluateOperatingPowerEnvelope({
      envelopeId: 'camper-envelope',
      cases: [nightBalance, drivingBalance],
    });

    expect(result).toMatchObject({
      severity: 'PASS',
      evaluatedCaseCount: 2,
      chargingSurplus: {
        valueW: 620,
        governingOperatingCaseIds: ['driving-daylight'],
      },
      dischargeDeficit: {
        valueW: 200,
        governingOperatingCaseIds: ['parked-night'],
      },
    });
  });

  it('keeps a conditional accepted-charge case from proving the envelope maximum', () => {
    const conditional = balance('epoch-80a', {
      severity: 'CONDITIONAL',
      issues: ['accepted charging power unresolved'],
    });
    const result = evaluateOperatingPowerEnvelope({
      cases: [balance('epoch-30a', { surplusW: 668 }), conditional],
    });

    expect(result).toMatchObject({
      severity: 'CONDITIONAL',
      chargingSurplus: {
        valueW: 668,
        status: 'unresolved',
        unresolvedOperatingCaseIds: ['epoch-80a'],
      },
    });
  });
});
