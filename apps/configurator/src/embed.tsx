import { createRoot, type Root } from 'react-dom/client';
import { useState, type CSSProperties, type FormEvent } from 'react';
import {
  createDefaultFormState,
  evaluateConfiguration,
  validateConfig,
  type ConfigFormState,
  type CandidatePresentation,
  type EvaluationSummary,
  type LoadItem,
} from './configurator-model.js';
import { builderOptions } from './configurator-model.js';
import { BuilderContextSection } from './components/BuilderContextSection';
import {
  ElectricalConstraintsSection,
  InstallationConstraintsSection,
} from './components/ConstraintSections';
import { LoadsSection, createLoadDefinition } from './components/LoadsSection';
import { ResultsPanel } from './components/ResultsPanel';
import { SystemBasicsSection } from './components/SystemBasicsSection';
import './embed.css';

export type EmbedMode = 'generic' | 'builder';
export type EmbedSection =
  | 'system-basics'
  | 'loads'
  | 'electrical-constraints'
  | 'installation-constraints'
  | 'builder-context'
  | 'results'
  | 'inquiry';

export type EmbedAccent = 'orange' | 'blue' | 'green';
export type EmbedRadius = 'compact' | 'rounded' | 'pill';

export interface EmbedTheme {
  readonly accent?: EmbedAccent;
  readonly borderRadius?: EmbedRadius;
  readonly density?: 'compact' | 'comfortable';
}

export interface PublicCandidateSummary {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly engineeringStatus: CandidatePresentation['engineeringStatus'];
  readonly advisoryAction: CandidatePresentation['advisoryAction'];
  readonly advisorySeverity: string;
  readonly advisoryConfidence: string;
  readonly recommendationEligible: boolean;
  readonly builderRecommendationEligible?: boolean;
  readonly builderState?: string;
  readonly builderAvailability?: string;
}

export interface PublicEvaluationPayload {
  readonly evaluatedAt: string;
  readonly mode: EmbedMode;
  readonly builder?: {
    readonly id: string;
    readonly status: 'resolved' | 'unresolved' | 'inventory_gap' | 'generic';
    readonly label?: string;
  };
  readonly status: 'evaluated';
  readonly candidates: readonly PublicCandidateSummary[];
}

type PublicBuilderStatus = NonNullable<PublicEvaluationPayload['builder']>['status'];

export interface InquiryPayload {
  readonly builderId?: string;
  readonly inquiryDestination?: string;
  readonly componentId: string;
  readonly configuration: {
    readonly systemLabel: string;
    readonly selectedVoltage: number | '';
    readonly loadCount: number;
  };
  readonly recommendationState: 'eligible' | 'not-eligible' | 'unknown';
  readonly inventoryState?: string;
}

export type EmbedEvent =
  | { readonly type: 'embed_ready' }
  | { readonly type: 'evaluation_completed'; readonly payload: PublicEvaluationPayload }
  | { readonly type: 'inquiry_requested'; readonly payload: InquiryPayload }
  | { readonly type: 'builder_unresolved'; readonly builderId: string }
  | { readonly type: 'validation_error'; readonly errors: readonly string[] };

export interface EmbedConfig {
  readonly mode?: EmbedMode;
  readonly builderId?: string;
  readonly initialConfiguration?: Partial<ConfigFormState>;
  readonly visibleSections?: readonly EmbedSection[];
  readonly readOnly?: boolean;
  readonly theme?: EmbedTheme;
  readonly inquiryDestination?: string;
  readonly onResult?: (payload: PublicEvaluationPayload) => void;
  readonly onInquiry?: (payload: InquiryPayload) => void;
  readonly onEvent?: (event: EmbedEvent) => void;
  readonly clock?: () => Date;
}

export interface EmbedController {
  updateConfig(config: EmbedConfig): void;
  dispose(): void;
}

const allSections: readonly EmbedSection[] = [
  'system-basics',
  'loads',
  'electrical-constraints',
  'installation-constraints',
  'builder-context',
  'results',
  'inquiry',
];

const createEmbedFormState = (config: EmbedConfig): ConfigFormState => {
  const defaults = createDefaultFormState();
  const initial = config.initialConfiguration ?? {};
  return {
    ...defaults,
    ...initial,
    loads: initial.loads ?? [],
    builderMode: config.mode ?? initial.builderMode ?? 'generic',
    selectedBuilderId: config.builderId ?? initial.selectedBuilderId ?? '',
  };
};

