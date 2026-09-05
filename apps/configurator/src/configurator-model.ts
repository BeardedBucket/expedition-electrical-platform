import {
  evaluateAdvisoryRecommendationBoundary,
  evaluateBuilderCatalogMode,
  evaluateGenericBuilderMode,
  orchestrateRecommendations,
  type AdvisoryPolicyAction,
  type BuilderCatalogCandidate,
  type BuilderOverlayOutcome,
  type BuilderProfile,
  type DemoData,
  type RecommendationResult,
} from '@expedition/engineering-core';

export const voltageOptions = [12, 24, 48] as const;
export type VoltageOption = (typeof voltageOptions)[number];
export type BuilderMode = 'generic' | 'builder';

export interface LoadItem {
  readonly id: string;
  readonly name: string;
  readonly quantity: string;
  readonly powerW: string;
  readonly operatingVoltage: string;
  readonly basis: 'direct-source' | 'converted-load';
  readonly conversionEfficiency: string;
}

export interface ElectricalConstraints {
  readonly oneWayLengthM: string;
  readonly roundTrip: boolean;
  readonly maxVoltageDropPercent: string;
  readonly installationProfile: string;
}

export interface InstallationConstraints {
  readonly maxDimensionsMm: string;
  readonly maxWeightKg: string;
  readonly requiredInterfaces: string;
  readonly requiredAccessories: string;
}

export interface ConfigFormState {
  readonly selectedVoltage: VoltageOption | '';
  readonly systemLabel: string;
  readonly notes: string;
  readonly loads: readonly LoadItem[];
  readonly builderMode: BuilderMode;
  readonly selectedBuilderId: string;
  readonly electricalConstraints: ElectricalConstraints;
  readonly installationConstraints: InstallationConstraints;
}

export interface CandidatePresentation {
  readonly id: string;
  readonly label: string;
  readonly engineeringStatus: 'compatible' | 'incompatible' | 'unknown';
  readonly advisoryAction: AdvisoryPolicyAction;
  readonly advisorySeverity: string;
  readonly advisoryConfidence: string;
  readonly recommendationEligible: boolean;
  readonly builderRecommendationEligible?: boolean;
  readonly reasons: readonly string[];
  readonly why: string;
  readonly builderState?: string;
  readonly builderAvailability?: string;
  readonly builderPreference?: string;
  readonly unresolvedRequirements?: readonly string[];
  readonly trace?: readonly {
    readonly advisory_id: string;
    readonly evidence_ids: readonly string[];
  }[];
}

export interface ResultGroup {
  readonly id: string;
  readonly title: string;
  readonly items: readonly CandidatePresentation[];
}

export interface EvaluationSummary {
  readonly recommendationResult: RecommendationResult;
  readonly globalCandidates: readonly CandidatePresentation[];
  readonly groups: readonly ResultGroup[];
  readonly builderOutcome: BuilderOverlayOutcome | null;
  readonly evaluatedAt: string;
}

const makeLoad = (overrides: Partial<LoadItem> = {}): LoadItem => ({
  id: overrides.id ?? `load-${Math.random().toString(36).slice(2, 9)}`,
  name: overrides.name ?? 'New load',
  quantity: overrides.quantity ?? '1',
  powerW: overrides.powerW ?? '100',
  operatingVoltage: overrides.operatingVoltage ?? '',
  basis: overrides.basis ?? 'direct-source',
  conversionEfficiency: overrides.conversionEfficiency ?? '',
});

export const createDefaultFormState = (): ConfigFormState => ({
  selectedVoltage: '',
  systemLabel: '',
  notes: '',
  loads: [makeLoad({ id: 'load-1', name: 'Lights', quantity: '1', powerW: '120' })],
  builderMode: 'generic',
  selectedBuilderId: '',
  electricalConstraints: {
    oneWayLengthM: '',
    roundTrip: false,
    maxVoltageDropPercent: '',
    installationProfile: 'mixed',
  },
  installationConstraints: {
    maxDimensionsMm: '',
    maxWeightKg: '',
    requiredInterfaces: '',
    requiredAccessories: '',
  },
});

