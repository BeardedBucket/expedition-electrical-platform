import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import componentSchema from '../../../data/schemas/component.schema.json' with { type: 'json' };

export type ComponentVerificationStatus = 'unverified' | 'partially_verified' | 'verified';
export type CompatibilityStatus = 'compatible' | 'incompatible' | 'unknown';
export type AdvisoryStatus = 'info' | 'watch' | 'advisory' | 'critical';
export type RecommendationEffect = 'none' | 'warn' | 'suppress_default' | 'exclude';
export type CompatibilityCheckName =
  | 'voltage'
  | 'current'
  | 'power'
  | 'interface'
  | 'accessory'
  | 'converter'
  | 'fit'
  | 'weight'
  | 'advisory';

export interface ComponentLibrarySourceRef extends Record<string, unknown> {
  id?: string;
  title?: string;
  type?: string;
  source_type?: string;
  uri?: string;
  url?: string;
  manufacturer_document_id?: string;
  date_checked?: string;
  observed_at?: string;
}

export interface ComponentRequirementRef extends Record<string, unknown> {
  readonly id?: string;
  readonly name?: string;
  readonly label?: string;
  readonly note?: string;
}

export interface ComponentLibraryRange {
  readonly min: number;
  readonly max: number;
}

export interface ComponentLibraryElectrical {
  readonly nominal_voltage_v?: number | number[] | null;
  readonly continuous_current_a?: number | null;
  readonly continuous_power_w?: number | null;
  readonly apparent_power_va?: number | null;
  readonly ac_output_voltage_v?: number | number[] | null;
  readonly input_voltage_range_v?: ComponentLibraryRange | null;
  readonly output_voltage_range_v?: ComponentLibraryRange | null;
  readonly frequency_hz?: number | number[] | null;
  readonly [key: string]: unknown;
}

export interface ComponentLibraryAdvisoryState {
  readonly status?: 'none' | AdvisoryStatus;
  readonly recommendation_effect?: RecommendationEffect;
  readonly summary?: string;
  readonly source_refs?: readonly ComponentLibrarySourceRef[];
  readonly [key: string]: unknown;
}

export interface ComponentLibraryAdvisoryReference extends Record<string, unknown> {
  readonly id?: string;
  readonly title?: string;
  readonly type?: string;
  readonly uri?: string;
  readonly url?: string;
  readonly source_type?: string;
  readonly summary?: string;
}

export interface ComponentLibraryRecord {
  readonly id: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly part_number?: string | null;
  readonly category: string;
  readonly verification_status: ComponentVerificationStatus;
  readonly source_type?: string | null;
  readonly source_refs?: readonly ComponentLibrarySourceRef[];
  readonly electrical?: ComponentLibraryElectrical | null;
  readonly dimensions_mm?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  } | null;
  readonly weight_kg?: number | null;
  readonly interfaces?: readonly string[];
  readonly required_accessories?: ReadonlyArray<string | ComponentRequirementRef>;
  readonly required_converters?: ReadonlyArray<string | ComponentRequirementRef>;
  readonly advisory_refs?: readonly ComponentLibraryAdvisoryReference[];
  readonly [key: string]: unknown;
}

export interface CompatibilityCheckResult {
  readonly status: CompatibilityStatus;
  readonly required: boolean;
  readonly reasons: readonly string[];
  readonly explanation: string;
}

export interface AdvisoryEvaluationResult {
  readonly status: 'none' | AdvisoryStatus;
  readonly recommendation_effect: RecommendationEffect;
  readonly can_recommend: boolean;
  readonly reasons: readonly string[];
  readonly explanation: string;
}

export interface ComponentCompatibilityEvaluationInput {
  readonly systemVoltageV?: number;
  readonly outputVoltageV?: number;
  readonly requiredCurrentA?: number;
  readonly requiredPowerW?: number;
  readonly requiredApparentPowerVa?: number;
  readonly requiredInterfaces?: readonly string[];
  readonly installedAccessories?: readonly string[];
  readonly installedConverters?: readonly string[];
  readonly installationEnvelopeMm?: {
    readonly x?: number;
    readonly y?: number;
    readonly z?: number;
  } | null;
  readonly maxWeightKg?: number;
  readonly requiredChecks?: readonly CompatibilityCheckName[];
  readonly advisoryEvaluation?: ComponentLibraryAdvisoryState | null;
}