const getHostErrors = (config: EmbedConfig): readonly string[] => {
  const errors: string[] = [];
  if (config.mode === 'builder' && !config.builderId?.trim()) {
    errors.push('Builder-specific embeds require a builder ID.');
  }
  if (config.mode === 'generic' && config.builderId) {
    errors.push('Generic embeds must not provide a builder ID.');
  }
  return errors;
};

const accentColors: Record<EmbedAccent, string> = {
  orange: '#9a4d16',
  blue: '#245b8a',
  green: '#2f6b45',
};

const radiusValues: Record<EmbedRadius, string> = {
  compact: '0.45rem',
  rounded: '1rem',
  pill: '999px',
};

const getRadiusValue = (radius: EmbedTheme['borderRadius']): string =>
  radius && radius in radiusValues ? radiusValues[radius] : radiusValues.rounded;

const toPublicEvaluation = (
  result: EvaluationSummary,
  mode: EmbedMode,
  builderId: string,
): PublicEvaluationPayload => {
  const groupsByCandidate = new Map<string, string>();
  result.groups.forEach((group) => {
    group.items.forEach((candidate) => groupsByCandidate.set(candidate.id, group.id));
  });
  const builderStatus = result.builderOutcome?.status ?? 'generic';
  const builderStatusValue: PublicBuilderStatus =
    builderStatus === 'unresolved'
      ? 'unresolved'
      : builderStatus === 'inventory_gap'
        ? 'inventory_gap'
        : builderId
          ? 'resolved'
          : 'generic';
  const builder = builderId
    ? {
        id: builderId,
        status: builderStatusValue,
        ...(result.builderOutcome?.attribution.kind === 'resolved' &&
        result.builderOutcome.attribution.builderId === builderId
          ? {
              label:
                builderOptions.find((option) => option.value === builderId)?.label ?? builderId,
            }
          : {}),
      }
    : undefined;
  return {
    evaluatedAt: result.evaluatedAt,
    mode,
    ...(builder ? { builder } : { builder: { id: '', status: 'generic' as const } }),
    status: 'evaluated',
    candidates: result.globalCandidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      group: groupsByCandidate.get(candidate.id) ?? 'unclassified',
      engineeringStatus: candidate.engineeringStatus,
      advisoryAction: candidate.advisoryAction,
      advisorySeverity: candidate.advisorySeverity,
      advisoryConfidence: candidate.advisoryConfidence,
      recommendationEligible: candidate.recommendationEligible,
      ...(candidate.builderRecommendationEligible !== undefined
        ? { builderRecommendationEligible: candidate.builderRecommendationEligible }
        : {}),
      ...(candidate.builderState ? { builderState: candidate.builderState } : {}),
      ...(candidate.builderAvailability
        ? { builderAvailability: candidate.builderAvailability }
        : {}),
    })),
  };
};

interface EmbedAppProps {
  config: EmbedConfig;
}