const syntheticComponentRecords = [
  {
    id: 'component.eligible.standard',
    verificationStatus: 'verified',
    engineeringStatus: 'compatible',
  },
  {
    id: 'component.eligible.caution',
    verificationStatus: 'verified',
    engineeringStatus: 'compatible',
  },
  {
    id: 'component.eligible.suppressed',
    verificationStatus: 'verified',
    engineeringStatus: 'compatible',
  },
  {
    id: 'component.eligible.excluded',
    verificationStatus: 'verified',
    engineeringStatus: 'compatible',
  },
  {
    id: 'component.incompatible',
    verificationStatus: 'verified',
    engineeringStatus: 'incompatible',
  },
  { id: 'component.unknown.fit', verificationStatus: 'unverified', engineeringStatus: 'unknown' },
  {
    id: 'component.builder.gap',
    verificationStatus: 'verified',
    engineeringStatus: 'compatible',
  },
] as const;

const syntheticAdvisories = [
  {
    id: 'advisory.caution',
    affected_component_ids: ['component.eligible.caution'],
    status: 'active',
    severity: 'moderate',
    confidence: 'medium',
    evidence_ids: ['evidence.caution'],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    summary: 'Cooling fan service note.',
    rationale: 'Synthetic cooling-note caution; remains recommendation eligible with a warning.',
    policy_action: 'caution',
  },
  {
    id: 'advisory.suppressed',
    affected_component_ids: ['component.eligible.suppressed'],
    status: 'active',
    severity: 'high',
    confidence: 'high',
    evidence_ids: ['evidence.suppressed'],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-03T00:00:00Z',
    summary: 'Field recall advisory.',
    rationale: 'Synthetic suppression example kept inspectable but not recommended.',
    policy_action: 'suppress_recommendation',
  },
  {
    id: 'advisory.excluded',
    affected_component_ids: ['component.eligible.excluded'],
    status: 'active',
    severity: 'critical',
    confidence: 'confirmed',
    evidence_ids: ['evidence.excluded'],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-04T00:00:00Z',
    summary: 'Safety exclusion advisory.',
    rationale: 'Synthetic exclusion example should never be recommended.',
    policy_action: 'exclude',
  },
] as const;

const syntheticEvidence = [
  {
    id: 'evidence.caution',
    affected_component_ids: ['component.eligible.caution'],
    type: 'service_bulletin',
    sources: [{ id: 'source.caution', type: 'synthetic', date_checked: '2026-09-02' }],
    date_checked: '2026-09-02',
    summary: 'Synthetic service bulletin for a nonblocking caution.',
    verification_status: 'verified',
    status: 'active',
  },
  {
    id: 'evidence.suppressed',
    affected_component_ids: ['component.eligible.suppressed'],
    type: 'recall',
    sources: [{ id: 'source.suppressed', type: 'synthetic', date_checked: '2026-09-03' }],
    date_checked: '2026-09-03',
    summary: 'Synthetic recall with recommendation suppression policy.',
    verification_status: 'verified',
    status: 'active',
  },
  {
    id: 'evidence.excluded',
    affected_component_ids: ['component.eligible.excluded'],
    type: 'recall',
    sources: [{ id: 'source.excluded', type: 'synthetic', date_checked: '2026-09-04' }],
    date_checked: '2026-09-04',
    summary: 'Synthetic exclusion evidence.',
    verification_status: 'verified',
    status: 'active',
  },
] as const;

