import { describe, expect, it } from 'vitest';
import {
  evaluateMixedVoltageDomains,
  type MixedVoltageDomainInput,
  type MixedVoltageEvaluationInput,
  type SupplyPathInput,
} from '../src/mixed-voltage-domains.js';

const domain = (
  id: string,
  nominalVoltageV: number,
  storage: MixedVoltageDomainInput['storage'] = 'absent',
): MixedVoltageDomainInput => ({ id, nominalVoltageV, storage });

const path = (
  id: string,
  sourceDomainId: string,
  targetDomainId: string,
  values: Partial<SupplyPathInput> = {},
): SupplyPathInput => ({ id, sourceDomainId, targetDomainId, ...values });

const evaluate = (
  domains: readonly MixedVoltageDomainInput[],
  paths: readonly SupplyPathInput[] = [],
  requirements: MixedVoltageEvaluationInput['requirements'] = [],
  extra: Partial<MixedVoltageEvaluationInput> = {},
) => evaluateMixedVoltageDomains({ domains, paths, requirements, ...extra });

describe('mixed-voltage domain compatibility', () => {
  it('passes a native-voltage direct domain path', () => {
    const result = evaluate(
      [domain('a', 12, 'present'), domain('b', 12)],
      [path('direct', 'a', 'b', { continuousPowerW: 100 })],
      [{ id: 'load', sourceDomainId: 'a', targetDomainId: 'b', continuousPowerW: 100 }],
    );
    expect(result.severity).toBe('PASS');
  });

  it('passes an explicit mixed-voltage path without warning', () => {
    const result = evaluate(
      [domain('source', 24, 'present'), domain('load', 12)],
      [path('converter', 'source', 'load', { continuousPowerW: 100 })],
      [{ id: 'load', sourceDomainId: 'source', targetDomainId: 'load', continuousPowerW: 100 }],
    );
    expect(result.severity).toBe('PASS');
    expect(result.observations[0]?.conversionRequired).toBe(true);
  });

  it('does not default a voltage or merge same-voltage opaque IDs', () => {
    const result = evaluate(
      [domain('opaque-one', 12), domain('opaque-two', 12)],
      [],
      [{ id: 'required', sourceDomainId: 'opaque-one', targetDomainId: 'opaque-two' }],
    );
    expect(result.severity).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('missing_required_supply_path');
  });

  it('keeps same-voltage disconnected domains disconnected', () => {
    const result = evaluate([domain('chassis', 12), domain('house', 12)]);
    expect(result.severity).toBe('PASS');
    expect(result.pathEvaluations).toHaveLength(0);
  });

  it('fails a prohibited chassis-like relationship without name magic', () => {
    const result = evaluate(
      [domain('source', 12), domain('load', 12)],
      [path('blocked', 'source', 'load', { permission: 'prohibited' })],
      [{ id: 'load', sourceDomainId: 'source', targetDomainId: 'load', relationship: 'required' }],
    );
    expect(result.severity).toBe('FAIL');
    expect(result.issues[0]?.code).toBe('prohibited_supply_relationship');
  });

  it('does not infer reverse flow', () => {
    const result = evaluate(
      [domain('high', 24), domain('low', 12)],
      [path('one-way', 'high', 'low', { continuousPowerW: 100 })],
      [{ id: 'reverse', sourceDomainId: 'low', targetDomainId: 'high' }],
    );
    expect(result.severity).toBe('FAIL');
  });

  it('treats an explicitly unresolved path as conditional, not zero', () => {
    const result = evaluate(
      [domain('source', 24), domain('load', 12)],
      [path('unknown', 'source', 'load', { capabilityStatus: 'unresolved' })],
      [{ id: 'load', sourceDomainId: 'source', targetDomainId: 'load', continuousPowerW: 1 }],
    );
    expect(result.severity).toBe('CONDITIONAL');
    expect(result.issues[0]?.code).toBe('required_supply_path_unresolved');
  });

  it('distinguishes explicit zero capability from unknown capability', () => {
    const zero = evaluate(
      [domain('source', 24), domain('load', 12)],
      [path('zero', 'source', 'load', { continuousPowerW: 0 })],
      [{ id: 'load', sourceDomainId: 'source', targetDomainId: 'load', continuousPowerW: 1 }],
    );
    const unknown = evaluate(
      [domain('source', 24), domain('load', 12)],
      [path('unknown', 'source', 'load')],
      [{ id: 'load', sourceDomainId: 'source', targetDomainId: 'load', continuousPowerW: 1 }],
    );
    expect(zero.severity).toBe('FAIL');
    expect(unknown.severity).toBe('CONDITIONAL');
  });

  it.each([
    [100, 100, 'PASS'],
    [99, 100, 'FAIL'],
    [101, 100, 'PASS'],
  ])(
    'evaluates continuous capability at %s W for a %s W requirement',
    (capacity, required, severity) => {
      const result = evaluate(
        [domain('source', 24), domain('load', 12)],
        [path('converter', 'source', 'load', { continuousPowerW: capacity })],
        [
          {
            id: 'load',
            sourceDomainId: 'source',
            targetDomainId: 'load',
            continuousPowerW: required,
          },
        ],
      );
      expect(result.severity).toBe(severity);
    },
  );

  it('evaluates surge independently and preserves duration', () => {
    const exact = evaluate(
      [domain('source', 24), domain('load', 12)],
      [
        path('converter', 'source', 'load', {
          continuousPowerW: 100,
          surgePowerW: 200,
          surgeDurationS: 5,
        }),
      ],
      [
        {
          id: 'load',
          sourceDomainId: 'source',
          targetDomainId: 'load',
          continuousPowerW: 100,
          surgePowerW: 200,
          surgeDurationS: 5,
        },
      ],
    );
    const inadequate = evaluate(
      [domain('source', 24), domain('load', 12)],
      [
        path('converter', 'source', 'load', {
          continuousPowerW: 100,
          surgePowerW: 199,
          surgeDurationS: 5,
        }),
      ],
      [
        {
          id: 'load',
          sourceDomainId: 'source',
          targetDomainId: 'load',
          continuousPowerW: 100,
          surgePowerW: 200,
          surgeDurationS: 5,
        },
      ],
    );
    expect(exact.severity).toBe('PASS');
    expect(
      inadequate.issues.some((issue) => issue.code === 'surge_path_capacity_insufficient'),
    ).toBe(true);
  });

  it('makes omitted surge capability conditional when surge is required', () => {
    const result = evaluate(
      [domain('source', 24), domain('load', 12)],
      [path('converter', 'source', 'load', { continuousPowerW: 100 })],
      [
        {
          id: 'load',
          sourceDomainId: 'source',
          targetDomainId: 'load',
          continuousPowerW: 100,
          surgePowerW: 200,
        },
      ],
    );
    expect(result.severity).toBe('CONDITIONAL');
  });

  it('represents local storage presence and absence without battery topology', () => {
    const result = evaluate(
      [
        domain('source', 24, 'present'),
        domain('bus', 12, 'absent'),
        domain('buffer', 12, 'present'),
      ],
      [
        path('bus-feed', 'source', 'bus', { continuousPowerW: 100 }),
        path('charger', 'source', 'buffer', { continuousPowerW: 100 }),
      ],
    );
    expect(result.domains.find((item) => item.domainId === 'bus')?.storage).toBe('absent');
    expect(result.domains.find((item) => item.domainId === 'buffer')?.storage).toBe('present');
    expect(JSON.stringify(result)).not.toContain('0S0P');
  });

  it('covers RV, van-isolation, native, and mixed regressions neutrally', () => {
    const native = evaluate(
      [domain('native', 12, 'present'), domain('native-loads', 12)],
      [path('native-feed', 'native', 'native-loads', { continuousPowerW: 100 })],
      [
        {
          id: 'native-load',
          sourceDomainId: 'native',
          targetDomainId: 'native-loads',
          continuousPowerW: 100,
        },
      ],
    );
    const mixed = evaluate(
      [domain('house-24v', 24, 'present'), domain('house-12v', 12)],
      [path('house-converter', 'house-24v', 'house-12v', { continuousPowerW: 100 })],
      [
        {
          id: 'house-load',
          sourceDomainId: 'house-24v',
          targetDomainId: 'house-12v',
          continuousPowerW: 100,
        },
      ],
    );
    expect(native.severity).toBe('PASS');
    expect(mixed.severity).toBe('PASS');
    expect(native.recommendation).toBeUndefined();
    expect(mixed.recommendation).toBeUndefined();
  });

  it('checks required isolation and reports unsatisfied isolation', () => {
    const satisfied = evaluate(
      [domain('source', 24), domain('load', 12)],
      [path('isolated', 'source', 'load', { continuousPowerW: 10, isolated: true })],
      [
        {
          id: 'isolated-load',
          sourceDomainId: 'source',
          targetDomainId: 'load',
          requiresIsolation: true,
        },
      ],
    );
    const unsatisfied = evaluate(
      [domain('source', 24), domain('load', 12)],
      [path('non-isolated', 'source', 'load', { continuousPowerW: 10, isolated: false })],
      [
        {
          id: 'isolated-load',
          sourceDomainId: 'source',
          targetDomainId: 'load',
          requiresIsolation: true,
        },
      ],
    );
    expect(satisfied.severity).toBe('PASS');
    expect(unsatisfied.issues[0]?.code).toBe('required_isolation_unsatisfied');
  });

  it('does not rank or select multiple possible paths', () => {
    const result = evaluate(
      [domain('source', 24), domain('load', 12)],
      [
        path('a', 'source', 'load', { continuousPowerW: 100 }),
        path('b', 'source', 'load', { continuousPowerW: 200 }),
      ],
      [{ id: 'load', sourceDomainId: 'source', targetDomainId: 'load', continuousPowerW: 50 }],
    );
    expect(result.pathEvaluations.map((item) => item.pathId)).toEqual(['a', 'b']);
    expect(result.selectedPathIds).toEqual([]);
    expect(result.severity).toBe('CONDITIONAL');
  });

  it('validates voltages and path numeric inputs', () => {
    expect(evaluate([domain('invalid', 0)]).severity).toBe('FAIL');
    expect(
      evaluate(
        [domain('source', 24), domain('load', 12)],
        [path('invalid', 'source', 'load', { continuousPowerW: -1 })],
      ).severity,
    ).toBe('FAIL');
  });

  it('supports generic stationary-compatible domain IDs', () => {
    const result = evaluate(
      [domain('microgrid-dc', 48, 'present'), domain('building-dc', 24)],
      [path('building-feed', 'microgrid-dc', 'building-dc', { continuousPowerW: 1000 })],
      [
        {
          id: 'building-load',
          sourceDomainId: 'microgrid-dc',
          targetDomainId: 'building-dc',
          continuousPowerW: 1000,
        },
      ],
    );
    expect(result.severity).toBe('PASS');
  });

  it('keeps a selected architecture failure local', () => {
    const result = evaluate(
      [domain('source-a', 24), domain('source-b', 48), domain('load', 12)],
      [path('bad-choice', 'source-a', 'load', { continuousPowerW: 1 })],
      [{ id: 'load', sourceDomainId: 'source-a', targetDomainId: 'load', continuousPowerW: 2 }],
    );
    expect(result.severity).toBe('FAIL');
    expect(result.issues[0]?.message).not.toContain('no valid architecture');
  });
});