function EmbedApp({ config }: EmbedAppProps) {
  const hostErrors = getHostErrors(config);
  const [formState, setFormState] = useState<ConfigFormState>(() => createEmbedFormState(config));
  const [result, setResult] = useState<EvaluationSummary | null>(null);
  const [error, setError] = useState<string | null>(hostErrors[0] ?? null);
  const visible = new Set(config.visibleSections ?? allSections);
  const show = (section: EmbedSection) => visible.has(section);
  const emit = (event: EmbedEvent) => config.onEvent?.(event);

  const updateField = <K extends keyof ConfigFormState>(field: K, value: ConfigFormState[K]) => {
    if (!config.readOnly) {
      setFormState((current) => ({ ...current, [field]: value }));
    }
  };
  const updateLoad = (id: string, field: keyof LoadItem, value: string) => {
    if (!config.readOnly) {
      setFormState((current) => ({
        ...current,
        loads: current.loads.map((load) => (load.id === id ? { ...load, [field]: value } : load)),
      }));
    }
  };
  const removeLoad = (id: string) => {
    if (!config.readOnly) {
      setFormState((current) => ({
        ...current,
        loads: current.loads.filter((load) => load.id !== id),
      }));
    }
  };
  const addLoad = () => {
    if (!config.readOnly) {
      setFormState((current) => ({
        ...current,
        loads: [...current.loads, createLoadDefinition()],
      }));
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = hostErrors.length > 0 ? hostErrors : validateConfig(formState).errors;
    if (validation.length > 0) {
      setError(validation[0] ?? 'The embed configuration is invalid.');
      setResult(null);
      emit({ type: 'validation_error', errors: validation });
      return;
    }
    const nextResult = evaluateConfiguration(formState, config.clock);
    if (!nextResult) {
      const errors = validateConfig(formState).errors;
      setError(errors[0] ?? 'The configuration is incomplete.');
      emit({ type: 'validation_error', errors });
      return;
    }
    setError(null);
    setResult(nextResult);
    const payload = toPublicEvaluation(
      nextResult,
      formState.builderMode,
      formState.selectedBuilderId,
    );
    config.onResult?.(payload);
    emit({ type: 'evaluation_completed', payload });
    if (nextResult.builderOutcome?.status === 'unresolved') {
      emit({ type: 'builder_unresolved', builderId: formState.selectedBuilderId });
    }
  };

  const requestInquiry = (
    componentId: string,
    recommendationState: InquiryPayload['recommendationState'],
    inventoryState?: string,
  ) => {
    const payload: InquiryPayload = {
      ...(formState.selectedBuilderId ? { builderId: formState.selectedBuilderId } : {}),
      ...(config.inquiryDestination ? { inquiryDestination: config.inquiryDestination } : {}),
      componentId,
      configuration: {
        systemLabel: formState.systemLabel,
        selectedVoltage: formState.selectedVoltage,
        loadCount: formState.loads.length,
      },
      recommendationState,
      ...(inventoryState ? { inventoryState } : {}),
    };
    config.onInquiry?.(payload);
    emit({ type: 'inquiry_requested', payload });
  };

  return (
    <div
      className={`embed-root density-${config.theme?.density ?? 'comfortable'}`}
      style={
        {
          '--embed-accent': accentColors[config.theme?.accent ?? 'orange'],
          '--embed-background': '#f4f1ea',
          '--embed-text': '#17202a',
          '--embed-radius': getRadiusValue(config.theme?.borderRadius),
        } as CSSProperties
      }
    >
      <header>
        <p className="eyebrow">Engineering configurator embed</p>
        <h1>
          {formState.builderMode === 'builder'
            ? 'Builder-scoped configuration'
            : 'Configure from requirements'}
        </h1>
        <p className="lede">
          Engineering and advisory eligibility remains authoritative; builder context can only
          narrow eligible results.
        </p>
        {formState.builderMode === 'builder' && (
          <p className="builder-attribution" aria-live="polite">
            Builder:{' '}
            {builderOptions.find((builder) => builder.value === formState.selectedBuilderId)
              ?.label ??
              (formState.selectedBuilderId
                ? `Unresolved (${formState.selectedBuilderId})`
                : 'Unresolved')}
          </p>
        )}
      </header>
      <form className="workflow-form" onSubmit={submit} aria-label="Embedded configurator">
        <fieldset className="embed-fields" disabled={config.readOnly}>
          {show('system-basics') && (
            <SystemBasicsSection formState={formState} onFieldChange={updateField} />
          )}
          {show('loads') && (
            <LoadsSection
              formState={formState}
              onLoadUpdate={updateLoad}
              onLoadRemove={removeLoad}
              onLoadAdd={addLoad}
            />
          )}
          {show('electrical-constraints') && (
            <ElectricalConstraintsSection formState={formState} onFieldChange={updateField} />
          )}
          {show('installation-constraints') && (
            <InstallationConstraintsSection formState={formState} onFieldChange={updateField} />
          )}
          {show('builder-context') && (
            <BuilderContextSection formState={formState} onFieldChange={updateField} />
          )}
        </fieldset>
        <div className="toolbar">
          <button type="submit">Evaluate configuration</button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      {show('results') && result && (
        <ResultsPanel
          result={result}
          selectedVoltage={formState.selectedVoltage}
          loadCount={formState.loads.length}
          builderMode={formState.builderMode}
          onInquiry={requestInquiry}
          showInquiry={show('inquiry')}
        />
      )}
    </div>
  );
}

export function mountConfiguratorEmbed(
  element: HTMLElement,
  config: EmbedConfig = {},
): EmbedController {
  let currentConfig = config;
  let renderVersion = 0;
  let root: Root | null = createRoot(element);
  root.render(<EmbedApp key={renderVersion} config={currentConfig} />);
  currentConfig.onEvent?.({ type: 'embed_ready' });

  return {
    updateConfig(nextConfig) {
      currentConfig = nextConfig;
      renderVersion += 1;
      if (root) root.render(<EmbedApp key={renderVersion} config={currentConfig} />);
    },
    dispose() {
      root?.unmount();
      root = null;
      element.replaceChildren();
    },
  };
}
