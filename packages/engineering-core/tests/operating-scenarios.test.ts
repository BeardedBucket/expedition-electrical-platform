import { describe, expect, it } from 'vitest';
import {
  evaluateOperatingScenarioSet,
  deriveBatteryRequirementsFromOperatingScenarios,
} from '../src/index.js';

describe('operating scenario composition', () => {
  describe('A. alternative-scenario continuous power', () => {
    it('computes maximum resolved continuous power across scenarios', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-a',
            designVoltageV: 24,
            loads: [{ id: 'load-a', supplyType: 'dc', powerW: 1000 }],
          },
          {
            scenarioId: 'scenario-b',
            designVoltageV: 24,
            loads: [{ id: 'load-b', supplyType: 'dc', powerW: 1500 }],
          },
        ],
      });

      expect(result.continuousPowerEnvelope.value).toBe(1500);
      expect(result.continuousPowerEnvelope.governingScenarioIds).toContain('scenario-b');
      expect(result.continuousPowerEnvelope.status).toBe('resolved');
    });
  });

  describe('B. governing scenario tracking', () => {
    it('records the governing scenario for continuous power', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'cooktop',
            designVoltageV: 24,
            loads: [{ id: 'cooktop-load', supplyType: 'dc', powerW: 1500 }],
          },
          {
            scenarioId: 'coffee',
            designVoltageV: 24,
            loads: [{ id: 'coffee-load', supplyType: 'dc', powerW: 800 }],
          },
        ],
      });

      expect(result.continuousPowerEnvelope.governingScenarioIds).toEqual(['cooktop']);
      expect(result.continuousPowerEnvelope.value).toBe(1500);
    });
  });

  describe('C. equal-value tie', () => {
    it('preserves deterministic governing scenario ids when multiple scenarios tie', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-x',
            designVoltageV: 24,
            loads: [{ id: 'load-x', supplyType: 'dc', powerW: 1500 }],
          },
          {
            scenarioId: 'scenario-y',
            designVoltageV: 24,
            loads: [{ id: 'load-y', supplyType: 'dc', powerW: 1500 }],
          },
        ],
      });

      expect(result.continuousPowerEnvelope.value).toBe(1500);
      expect(result.continuousPowerEnvelope.governingScenarioIds.sort()).toEqual([
        'scenario-x',
        'scenario-y',
      ]);
    });
  });

  describe('D. current envelope', () => {
    it('computes maximum resolved continuous current at compatible voltage basis', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-a',
            batteryVoltageV: 24,
            loads: [{ id: 'load-a', supplyType: 'dc', powerW: 2400 }],
          },
          {
            scenarioId: 'scenario-b',
            batteryVoltageV: 24,
            loads: [{ id: 'load-b', supplyType: 'dc', powerW: 1920 }],
          },
        ],
      });

      expect(result.continuousCurrentEnvelope.value).toBeCloseTo(100);
      expect(result.continuousCurrentEnvelope.governingScenarioIds).toContain('scenario-a');
      expect(result.continuousCurrentEnvelope.status).toBe('resolved');
    });
  });

  describe('E. incompatible voltage bases', () => {
    it('marks current envelope unresolved when scenarios use different voltage bases', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-12v',
            batteryVoltageV: 12,
            loads: [{ id: 'load-12v', supplyType: 'dc', powerW: 1200 }],
          },
          {
            scenarioId: 'scenario-24v',
            batteryVoltageV: 24,
            loads: [{ id: 'load-24v', supplyType: 'dc', powerW: 2400 }],
          },
        ],
      });

      expect(result.continuousCurrentEnvelope.status).toBe('unresolved');
      expect(result.continuousCurrentEnvelope.unresolvedScenarioIds).toContain('scenario-12v');
      expect(result.continuousCurrentEnvelope.unresolvedScenarioIds).toContain('scenario-24v');
      expect(result.continuousPowerEnvelope.value).toBe(2400);
      expect(result.continuousPowerEnvelope.status).toBe('resolved');
    });
  });

  describe('F. energy envelope', () => {
    it('computes maximum resolved energy as alternative scenario envelope, not sum', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-cooktop',
            designVoltageV: 24,
            loads: [{ id: 'cooktop', supplyType: 'dc', powerW: 500, runtimeHours: 1 }],
          },
          {
            scenarioId: 'scenario-coffee',
            designVoltageV: 24,
            loads: [{ id: 'coffee', supplyType: 'dc', powerW: 300, runtimeHours: 1 }],
          },
        ],
      });

      expect(result.energyEnvelope.value).toBe(500);
      expect(result.energyEnvelope.governingScenarioIds).toContain('scenario-cooktop');
      expect(result.energyEnvelope.status).toBe('resolved');
    });
  });

  describe('G. unresolved energy contributor', () => {
    it('reflects unresolved energy when any relevant scenario lacks energy resolution', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-unknown',
            designVoltageV: 24,
            loads: [{ id: 'load-a', supplyType: 'dc', powerW: 100 }],
          },
          {
            scenarioId: 'scenario-known',
            designVoltageV: 24,
            loads: [{ id: 'load-b', supplyType: 'dc', powerW: 300, runtimeHours: 1 }],
          },
        ],
      });

      expect(result.energyEnvelope.value).toBe(300);
      expect(result.energyEnvelope.status).toBe('unresolved');
      expect(result.energyEnvelope.unresolvedScenarioIds).toContain('scenario-unknown');
    });
  });

  describe('H. partial dimension resolution', () => {
    it('retains resolved continuous values even when energy is unresolved', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-partial',
            batteryVoltageV: 24,
            loads: [{ id: 'pump', supplyType: 'dc', powerW: 600 }],
          },
        ],
      });

      expect(result.continuousPowerEnvelope.value).toBe(600);
      expect(result.continuousPowerEnvelope.status).toBe('resolved');
      expect(result.continuousCurrentEnvelope.value).toBeCloseTo(25);
      expect(result.continuousCurrentEnvelope.status).toBe('resolved');
      expect(result.energyEnvelope.value).toBeUndefined();
      expect(result.energyEnvelope.status).toBe('unresolved');
    });
  });

  describe('I. no scenarios', () => {
    it('returns deterministic unresolved result when no scenarios are provided', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [],
      });

      expect(result.continuousPowerEnvelope.value).toBeUndefined();
      expect(result.continuousPowerEnvelope.status).toBe('unresolved');
      expect(result.continuousCurrentEnvelope.value).toBeUndefined();
      expect(result.continuousCurrentEnvelope.status).toBe('unresolved');
      expect(result.energyEnvelope.value).toBeUndefined();
      expect(result.energyEnvelope.status).toBe('unresolved');
    });
  });

  describe('J. surge dominance', () => {
    it('applies dominance rule: 200A/30s dominates 150A/10s', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-long',
            batteryVoltageV: 24,
            loads: [
              {
                id: 'surge-long',
                supplyType: 'dc',
                powerW: 5000,
                startupPowerW: 4800,
                startupDurationS: 30,
              },
            ],
          },
          {
            scenarioId: 'scenario-short',
            batteryVoltageV: 24,
            loads: [
              {
                id: 'surge-short',
                supplyType: 'dc',
                powerW: 3600,
                startupPowerW: 3600,
                startupDurationS: 10,
              },
            ],
          },
        ],
      });

      expect(result.surgeEnvelope.nonDominatedRequirements).toHaveLength(1);
      expect(result.surgeEnvelope.nonDominatedRequirements[0].currentA).toBeCloseTo(200);
      expect(result.surgeEnvelope.nonDominatedRequirements[0].durationS).toBe(30);
    });
  });

  describe('K. non-dominated surge pair', () => {
    it('preserves all non-dominated surge requirements', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-high-short',
            batteryVoltageV: 24,
            loads: [
              {
                id: 'surge-high-short',
                supplyType: 'dc',
                powerW: 4800,
                startupPowerW: 4800,
                startupDurationS: 1,
              },
            ],
          },
          {
            scenarioId: 'scenario-med-long',
            batteryVoltageV: 24,
            loads: [
              {
                id: 'surge-med-long',
                supplyType: 'dc',
                powerW: 3600,
                startupPowerW: 3600,
                startupDurationS: 30,
              },
            ],
          },
        ],
      });

      expect(result.surgeEnvelope.nonDominatedRequirements).toHaveLength(2);
      const sorted = result.surgeEnvelope.nonDominatedRequirements.sort(
        (a, b) => (b.currentA ?? 0) - (a.currentA ?? 0),
      );
      expect(sorted[0].currentA).toBeCloseTo(200);
      expect(sorted[0].durationS).toBe(1);
      expect(sorted[1].currentA).toBeCloseTo(150);
      expect(sorted[1].durationS).toBe(30);
    });
  });

  describe('L. unresolved surge scenario', () => {
    it('reflects unresolved status when one scenario has incomplete surge', () => {
      const result = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-complete',
            batteryVoltageV: 24,
            loads: [
              {
                id: 'surge-complete',
                supplyType: 'dc',
                powerW: 2400,
                startupPowerW: 2400,
                startupDurationS: 10,
              },
            ],
          },
          {
            scenarioId: 'scenario-incomplete',
            batteryVoltageV: 24,
            loads: [
              {
                id: 'surge-incomplete',
                supplyType: 'dc',
                powerW: 1200,
                startupPowerW: 1200,
              },
            ],
          },
        ],
      });

      expect(result.surgeEnvelope.status).toBe('unresolved');
      expect(result.surgeEnvelope.unresolvedScenarioIds).toContain('scenario-incomplete');
      expect(result.surgeEnvelope.nonDominatedRequirements).toHaveLength(1);
    });
  });

  describe('M. battery adapter', () => {
    it('adapts resolved system requirements to BatteryBankRequirements', () => {
      const scenarioSet = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-a',
            batteryVoltageV: 24,
            loads: [
              {
                id: 'load-a',
                supplyType: 'dc',
                powerW: 1200,
                runtimeHours: 2,
                startupPowerW: 2400,
                startupDurationS: 5,
              },
            ],
          },
        ],
      });

      const requirements = deriveBatteryRequirementsFromOperatingScenarios(scenarioSet);
      expect(requirements.nominalVoltageV).toBe(24);
      expect(requirements.continuousDischargeCurrentA).toBeCloseTo(50);
      expect(requirements.nominalEnergyWh).toBe(2400);
      expect(requirements.peakDischargeCurrentA).toBeCloseTo(100);
      expect(requirements.peakDischargeDurationS).toBe(5);
    });
  });

  describe('N. unresolved dimension adapter', () => {
    it('omits unresolved energy rather than emitting known lower bound', () => {
      const scenarioSet = evaluateOperatingScenarioSet({
        scenarios: [
          {
            scenarioId: 'scenario-no-runtime',
            batteryVoltageV: 24,
            loads: [{ id: 'load', supplyType: 'dc', powerW: 500 }],
          },
        ],
      });

      const requirements = deriveBatteryRequirementsFromOperatingScenarios(scenarioSet);
      expect(requirements.continuousDischargeCurrentA).toBeCloseTo(20.833333);
      expect(requirements.nominalEnergyWh).toBeUndefined();
    });
  });

  describe('realistic camper-style scenarios', () => {
    it('does not sum cooktop and coffee maker from alternative scenarios', () => {
      const result = evaluateOperatingScenarioSet({
        setId: 'camper-alternative-loads',
        scenarios: [
          {
            scenarioId: 'cooktop-scenario',
            designVoltageV: 24,
            loads: [
              { id: 'fridge', supplyType: 'dc', powerW: 60, runtimeHours: 1 },
              { id: 'lights', supplyType: 'dc', powerW: 80, runtimeHours: 1 },
              {
                id: 'cooktop',
                supplyType: 'ac',
                powerW: 3000,
                inverterEfficiency: 0.9,
                runtimeHours: 0.5,
              },
            ],
          },
          {
            scenarioId: 'coffee-scenario',
            designVoltageV: 24,
            loads: [
              { id: 'fridge', supplyType: 'dc', powerW: 60, runtimeHours: 1 },
              { id: 'lights', supplyType: 'dc', powerW: 80, runtimeHours: 1 },
              {
                id: 'coffee-maker',
                supplyType: 'ac',
                powerW: 1200,
                inverterEfficiency: 0.9,
                runtimeHours: 0.25,
              },
            ],
          },
        ],
      });

      expect(result.continuousPowerEnvelope.value).toBeCloseTo(3473.33, 1);
      expect(result.continuousPowerEnvelope.governingScenarioIds).toContain('cooktop-scenario');
      expect(result.severity).toBe('PASS');
    });
  });

  describe('canonical Epoch end-to-end integration', () => {
    it('chains load definitions through scenario composition to battery bank feasibility', async () => {
      const scenarioSet = evaluateOperatingScenarioSet({
        setId: 'epoch-demo',
        scenarios: [
          {
            scenarioId: 'high-power-scenario',
            batteryVoltageV: 24,
            loads: [
              { id: 'fridge', supplyType: 'dc', powerW: 60, runtimeHours: 1 },
              { id: 'lights', supplyType: 'dc', powerW: 100, runtimeHours: 2 },
              {
                id: 'inverter-load',
                supplyType: 'ac',
                powerW: 2000,
                inverterEfficiency: 0.9,
                runtimeHours: 1,
              },
            ],
          },
          {
            scenarioId: 'extended-runtime-scenario',
            batteryVoltageV: 24,
            loads: [
              { id: 'fridge', supplyType: 'dc', powerW: 60, runtimeHours: 24 },
              { id: 'lights', supplyType: 'dc', powerW: 100, runtimeHours: 6 },
            ],
          },
        ],
      });

      expect(scenarioSet.continuousPowerEnvelope.status).toBe('resolved');
      expect(scenarioSet.energyEnvelope.status).toBe('resolved');

      const requirements = deriveBatteryRequirementsFromOperatingScenarios(scenarioSet);
      expect(requirements).toBeDefined();
      expect(requirements.continuousDischargeCurrentA).toBeDefined();
      expect(requirements.nominalEnergyWh).toBeDefined();
      expect(requirements.nominalVoltageV).toBe(24);
    });
  });
});