export interface ComponentCompatibilityResult {
  readonly status: CompatibilityStatus;
  readonly overall: {
    readonly status: CompatibilityStatus;
    readonly reasons: readonly string[];
    readonly explanation: string;
  };
  readonly checks: Record<string, CompatibilityCheckResult>;
  readonly reasons: readonly string[];
  readonly explanations: readonly string[];
  readonly advisory: AdvisoryEvaluationResult;
}

const componentSchemaData = componentSchema as Record<string, unknown>;
type JsonSchemaValidator = ((value: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }>;
};

const AjvCtor = Ajv2020 as unknown as new (options?: Record<string, unknown>) => {
  compile: (schema: unknown) => JsonSchemaValidator;
};
const ajv = new AjvCtor({ allErrors: true, strict: false, allowUnionTypes: true });
const registerFormats = addFormats as unknown as (instance: {
  addFormat?: (...args: unknown[]) => void;
}) => void;
registerFormats(ajv as unknown as { addFormat?: (...args: unknown[]) => void });
const validateComponentSchema = ajv.compile(componentSchemaData);

const materializeRange = (value: unknown): ComponentLibraryRange | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    const min = candidate.min;
    const max = candidate.max;
    if (typeof min === 'number' && typeof max === 'number') {
      return { min, max };
    }
  }
  if (Array.isArray(value) && value.length >= 2) {
    const min = Number(value[0]);
    const max = Number(value[1]);
    if (Number.isFinite(min) && Number.isFinite(max)) return { min, max };
  }
  return null;
};

const normalizeVoltageSet = (value: unknown): number[] => {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) {
    const numbers = value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
    return numbers;
  }
  return [];
};

const normalizeTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
};

const normalizeRequirementToken = (value: unknown): string => {
  if (typeof value === 'string') return normalizeToken(value);
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    const idValue = typeof candidate.id === 'string' ? candidate.id : '';
    return normalizeToken(idValue);
  }
  return '';
};

const normalizeRequirementList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeRequirementToken).filter((item) => item.length > 0))];
};

const normalizeToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const toNameList = (values: readonly string[] | undefined): readonly string[] => values ?? [];

const inferRequiredChecks = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): readonly CompatibilityCheckName[] => {
  if (context.requiredChecks && context.requiredChecks.length > 0) {
    return context.requiredChecks;
  }

  const inferred = new Set<CompatibilityCheckName>();

  if (
    typeof context.systemVoltageV === 'number' ||
    typeof context.outputVoltageV === 'number' ||
    context.requiredChecks?.includes('voltage')
  ) {
    inferred.add('voltage');
  }

  if (typeof context.requiredCurrentA === 'number' || context.requiredChecks?.includes('current')) {
    inferred.add('current');
  }

  if (
    typeof context.requiredPowerW === 'number' ||
    typeof context.requiredApparentPowerVa === 'number' ||
    context.requiredChecks?.includes('power')
  ) {
    inferred.add('power');
  }

  if (
    (context.requiredInterfaces?.length ?? 0) > 0 ||
    context.requiredChecks?.includes('interface')
  ) {
    inferred.add('interface');
  }

  if (
    (context.installationEnvelopeMm !== undefined && context.installationEnvelopeMm !== null) ||
    context.requiredChecks?.includes('fit')
  ) {
    inferred.add('fit');
  }

  if (typeof context.maxWeightKg === 'number' || context.requiredChecks?.includes('weight')) {
    inferred.add('weight');
  }

  const hasAccessoryRequirements =
    normalizeRequirementList(component.required_accessories).length > 0;
  if (
    (hasAccessoryRequirements &&
      (context.installedAccessories !== undefined ||
        context.requiredChecks?.includes('accessory'))) ||
    context.requiredChecks?.includes('accessory')
  ) {
    inferred.add('accessory');
  }

  const hasConverterRequirements =
    normalizeRequirementList(component.required_converters).length > 0;
  if (
    (hasConverterRequirements &&
      (context.installedConverters !== undefined ||
        context.requiredChecks?.includes('converter'))) ||
    context.requiredChecks?.includes('converter')
  ) {
    inferred.add('converter');
  }

  return [...inferred];
};