const syntheticBuilders: readonly BuilderProfile[] = [
  {
    builderId: 'builder.northwind',
    displayName: 'Northwind Builds',
    inventoryMode: 'allowlist',
    catalog: [
      {
        component_id: 'component.eligible.standard',
        availability: 'stocked',
        preference: 'preferred',
      },
      {
        component_id: 'component.eligible.caution',
        availability: 'stocked',
        preference: 'standard',
      },
      {
        component_id: 'component.eligible.suppressed',
        availability: 'stocked',
        preference: 'standard',
      },
      {
        component_id: 'component.eligible.excluded',
        availability: 'unavailable',
        preference: 'standard',
      },
      {
        component_id: 'component.incompatible',
        availability: 'unavailable',
        preference: 'standard',
      },
      { component_id: 'component.unknown.fit', availability: 'unknown', preference: 'standard' },
    ],
  },
  {
    builderId: 'builder.coastal',
    displayName: 'Coastal Campers',
    inventoryMode: 'allowlist',
    catalog: [
      {
        component_id: 'component.eligible.standard',
        availability: 'special_order',
        preference: 'preferred',
      },
      {
        component_id: 'component.eligible.caution',
        availability: 'special_order',
        preference: 'preferred',
      },
      {
        component_id: 'component.eligible.suppressed',
        availability: 'stocked',
        preference: 'standard',
      },
      {
        component_id: 'component.eligible.excluded',
        availability: 'unavailable',
        preference: 'standard',
      },
      {
        component_id: 'component.incompatible',
        availability: 'unavailable',
        preference: 'standard',
      },
      { component_id: 'component.unknown.fit', availability: 'unknown', preference: 'standard' },
    ],
  },
  {
    builderId: 'builder.gap',
    displayName: 'Gap Builder',
    inventoryMode: 'allowlist',
    catalog: [],
  },
] as const;

export const createSyntheticDemoData = (): DemoData => ({
  versions: {
    components: { id: 'components.synthetic', version: '0.1.0', status: 'synthetic' },
    builders: { id: 'builders.synthetic', version: '0.1.0', status: 'synthetic' },
    advisories: { id: 'advisories.synthetic', version: '0.1.0', status: 'synthetic' },
    ruleSet: { id: 'rules.synthetic', version: '0.1.0', status: 'synthetic' },
  },
  components: syntheticComponentRecords.map((component) => component),
  builders: syntheticBuilders.map((profile) => ({ ...profile })),
  advisories: syntheticAdvisories.map((advisory) => ({ ...advisory })),
  evidence: syntheticEvidence.map((record) => ({ ...record })),
  ruleSet: {
    id: 'rules.synthetic',
    version: '0.1.0',
    status: 'synthetic',
    description: 'Synthetic demo rule metadata used to exercise the configurator workflow.',
  },
});

const toLoadRequirementList = (loads: readonly LoadItem[]) =>
  loads.map((load) => ({
    id: load.id,
    name: load.name,
    quantity: Number(load.quantity),
    powerW: Number(load.powerW),
  }));

const mapCandidateToBuilderInput = (candidate: CandidatePresentation): BuilderCatalogCandidate => ({
  id: candidate.id,
  eligible: candidate.recommendationEligible,
  engineeringEligible: candidate.engineeringStatus === 'compatible',
  safetyEligible: candidate.advisoryAction !== 'exclude',
  advisoryEligible:
    candidate.advisoryAction !== 'exclude' &&
    candidate.advisoryAction !== 'suppress_recommendation',
  recommendationEligible: candidate.recommendationEligible,
  status:
    candidate.engineeringStatus === 'unknown'
      ? 'unknown'
      : candidate.engineeringStatus === 'compatible'
        ? 'eligible'
        : 'ineligible',
});

