import { describe, expect, it } from 'vitest';
import {
  evaluateBuilderCatalogMode,
  evaluateBuilderAttribution,
  evaluateGenericBuilderMode,
  type BuilderProfile,
} from '@expedition/engineering-core';
import { createDefaultFormState, evaluateConfiguration } from './configurator-model.js';

describe('configurator model', () => {
  it('preserves explicit advisory evaluation timestamps from the app boundary', () => {
    const form = {
      ...createDefaultFormState(),
      selectedVoltage: 24 as const,
      builderMode: 'generic' as const,
      loads: [
        {
          id: 'load-a',
          name: 'Lights',
          quantity: '2',
          powerW: '150',
          operatingVoltage: '',
          basis: 'direct-source' as const,
          conversionEfficiency: '',
        },
      ],
    };

    const result = evaluateConfiguration(form);

    expect(result).not.toBeNull();
    expect(result?.evaluatedAt).toMatch(/T.*Z$/);
  });

  it('allows app code to inject a deterministic evaluation clock', () => {
    const fixedTime = new Date('2026-09-02T03:04:05Z');
    const result = evaluateConfiguration(
      {
        ...createDefaultFormState(),
        selectedVoltage: 24 as const,
        builderMode: 'generic',
        loads: [
          {
            id: 'load-a',
            name: 'Lights',
            quantity: '2',
            powerW: '150',
            operatingVoltage: '',
            basis: 'direct-source' as const,
            conversionEfficiency: '',
          },
        ],
      },
      () => fixedTime,
    );

    expect(result?.evaluatedAt).toBe('2026-09-02T03:04:05.000Z');
  });

  it('distinguishes incompatible candidates from unknown candidates', () => {
    const result = evaluateConfiguration({
      ...createDefaultFormState(),
      selectedVoltage: 48 as const,
      builderMode: 'generic',
      loads: [
        {
          id: 'load-a',
          name: 'Array',
          quantity: '1',
          powerW: '200',
          operatingVoltage: '',
          basis: 'direct-source',
          conversionEfficiency: '',
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(
      result?.globalCandidates.some((candidate) => candidate.engineeringStatus === 'incompatible'),
    ).toBe(true);
    expect(
      result?.globalCandidates.some((candidate) => candidate.engineeringStatus === 'unknown'),
    ).toBe(true);
  });

  it('marks inventory gaps separately from engineering incompatibility', () => {
    const outcome = evaluateBuilderCatalogMode(
      {
        builderId: 'builder.gap-test',
        displayName: 'Gap Test Builder',
        inventoryMode: 'allowlist',
        catalog: [],
      },
      [
        {
          id: 'component.eligible.standard',
          eligible: true,
          engineeringEligible: true,
          safetyEligible: true,
          advisoryEligible: true,
          recommendationEligible: true,
          status: 'eligible',
        },
      ],
      { kind: 'resolved', builderId: 'builder.gap-test' },
    );

    expect(outcome.status).toBe('inventory_gap');
    expect(outcome.candidates[0]?.status).toBe('ineligible');
  });

  it('keeps builder inventory from re-enabling globally ineligible candidates', () => {
    const builderProfile: BuilderProfile = {
      builderId: 'builder.restock',
      displayName: 'Restock Builder',
      inventoryMode: 'allowlist',
      catalog: [
        {
          component_id: 'component.eligible.excluded',
          availability: 'stocked',
          preference: 'preferred',
        },
      ],
    };

    const result = evaluateBuilderCatalogMode(
      builderProfile,
      [
        {
          id: 'component.eligible.excluded',
          eligible: false,
          engineeringEligible: true,
          safetyEligible: false,
          advisoryEligible: false,
          recommendationEligible: false,
          status: 'ineligible',
        },
      ],
      { kind: 'resolved', builderId: builderProfile.builderId },
    );

    expect(result.status).toBe('ineligible');
    expect(
      result.rankedCandidates.some(
        (candidate) => candidate.componentId === 'component.eligible.excluded',
      ),
    ).toBe(false);
  });

  it('keeps advisory caution candidates recommendation eligible but visibly cautioned', () => {
    const result = evaluateConfiguration({
      ...createDefaultFormState(),
      selectedVoltage: 24 as const,
      builderMode: 'generic',
      loads: [
        {
          id: 'load-a',
          name: 'Lights',
          quantity: '2',
          powerW: '150',
          operatingVoltage: '',
          basis: 'direct-source',
          conversionEfficiency: '',
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(
      result?.groups
        .find((group) => group.id === 'cautioned')
        ?.items.some((item) => item.id === 'component.eligible.caution'),
    ).toBe(true);
    expect(
      result?.groups
        .find((group) => group.id === 'recommended')
        ?.items.some((item) => item.id === 'component.eligible.caution'),
    ).toBe(false);
    expect(
      result?.globalCandidates.find((candidate) => candidate.id === 'component.eligible.caution')
        ?.advisoryAction,
    ).toBe('caution');
  });

  it('keeps suppressed candidates in the inspectable group without rewriting compatibility', () => {
    const result = evaluateConfiguration({
      ...createDefaultFormState(),
      selectedVoltage: 24 as const,
      builderMode: 'generic',
      loads: [
        {
          id: 'load-a',
          name: 'Lights',
          quantity: '2',
          powerW: '150',
          operatingVoltage: '',
          basis: 'direct-source',
          conversionEfficiency: '',
        },
      ],
    });

    const suppressed = result?.groups.find((group) => group.id === 'suppressed');
    const recommended = result?.groups.find((group) => group.id === 'recommended');
    const candidate = result?.globalCandidates.find(
      (item) => item.id === 'component.eligible.suppressed',
    );

    expect(suppressed?.items.some((item) => item.id === 'component.eligible.suppressed')).toBe(
      true,
    );
    expect(recommended?.items.some((item) => item.id === 'component.eligible.suppressed')).toBe(
      false,
    );
    expect(candidate?.engineeringStatus).toBe('compatible');
    expect(candidate?.advisoryAction).toBe('suppress_recommendation');
  });

  it('keeps excluded candidates advisory-excluded and distinct from suppression or incompatibility', () => {
    const result = evaluateConfiguration({
      ...createDefaultFormState(),
      selectedVoltage: 24 as const,
      builderMode: 'generic',
      loads: [
        {
          id: 'load-a',
          name: 'Lights',
          quantity: '2',
          powerW: '150',
          operatingVoltage: '',
          basis: 'direct-source',
          conversionEfficiency: '',
        },
      ],
    });

    const candidate = result?.globalCandidates.find(
      (item) => item.id === 'component.eligible.excluded',
    );
    const excluded = result?.groups.find((group) => group.id === 'excluded');
    const suppressed = result?.groups.find((group) => group.id === 'suppressed');
    const recommended = result?.groups.find((group) => group.id === 'recommended');

    expect(candidate?.advisoryAction).toBe('exclude');
    expect(candidate?.recommendationEligible).toBe(false);
    expect(candidate?.engineeringStatus).toBe('compatible');
    expect(excluded?.items.some((item) => item.id === 'component.eligible.excluded')).toBe(true);
    expect(suppressed?.items.some((item) => item.id === 'component.eligible.excluded')).toBe(false);
    expect(recommended?.items.some((item) => item.id === 'component.eligible.excluded')).toBe(
      false,
    );
  });

  it('does not silently downgrade unknown builder IDs to generic mode', () => {
    const result = evaluateBuilderAttribution({ kind: 'unresolved', builderId: 'missing-builder' });
    expect(result.status).toBe('unresolved');
    expect(result.destination).toBe('unresolved/builder-id');
  });

  it('generic mode keeps globally eligible candidates visible', () => {
    const result = evaluateGenericBuilderMode([
      {
        id: 'component.eligible.standard',
        eligible: true,
        engineeringEligible: true,
        safetyEligible: true,
        advisoryEligible: true,
        recommendationEligible: true,
        status: 'eligible',
      },
      {
        id: 'component.incompatible',
        eligible: false,
        engineeringEligible: false,
        safetyEligible: true,
        advisoryEligible: true,
        recommendationEligible: false,
        status: 'ineligible',
      },
    ]);

    expect(result.status).toBe('generic');
    expect(result.candidates.map((candidate) => candidate.componentId)).toEqual([
      'component.eligible.standard',
    ]);
  });

  it('integrates builder mode through evaluateConfiguration without mutating global engineering status', () => {
    const resultNorthwind = evaluateConfiguration({
      ...createDefaultFormState(),
      selectedVoltage: 24 as const,
      builderMode: 'builder',
      selectedBuilderId: 'builder.northwind',
      loads: [
        {
          id: 'load-a',
          name: 'Lights',
          quantity: '2',
          powerW: '150',
          operatingVoltage: '',
          basis: 'direct-source',
          conversionEfficiency: '',
        },
      ],
    });

    expect(resultNorthwind).not.toBeNull();
    const recommendedGroup = resultNorthwind?.groups.find((g) => g.id === 'recommended');
    const inventoryGapGroup = resultNorthwind?.groups.find((g) => g.id === 'inventory-gap');

    // 1. builder-supported recommendation
    expect(recommendedGroup?.items.some((item) => item.id === 'component.eligible.standard')).toBe(
      true,
    );

    // 2. builder-unsupported candidate absent from normal builder recommendations
    expect(recommendedGroup?.items.some((item) => item.id === 'component.builder.gap')).toBe(false);

    // 3. inventory gap item present in inventory-gap group
    expect(inventoryGapGroup?.items.some((item) => item.id === 'component.builder.gap')).toBe(true);

    // 4. builder filtering does not mutate global engineeringStatus
    const gapCandidate = resultNorthwind?.globalCandidates.find(
      (c) => c.id === 'component.builder.gap',
    );
    expect(gapCandidate?.engineeringStatus).toBe('compatible');
    expect(gapCandidate?.recommendationEligible).toBe(true);

    // 5. inventory_gap status through evaluateConfiguration path for empty catalog builder
    const resultGapBuilder = evaluateConfiguration({
      ...createDefaultFormState(),
      selectedVoltage: 24 as const,
      builderMode: 'builder',
      selectedBuilderId: 'builder.gap',
      loads: [
        {
          id: 'load-a',
          name: 'Lights',
          quantity: '2',
          powerW: '150',
          operatingVoltage: '',
          basis: 'direct-source',
          conversionEfficiency: '',
        },
      ],
    });

    expect(resultGapBuilder?.builderOutcome?.status).toBe('inventory_gap');
  });
});