const validateEngineeringConstraints = (input: unknown): readonly string[] => {
  if (input === null || typeof input !== 'object') {
    return [];
  }

  const record = input as Record<string, unknown>;
  const messages: string[] = [];
  const addMessage = (path: string, message: string) => {
    messages.push(`${path}: ${message}`);
  };

  const validateFiniteNonNegative = (path: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      addMessage(path, 'must be a finite number greater than or equal to 0');
    }
  };

  const validatePositiveRange = (path: string, value: unknown) => {
    const range = value as Record<string, unknown> | null | undefined;
    if (range === null || range === undefined) return;
    if (typeof range !== 'object') {
      addMessage(path, 'must be an object with min and max values');
      return;
    }
    const minValue = range.min;
    const maxValue = range.max;
    if (typeof minValue !== 'number' || !Number.isFinite(minValue) || minValue <= 0) {
      addMessage(`${path}.min`, 'must be a finite positive number');
    }
    if (typeof maxValue !== 'number' || !Number.isFinite(maxValue) || maxValue <= 0) {
      addMessage(`${path}.max`, 'must be a finite positive number');
    }
    if (
      typeof minValue === 'number' &&
      typeof maxValue === 'number' &&
      Number.isFinite(minValue) &&
      Number.isFinite(maxValue) &&
      minValue > maxValue
    ) {
      addMessage(path, 'min must be less than or equal to max');
    }
  };

  const electrical = record.electrical;
  if (electrical !== null && electrical !== undefined && typeof electrical === 'object') {
    const electricalRecord = electrical as Record<string, unknown>;
    validatePositiveRange(
      'electrical.input_voltage_range_v',
      electricalRecord.input_voltage_range_v,
    );
    validatePositiveRange(
      'electrical.output_voltage_range_v',
      electricalRecord.output_voltage_range_v,
    );
    validateFiniteNonNegative(
      'electrical.continuous_current_a',
      electricalRecord.continuous_current_a,
    );
    validateFiniteNonNegative('electrical.continuous_power_w', electricalRecord.continuous_power_w);
    validateFiniteNonNegative('electrical.apparent_power_va', electricalRecord.apparent_power_va);
    const nominalVoltage = electricalRecord.nominal_voltage_v;
    if (Array.isArray(nominalVoltage)) {
      nominalVoltage.forEach((value, index) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          addMessage(
            `electrical.nominal_voltage_v[${index}]`,
            'must be a finite number greater than or equal to 0',
          );
        }
      });
    } else {
      validateFiniteNonNegative('electrical.nominal_voltage_v', nominalVoltage);
    }
    const outputVoltage = electricalRecord.ac_output_voltage_v;
    if (Array.isArray(outputVoltage)) {
      outputVoltage.forEach((value, index) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          addMessage(
            `electrical.ac_output_voltage_v[${index}]`,
            'must be a finite number greater than or equal to 0',
          );
        }
      });
    } else {
      validateFiniteNonNegative('electrical.ac_output_voltage_v', outputVoltage);
    }
  }

  const dimensions = record.dimensions_mm;
  if (dimensions !== null && dimensions !== undefined && typeof dimensions === 'object') {
    const dimensionsRecord = dimensions as Record<string, unknown>;
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = dimensionsRecord[axis];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        addMessage(`dimensions_mm.${axis}`, 'must be a finite number greater than or equal to 0');
      }
    }
  }

  validateFiniteNonNegative('weight_kg', record.weight_kg);
  return messages;
};

export const validateComponentLibraryRecord = (
  input: unknown,
): { ok: true; value: ComponentLibraryRecord } | { ok: false; errors: readonly string[] } => {
  const valid = validateComponentSchema(input);
  if (!valid) {
    const errors = (validateComponentSchema.errors ?? []).map(
      (err: { instancePath?: string; message?: string }) => {
        const key = err.instancePath || 'record';
        return `${key}: ${err.message ?? 'invalid value'}`;
      },
    );
    return { ok: false, errors };
  }

  const semanticErrors = validateEngineeringConstraints(input);
  if (semanticErrors.length > 0) {
    return { ok: false, errors: semanticErrors };
  }

  return { ok: true, value: input as ComponentLibraryRecord };
};