const buildResultGroups = (
  items: readonly CandidatePresentation[],
  builderOutcome?: BuilderOverlayOutcome | null,
): readonly ResultGroup[] => {
  const recommendationAware = (item: CandidatePresentation): boolean => {
    if (!builderOutcome || builderOutcome.status === 'generic') {
      return item.recommendationEligible;
    }

    if (builderOutcome.status === 'unresolved') {
      return false;
    }

    if (item.builderRecommendationEligible !== undefined) {
      return item.builderRecommendationEligible;
    }

    return false;
  };

  const baseGroups: readonly ResultGroup[] = [
    {
      id: 'recommended',
      title: 'Recommended / eligible',
      items: items.filter((item) => recommendationAware(item) && item.advisoryAction !== 'caution'),
    },
    {
      id: 'cautioned',
      title: 'Eligible but advisory-cautioned',
      items: items.filter((item) => recommendationAware(item) && item.advisoryAction === 'caution'),
    },
    {
      id: 'unknown',
      title: 'Unknown / insufficient information',
      items: items.filter((item) => item.engineeringStatus === 'unknown'),
    },
    {
      id: 'suppressed',
      title: 'Suppressed from recommendation but inspectable',
      items: items.filter((item) => item.advisoryAction === 'suppress_recommendation'),
    },
    {
      id: 'ineligible',
      title: 'Ineligible / incompatible',
      items: items.filter(
        (item) =>
          item.engineeringStatus === 'incompatible' ||
          (!item.recommendationEligible &&
            item.advisoryAction !== 'suppress_recommendation' &&
            item.advisoryAction !== 'exclude' &&
            item.engineeringStatus !== 'unknown'),
      ),
    },
    {
      id: 'excluded',
      title: 'Excluded by advisory policy',
      items: items.filter((item) => item.advisoryAction === 'exclude'),
    },
  ];

  const inventoryGapItems = items.filter(
    (item) =>
      item.builderState !== undefined &&
      /builder\.(catalog_missing|unavailable|discontinued|availability_unknown)/.test(
        item.builderState,
      ),
  );

  if (
    !builderOutcome ||
    (builderOutcome.status !== 'inventory_gap' && inventoryGapItems.length === 0)
  ) {
    return baseGroups;
  }

  return [
    ...baseGroups,
    {
      id: 'inventory-gap',
      title: 'Builder inventory gap',
      items: inventoryGapItems,
    },
  ];
};

export const validateConfig = (
  formState: ConfigFormState,
): { readonly valid: boolean; readonly errors: readonly string[] } => {
  const errors: string[] = [];

  if (!formState.selectedVoltage) {
    errors.push('Select a system voltage before evaluating the configuration.');
  }

  if (formState.loads.length === 0) {
    errors.push('At least one load is required.');
  }

  const invalidLoad = formState.loads.find((load) => {
    const qty = Number(load.quantity);
    const pwr = Number(load.powerW);
    return (
      !load.name.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(pwr) || pwr <= 0
    );
  });
  if (invalidLoad) {
    errors.push(
      'Each load must have a name, a quantity greater than zero, and power greater than zero.',
    );
  }

  if (formState.builderMode === 'builder' && !formState.selectedBuilderId) {
    errors.push('Choose a builder profile when builder-specific mode is enabled.');
  }

  return { valid: errors.length === 0, errors };
};