export const normalizeComponentLibraryRecord = (input: unknown): ComponentLibraryRecord => {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('A component record must be an object.');
  }
  const record = input as Record<string, unknown>;
  const normalized = {
    ...record,
    source_refs: Array.isArray(record.source_refs) ? record.source_refs : [],
    interfaces: normalizeTextList(record.interfaces),
    required_accessories: Array.isArray(record.required_accessories)
      ? record.required_accessories
      : [],
    required_converters: Array.isArray(record.required_converters)
      ? record.required_converters
      : [],
    electrical:
      record.electrical !== null &&
      typeof record.electrical === 'object' &&
      record.electrical !== undefined
        ? {
            ...(record.electrical as Record<string, unknown>),
            input_voltage_range_v: materializeRange(
              (record.electrical as Record<string, unknown>).input_voltage_range_v,
            ),
            output_voltage_range_v: materializeRange(
              (record.electrical as Record<string, unknown>).output_voltage_range_v,
            ),
          }
        : null,
  } as unknown as ComponentLibraryRecord;

  return normalized;
};

export const parseComponentLibraryText = (
  sourceText: string,
  sourceLabel = 'inline-component-record',
):
  | { ok: true; value: ComponentLibraryRecord; label: string }
  | { ok: false; errors: readonly string[]; label: string } => {
  const trimmed = sourceText.trim();
  if (trimmed.length === 0) {
    return { ok: false, errors: ['Component source is empty.'], label: sourceLabel };
  }

  try {
    const parsed =
      trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(trimmed) : parseYaml(trimmed);
    const validation = validateComponentLibraryRecord(parsed);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors, label: sourceLabel };
    }
    return {
      ok: true,
      value: normalizeComponentLibraryRecord(validation.value),
      label: sourceLabel,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    return {
      ok: false,
      errors: [`Unable to parse component source (${sourceLabel}): ${message}`],
      label: sourceLabel,
    };
  }
};

const evaluateVoltageCheck = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): CompatibilityCheckResult => {
  const required = context.requiredChecks?.includes('voltage') ?? false;
  const systemVoltageV = context.systemVoltageV;
  const outputVoltageV = context.outputVoltageV;

  if (!required && systemVoltageV === undefined && outputVoltageV === undefined) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'No voltage requirement was supplied for this evaluation.',
    };
  }

  const electrical = component.electrical ?? null;
  const subchecks: Array<{
    label: string;
    status: CompatibilityStatus;
    reasons: string[];
    explanation: string;
  }> = [];

  const evaluateVoltageBranch = (
    label: 'system' | 'output',
    suppliedValue: number | undefined,
    rangeValue: ComponentLibraryRange | null,
    nominalValue: unknown,
    explicitLabel: string,
  ) => {
    if (suppliedValue === undefined || !Number.isFinite(suppliedValue) || suppliedValue <= 0) {
      return;
    }

    const declaredValues = normalizeVoltageSet(
      label === 'system' ? electrical?.nominal_voltage_v : electrical?.ac_output_voltage_v,
    );

    if (rangeValue !== null) {
      if (suppliedValue < rangeValue.min || suppliedValue > rangeValue.max) {
        subchecks.push({
          label,
          status: 'incompatible',
          reasons: [`voltage.${label}.range.mismatch`],
          explanation: `The ${label} voltage (${suppliedValue} V) falls outside the declared ${explicitLabel} range (${rangeValue.min} V to ${rangeValue.max} V).`,
        });
      } else {
        subchecks.push({
          label,
          status: 'compatible',
          reasons: [`voltage.${label}.range.match`],
          explanation: `The ${label} voltage (${suppliedValue} V) matches the declared ${explicitLabel} range (${rangeValue.min} V to ${rangeValue.max} V).`,
        });
      }
      return;
    }

    if (declaredValues.length === 0 && nominalValue === null) {
      subchecks.push({
        label,
        status: 'unknown',
        reasons: [`voltage.${label}.missing_range_data`],
        explanation: `No explicit ${explicitLabel} operating range or declared ${label} voltage data is available for this component.`,
      });
      return;
    }

    const matches = declaredValues.some((value) => Math.abs(value - suppliedValue) < 1e-9);
    if (!matches) {
      subchecks.push({
        label,
        status: 'incompatible',
        reasons: [`voltage.${label}.nominal_mismatch`],
        explanation: `The component does not list the ${label} voltage target (${suppliedValue} V) as a valid ${explicitLabel} value.`,
      });
      return;
    }

    subchecks.push({
      label,
      status: 'unknown',
      reasons: [`voltage.${label}.nominal_only`],
      explanation: `The ${label} voltage (${suppliedValue} V) matches the component's declared ${explicitLabel} value(s), but no verified operating range was supplied, so compatibility remains uncertain.`,
    });
  };

  evaluateVoltageBranch(
    'system',
    systemVoltageV,
    materializeRange(electrical?.input_voltage_range_v),
    electrical?.nominal_voltage_v ?? null,
    'input/system',
  );
  evaluateVoltageBranch(
    'output',
    outputVoltageV,
    materializeRange(electrical?.output_voltage_range_v),
    electrical?.ac_output_voltage_v ?? null,
    'output',
  );

  if (subchecks.length === 0) {
    return {
      status: 'unknown',
      required: required || systemVoltageV !== undefined || outputVoltageV !== undefined,
      reasons: ['voltage.missing_voltage_requirement'],
      explanation:
        'A valid system or output voltage target is required before voltage compatibility can be determined.',
    };
  }

  const statuses = subchecks.map((subcheck) => subcheck.status);
  const reasons = subchecks.flatMap((subcheck) => subcheck.reasons);
  const explanation = subchecks.map((subcheck) => subcheck.explanation).join(' ');

  let status: CompatibilityStatus = 'compatible';
  if (statuses.includes('incompatible')) {
    status = 'incompatible';
  } else if (statuses.includes('unknown')) {
    status = 'unknown';
  }

  return {
    status,
    required: required || systemVoltageV !== undefined || outputVoltageV !== undefined,
    reasons,
    explanation,
  };
};

const evaluateCurrentCheck = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): CompatibilityCheckResult => {
  const requiredCurrentA = context.requiredCurrentA;
  const required =
    (context.requiredChecks?.includes('current') ?? false) || requiredCurrentA !== undefined;

  if (!required) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'Current limit is not required for this evaluation.',
    };
  }

  if (requiredCurrentA === undefined) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['current.missing_required_current'],
      explanation: 'A target current was not supplied, so current compatibility remains unknown.',
    };
  }

  const limit = component.electrical?.continuous_current_a ?? null;
  if (limit === null || !Number.isFinite(limit)) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['current.missing_limit'],
      explanation:
        'The component does not declare a continuous current limit, so compatibility is unknown.',
    };
  }

  if (requiredCurrentA > limit) {
    return {
      status: 'incompatible',
      required: true,
      reasons: ['current.limit_exceeded'],
      explanation: `Required current (${requiredCurrentA} A) exceeds the component's continuous current limit (${limit} A).`,
    };
  }

  return {
    status: 'compatible',
    required: true,
    reasons: [],
    explanation: `Required current (${requiredCurrentA} A) is within the component's continuous current limit (${limit} A).`,
  };
};

const evaluatePowerCheck = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): CompatibilityCheckResult => {
  const requiredPowerW = context.requiredPowerW;
  const requiredApparentPowerVa = context.requiredApparentPowerVa;
  const required =
    (context.requiredChecks?.includes('power') ?? false) ||
    requiredPowerW !== undefined ||
    requiredApparentPowerVa !== undefined;

  if (!required) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'Power limit is not required for this evaluation.',
    };
  }

  const subchecks: Array<{
    status: CompatibilityStatus;
    reasons: string[];
    explanation: string;
  }> = [];

  if (requiredPowerW !== undefined) {
    const continuousPowerW = component.electrical?.continuous_power_w ?? null;
    if (continuousPowerW === null || !Number.isFinite(continuousPowerW)) {
      subchecks.push({
        status: 'unknown',
        reasons: ['power.real_power.missing_limit'],
        explanation:
          'The component does not declare a continuous real-power limit for the required power draw.',
      });
    } else if (requiredPowerW > continuousPowerW) {
      subchecks.push({
        status: 'incompatible',
        reasons: ['power.real_power.limit_exceeded'],
        explanation: `Required real power (${requiredPowerW} W) exceeds the component's continuous power limit (${continuousPowerW} W).`,
      });
    } else {
      subchecks.push({
        status: 'compatible',
        reasons: ['power.real_power.within_limit'],
        explanation: `Required real power (${requiredPowerW} W) is within the component's continuous power limit (${continuousPowerW} W).`,
      });
    }
  }

  if (requiredApparentPowerVa !== undefined) {
    const apparentLimitVa = component.electrical?.apparent_power_va ?? null;
    if (apparentLimitVa === null || !Number.isFinite(apparentLimitVa)) {
      subchecks.push({
        status: 'unknown',
        reasons: ['power.apparent_power.missing_limit'],
        explanation:
          'The component does not declare an apparent-power limit for the required apparent power draw.',
      });
    } else if (requiredApparentPowerVa > apparentLimitVa) {
      subchecks.push({
        status: 'incompatible',
        reasons: ['power.apparent_power.limit_exceeded'],
        explanation: `Required apparent power (${requiredApparentPowerVa} VA) exceeds the component's apparent power limit (${apparentLimitVa} VA).`,
      });
    } else {
      subchecks.push({
        status: 'compatible',
        reasons: ['power.apparent_power.within_limit'],
        explanation: `Required apparent power (${requiredApparentPowerVa} VA) is within the component's apparent power limit (${apparentLimitVa} VA).`,
      });
    }
  }

  if (subchecks.length === 0) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['power.missing_requirement'],
      explanation:
        'Power compatibility was requested but no real or apparent power requirement was supplied.',
    };
  }

  const reasons = subchecks.flatMap((subcheck) => subcheck.reasons);
  let status: CompatibilityStatus = 'compatible';
  if (subchecks.some((subcheck) => subcheck.status === 'incompatible')) {
    status = 'incompatible';
  } else if (subchecks.some((subcheck) => subcheck.status === 'unknown')) {
    status = 'unknown';
  }

  return {
    status,
    required: true,
    reasons,
    explanation: subchecks.map((subcheck) => subcheck.explanation).join(' '),
  };
};