export const evaluateConfiguration = (
  formState: ConfigFormState,
  clock: () => Date = () => new Date(),
): EvaluationSummary | null => {
  const validation = validateConfig(formState);
  if (!validation.valid) {
    return null;
  }

  const data = createSyntheticDemoData();
  const evaluatedAt = clock().toISOString();
  const recommendationResult = orchestrateRecommendations(
    {
      systemVoltageV: Number(formState.selectedVoltage),
      loads: toLoadRequirementList(formState.loads),
    },
    data,
    { evaluatedAt },
  );

  const boundary = evaluateAdvisoryRecommendationBoundary(
    data.components.map((component) => ({
      component,
      engineeringStatus: component.engineeringStatus ?? 'compatible',
    })),
    data.advisories,
    data.evidence ?? [],
    evaluatedAt,
  );

  const globalCandidates: CandidatePresentation[] = boundary.globalCandidates.map((candidate) => {
    const advisoryAction = candidate.advisory.effective_policy_action;
    const reasons = [
      ...(candidate.advisory.reasons ?? []),
      ...(candidate.component.engineeringStatus === 'unknown'
        ? ['Engineering status is unknown; required fit data is unresolved.']
        : []),
      ...(candidate.engineeringStatus === 'incompatible'
        ? ['Engineering compatibility failed before builder or advisory filtering.']
        : []),
    ];

    const why =
      advisoryAction === 'exclude'
        ? `${candidate.component.id} is excluded by the active advisory policy.`
        : advisoryAction === 'suppress_recommendation'
          ? `${candidate.component.id} is suppressed from normal recommendation but remains inspectable.`
          : candidate.engineeringStatus === 'unknown'
            ? `${candidate.component.id} remains unknown because the core engine could not resolve the fit.`
            : `${candidate.component.id} was evaluated and resulted in ${candidate.engineeringStatus}.`;

    return {
      id: candidate.component.id,
      label: candidate.component.id.replace(/^component\./, '').replace(/[.-]/g, ' '),
      engineeringStatus: candidate.engineeringStatus,
      advisoryAction,
      advisorySeverity: candidate.advisory.effective_severity,
      advisoryConfidence: candidate.advisory.effective_confidence,
      recommendationEligible: candidate.recommendationEligible,
      reasons,
      why,
      builderState: undefined,
      unresolvedRequirements:
        candidate.engineeringStatus === 'unknown'
          ? ['Compatibility fit is unresolved by the engineering core.']
          : [],
      trace: candidate.advisory.trace,
    };
  });

  const builderCandidates = globalCandidates.map(mapCandidateToBuilderInput);

  const builderOutcome =
    formState.builderMode === 'generic'
      ? evaluateGenericBuilderMode(builderCandidates)
      : formState.selectedBuilderId
        ? (() => {
            const selectedBuilder = data.builders.find(
              (builder) => builder.builderId === formState.selectedBuilderId,
            );
            if (!selectedBuilder) {
              return {
                status: 'unresolved',
                attribution: { kind: 'unresolved', builderId: formState.selectedBuilderId },
                candidates: [],
                rankedCandidates: [],
                builderId: formState.selectedBuilderId,
              } satisfies BuilderOverlayOutcome;
            }
            return evaluateBuilderCatalogMode(selectedBuilder, builderCandidates, {
              kind: 'resolved',
              builderId: selectedBuilder.builderId,
            });
          })()
        : ({
            status: 'unresolved',
            attribution: { kind: 'unresolved', builderId: 'missing-builder' },
            candidates: [],
            rankedCandidates: [],
            builderId: 'missing-builder',
          } satisfies BuilderOverlayOutcome);

  const builderAware: CandidatePresentation[] = builderOutcome.candidates.flatMap((entry) => {
    const candidate = globalCandidates.find((item) => item.id === entry.componentId);
    if (!candidate) {
      return [];
    }

    return [
      {
        ...candidate,
        builderState: entry.reason,
        builderAvailability: entry.availability,
        builderPreference: entry.preference,
        builderRecommendationEligible: entry.status === 'eligible',
        unresolvedRequirements:
          (candidate.unresolvedRequirements ?? []).length > 0
            ? (candidate.unresolvedRequirements ?? [])
            : entry.status === 'unknown'
              ? ['Builder availability is unknown; global eligibility remains unresolved.']
              : [],
      },
    ];
  });

  const mergedCandidates: CandidatePresentation[] = globalCandidates.map((candidate) => {
    const override = builderAware.find((item) => item.id === candidate.id);
    return override ?? candidate;
  });

  const groups = buildResultGroups(mergedCandidates, builderOutcome);

  return {
    recommendationResult,
    globalCandidates: mergedCandidates,
    groups,
    builderOutcome,
    evaluatedAt,
  };
};

export const builderOptions = createSyntheticDemoData().builders.map((builder) => ({
  value: builder.builderId,
  label: builder.displayName,
}));