const evaluateInterfaceCheck = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): CompatibilityCheckResult => {
  const requiredInterfaces = toNameList(context.requiredInterfaces);
  const required =
    (context.requiredChecks?.includes('interface') ?? false) || requiredInterfaces.length > 0;

  if (!required) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'No required interfaces were supplied.',
    };
  }

  if (requiredInterfaces.length === 0) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['interface.missing_required_interface'],
      explanation:
        'Interface compatibility was requested, but no required interface list was supplied.',
    };
  }

  const available = new Set(normalizeTextList(component.interfaces).map(normalizeToken));
  if (available.size === 0) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['interface.missing_component_interfaces'],
      explanation:
        'The component does not declare any interfaces, so interface compatibility is unknown.',
    };
  }

  const missing = requiredInterfaces.filter((entry) => !available.has(normalizeToken(entry)));
  if (missing.length > 0) {
    return {
      status: 'incompatible',
      required: true,
      reasons: ['interface.missing_required_interface'],
      explanation: `Required interface(s) not found on the component: ${missing.join(', ')}.`,
    };
  }

  return {
    status: 'compatible',
    required: true,
    reasons: [],
    explanation: `The component includes all required interfaces: ${requiredInterfaces.join(', ')}.`,
  };
};

const evaluateAccessoryCheck = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): CompatibilityCheckResult => {
  const required =
    context.requiredChecks?.includes('accessory') ??
    (normalizeRequirementList(component.required_accessories).length > 0 &&
      context.installedAccessories !== undefined);

  if (!required) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'Accessory requirements were not requested for this evaluation.',
    };
  }

  const requiredAccessories = normalizeRequirementList(component.required_accessories);
  if (requiredAccessories.length === 0) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'No required accessories are declared for this component.',
    };
  }

  const installed = normalizeRequirementList(context.installedAccessories);
  if (installed.length === 0) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['accessory.missing_installed_accessories'],
      explanation:
        'The installation context does not list the accessories required by this component.',
    };
  }

  const installedSet = new Set(installed);
  const missing = requiredAccessories.filter((entry) => !installedSet.has(entry));
  if (missing.length > 0) {
    return {
      status: 'incompatible',
      required: true,
      reasons: ['accessory.missing_required_accessory'],
      explanation: `Missing required accessory(s): ${missing.join(', ')}.`,
    };
  }

  return {
    status: 'compatible',
    required: true,
    reasons: [],
    explanation: `All required accessories are present: ${requiredAccessories.join(', ')}.`,
  };
};

const evaluateConverterCheck = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): CompatibilityCheckResult => {
  const required =
    context.requiredChecks?.includes('converter') ??
    (normalizeRequirementList(component.required_converters).length > 0 &&
      context.installedConverters !== undefined);

  if (!required) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'Converter requirements were not requested for this evaluation.',
    };
  }

  const requiredConverters = normalizeRequirementList(component.required_converters);
  if (requiredConverters.length === 0) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'No required converters are declared for this component.',
    };
  }

  const installed = normalizeRequirementList(context.installedConverters);
  if (installed.length === 0) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['converter.missing_installed_converters'],
      explanation:
        'The installation context does not list the converters required by this component.',
    };
  }

  const installedSet = new Set(installed);
  const missing = requiredConverters.filter((entry) => !installedSet.has(entry));
  if (missing.length > 0) {
    return {
      status: 'incompatible',
      required: true,
      reasons: ['converter.missing_required_converter'],
      explanation: `Missing required converter(s): ${missing.join(', ')}.`,
    };
  }

  return {
    status: 'compatible',
    required: true,
    reasons: [],
    explanation: `All required converters are present: ${requiredConverters.join(', ')}.`,
  };
};

const evaluateFitCheck = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): CompatibilityCheckResult => {
  const required =
    context.requiredChecks?.includes('fit') ??
    (context.installationEnvelopeMm !== undefined && context.installationEnvelopeMm !== null);

  if (!required) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'Physical fit is not required for this evaluation.',
    };
  }

  const envelope = context.installationEnvelopeMm ?? null;
  const dimensions = component.dimensions_mm ?? null;
  if (envelope === null) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['fit.missing_envelope'],
      explanation: 'No installation envelope was supplied, so fit remains unknown.',
    };
  }

  if (dimensions === null) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['fit.missing_dimensions'],
      explanation: 'The component dimensions are missing, so fit remains unknown.',
    };
  }

  const axes = ['x', 'y', 'z'] as const;
  const axisResults = axes.map((axis) => {
    const componentValue = dimensions[axis];
    const envelopeValue = envelope[axis];
    if (typeof componentValue !== 'number' || !Number.isFinite(componentValue)) {
      return { axis, resolved: false as const };
    }
    if (typeof envelopeValue !== 'number' || !Number.isFinite(envelopeValue)) {
      return { axis, resolved: false as const };
    }
    return { axis, resolved: true as const, componentValue, envelopeValue };
  });

  const unresolved = axisResults.filter((entry) => !entry.resolved);
  if (unresolved.length > 0) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['fit.partial_envelope'],
      explanation: `Fit cannot be fully evaluated because some installation envelope or component dimensions are missing: ${unresolved.map((entry) => entry.axis).join(', ')}.`,
    };
  }

  const overLimit = axisResults.filter(
    (entry) =>
      entry.resolved &&
      'componentValue' in entry &&
      'envelopeValue' in entry &&
      entry.componentValue > entry.envelopeValue,
  );

  if (overLimit.length > 0) {
    return {
      status: 'incompatible',
      required: true,
      reasons: ['fit.exceeds_envelope'],
      explanation: `The component dimensions exceed the available envelope along: ${overLimit.map((entry) => entry.axis).join(', ')}.`,
    };
  }

  return {
    status: 'compatible',
    required: true,
    reasons: [],
    explanation: 'The component dimensions fit within the installation envelope.',
  };
};

const evaluateWeightCheck = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput,
): CompatibilityCheckResult => {
  const required =
    (context.requiredChecks?.includes('weight') ?? false) || context.maxWeightKg !== undefined;

  if (!required) {
    return {
      status: 'compatible',
      required: false,
      reasons: [],
      explanation: 'Weight requirements were not requested for this evaluation.',
    };
  }

  const maxWeightKg = context.maxWeightKg;
  if (maxWeightKg === undefined) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['weight.missing_constraint'],
      explanation:
        'Weight compatibility was requested, but no maximum weight constraint was supplied.',
    };
  }

  const weightKg = component.weight_kg ?? null;
  if (weightKg === null || !Number.isFinite(weightKg)) {
    return {
      status: 'unknown',
      required: true,
      reasons: ['weight.missing_weight_data'],
      explanation: 'The component does not declare a weight, so weight compatibility is unknown.',
    };
  }

  if (weightKg > maxWeightKg) {
    return {
      status: 'incompatible',
      required: true,
      reasons: ['weight.exceeds_limit'],
      explanation: `The component weight (${weightKg} kg) exceeds the allowed maximum (${maxWeightKg} kg).`,
    };
  }

  return {
    status: 'compatible',
    required: true,
    reasons: [],
    explanation: `The component weight (${weightKg} kg) is within the allowed maximum (${maxWeightKg} kg).`,
  };
};

export const evaluateAdvisoryState = (
  _component: ComponentLibraryRecord,
  advisoryInput?: (ComponentLibraryAdvisoryState & { reasons?: readonly string[] }) | null,
): AdvisoryEvaluationResult => {
  const advisoryState = advisoryInput ?? null;
  const status = advisoryState?.status ?? 'none';
  const recommendationEffect = advisoryState?.recommendation_effect ?? 'none';

  if (status === 'none') {
    return {
      status: 'none',
      recommendation_effect: 'none',
      can_recommend: true,
      reasons: ['advisory.none'],
      explanation: 'No active advisory is recorded for this component.',
    };
  }

  if (recommendationEffect === 'exclude') {
    return {
      status,
      recommendation_effect: recommendationEffect,
      can_recommend: false,
      reasons: ['advisory.exclude'],
      explanation: `The component carries an active ${status} advisory and is excluded from recommendation by policy.`,
    };
  }

  if (recommendationEffect === 'suppress_default') {
    return {
      status,
      recommendation_effect: recommendationEffect,
      can_recommend: false,
      reasons: ['advisory.suppress_default'],
      explanation: `The component carries an active ${status} advisory and default recommendation is suppressed by policy.`,
    };
  }

  if (recommendationEffect === 'warn') {
    return {
      status,
      recommendation_effect: recommendationEffect,
      can_recommend: true,
      reasons: ['advisory.warn'],
      explanation: `The component carries an active ${status} advisory; show a warning before recommending it.`,
    };
  }

  return {
    status,
    recommendation_effect: 'none',
    can_recommend: true,
    reasons: ['advisory.recorded'],
    explanation: `The component carries an active ${status} advisory, but no policy effect is configured.`,
  };
};

export const evaluateComponentCompatibility = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput = {},
): ComponentCompatibilityResult => {
  const requiredChecks = inferRequiredChecks(component, context);

  const checkNames: readonly CompatibilityCheckName[] =
    requiredChecks.length > 0 ? requiredChecks : [];

  const checks: Record<string, CompatibilityCheckResult> = {
    voltage: evaluateVoltageCheck(component, { ...context, requiredChecks: checkNames }),
    current: evaluateCurrentCheck(component, { ...context, requiredChecks: checkNames }),
    power: evaluatePowerCheck(component, { ...context, requiredChecks: checkNames }),
    interface: evaluateInterfaceCheck(component, { ...context, requiredChecks: checkNames }),
    accessory: evaluateAccessoryCheck(component, { ...context, requiredChecks: checkNames }),
    converter: evaluateConverterCheck(component, { ...context, requiredChecks: checkNames }),
    fit: evaluateFitCheck(component, { ...context, requiredChecks: checkNames }),
    weight: evaluateWeightCheck(component, { ...context, requiredChecks: checkNames }),
  };

  const requiredResults = Object.values(checks).filter((check) => check.required);
  const allReasons = requiredResults.flatMap((result) => result.reasons);
  const explanations = requiredResults
    .map((result) => result.explanation)
    .filter((entry) => entry.length > 0);

  let overallStatus: CompatibilityStatus = 'compatible';
  if (requiredResults.some((result) => result.status === 'incompatible')) {
    overallStatus = 'incompatible';
  } else if (requiredResults.some((result) => result.status === 'unknown')) {
    overallStatus = 'unknown';
  }

  return {
    status: overallStatus,
    overall: {
      status: overallStatus,
      reasons: allReasons,
      explanation:
        overallStatus === 'incompatible'
          ? 'At least one required engineering compatibility check is incompatible.'
          : overallStatus === 'unknown'
            ? 'At least one required engineering compatibility check is unknown, and no required check is incompatible.'
            : 'All required engineering compatibility checks passed.',
    },
    checks,
    reasons: allReasons,
    explanations,
    advisory: evaluateAdvisoryState(component, context.advisoryEvaluation ?? null),
  };
};

export const listComponentCompatibilityChecks = (): readonly CompatibilityCheckName[] =>
  ['voltage', 'current', 'power', 'interface', 'accessory', 'converter', 'fit', 'weight'] as const;

export const componentCompatibilityStatusFor = (
  component: ComponentLibraryRecord,
  context: ComponentCompatibilityEvaluationInput = {},
): CompatibilityStatus => evaluateComponentCompatibility(component, context).status;

export const readComponentSchema = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(componentSchema));
