import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateAdvisoryState,
  evaluateComponentCompatibility,
  normalizeComponentLibraryRecord,
  parseComponentLibraryText,
  validateComponentLibraryRecord,
  type ComponentLibraryRecord,
} from '../src/index.js';
import { loadComponentLibraryFile } from '../src/component-library-loader.js';

const baseComponent = {
  id: 'synthetic.dc-distribution',
  manufacturer: 'Synthetic Labs',
  model: 'DC-24',
  category: 'distribution',
  verification_status: 'unverified',
  source_type: 'synthetic',
  source_refs: [
    {
      id: 'source-1',
      title: 'Synthetic source fixture',
      type: 'experimental',
      uri: 'https://example.invalid/source-1',
      manufacturer_document_id: 'SL-DC-24',
      date_checked: '2025-01-15',
    },
  ],
  electrical: {
    nominal_voltage_v: 24,
    input_voltage_range_v: { min: 20, max: 28 },
    output_voltage_range_v: { min: 11, max: 15 },
    continuous_current_a: 40,
    continuous_power_w: 960,
    apparent_power_va: 1000,
    ac_output_voltage_v: 12,
  },
  dimensions_mm: { x: 120, y: 80, z: 40 },
  weight_kg: 4.2,
  interfaces: ['dc-input', 'rs485'],
  required_accessories: [{ id: 'accessory.fuse-block', label: 'Fuse block' }],
  required_converters: [{ id: 'converter.dc-dc-boost', label: 'Boost converter' }],
  advisory_refs: [{ id: 'advisory-1', title: 'Synthetic advisory', type: 'policy_reference' }],
} satisfies ComponentLibraryRecord;

describe('component library ingestion and compatibility checks', () => {
  it('validates a JSON component record', () => {
    const result = validateComponentLibraryRecord(baseComponent);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('synthetic.dc-distribution');
    }
  });

  it('validates a YAML component record', () => {
    const yaml = `
id: synthetic.yaml-bus
manufacturer: Synthetic Labs
model: YAML-24
category: busbar
verification_status: partially_verified
source_type: synthetic
source_refs:
  - id: source-yaml
    title: Synthetic YAML source
    type: manufacturer
    uri: https://example.invalid/source-yaml
    manufacturer_document_id: SL-YAML-24
    date_checked: "2025-02-15"
electrical:
  nominal_voltage_v: 24
  input_voltage_range_v:
    min: 20
    max: 28
  output_voltage_range_v:
    min: 11
    max: 13
  continuous_current_a: 30
  continuous_power_w: 720
  apparent_power_va: 800
  ac_output_voltage_v: 12
interfaces: ["dc-input", "canbus"]
required_accessories:
  - id: accessory.fuse-block
    label: Fuse block
required_converters: []
`;

    const result = parseComponentLibraryText(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.model).toBe('YAML-24');
      expect(result.value.source_refs?.[0]?.manufacturer_document_id).toBe('SL-YAML-24');
    }
  });

  it('rejects invalid schema records', () => {
    const result = validateComponentLibraryRecord({
      id: 'invalid',
      manufacturer: 123,
      model: 'bad',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('manufacturer');
    }
  });

  it('rejects reversed or malformed engineering values', () => {
    const reversedRange = validateComponentLibraryRecord({
      ...baseComponent,
      electrical: {
        ...baseComponent.electrical,
        input_voltage_range_v: { min: 28, max: 20 },
      },
    });
    const negativeLimit = validateComponentLibraryRecord({
      ...baseComponent,
      electrical: {
        ...baseComponent.electrical,
        continuous_power_w: -10,
      },
    });
    const negativeDimension = validateComponentLibraryRecord({
      ...baseComponent,
      dimensions_mm: { x: -1, y: 80, z: 40 },
    });

    expect(reversedRange.ok).toBe(false);
    expect(negativeLimit.ok).toBe(false);
    expect(negativeDimension.ok).toBe(false);

    if (!reversedRange.ok) {
      expect(reversedRange.errors.join(' ')).toContain('min must be less than or equal to max');
    }
  });

  it('marks voltage compatibility as compatible when the target fits the operating range', () => {
    const result = evaluateComponentCompatibility(baseComponent, {
      systemVoltageV: 24,
      requiredChecks: ['voltage'],
    });
    expect(result.status).toBe('compatible');
    expect(result.checks.voltage.status).toBe('compatible');
  });

  it('marks voltage compatibility as incompatible when the target falls outside the input range', () => {
    const result = evaluateComponentCompatibility(baseComponent, {
      systemVoltageV: 32,
      requiredChecks: ['voltage'],
    });

    expect(result.status).toBe('incompatible');
    expect(result.checks.voltage.status).toBe('incompatible');
    expect(result.checks.voltage.reasons).toContain('voltage.system.range.mismatch');
  });

  it('marks voltage compatibility as unknown when critical input-range data is missing', () => {
    const component = {
      ...baseComponent,
      electrical: {
        ...baseComponent.electrical,
        input_voltage_range_v: null,
        nominal_voltage_v: null,
      },
    } as ComponentLibraryRecord;
    const result = evaluateComponentCompatibility(component, {
      systemVoltageV: 24,
      requiredChecks: ['voltage'],
    });

    expect(result.status).toBe('unknown');
    expect(result.checks.voltage.status).toBe('unknown');
    expect(result.checks.voltage.reasons).toContain('voltage.system.missing_range_data');
  });

  it('evaluates real power and apparent power independently', () => {
    const wFailsVaPasses = evaluateComponentCompatibility(baseComponent, {
      requiredPowerW: 1200,
      requiredApparentPowerVa: 500,
      requiredChecks: ['power'],
    });
    const vaFailsWPasses = evaluateComponentCompatibility(baseComponent, {
      requiredPowerW: 400,
      requiredApparentPowerVa: 1500,
      requiredChecks: ['power'],
    });

    expect(wFailsVaPasses.checks.power.status).toBe('incompatible');
    expect(vaFailsWPasses.checks.power.status).toBe('incompatible');
  });

  it('returns unknown when one required power dimension is missing unless another already fails', () => {
    const missingLimit = evaluateComponentCompatibility(
      {
        ...baseComponent,
        electrical: {
          ...baseComponent.electrical,
          continuous_power_w: null,
        },
      } as ComponentLibraryRecord,
      {
        requiredPowerW: 400,
        requiredApparentPowerVa: 500,
        requiredChecks: ['power'],
      },
    );
    const anotherAlreadyFails = evaluateComponentCompatibility(baseComponent, {
      requiredPowerW: 2000,
      requiredApparentPowerVa: 500,
      requiredChecks: ['power'],
    });

    expect(missingLimit.checks.power.status).toBe('unknown');
    expect(anotherAlreadyFails.checks.power.status).toBe('incompatible');
  });

  it('evaluates input and output voltage separately', () => {
    const match = evaluateComponentCompatibility(baseComponent, {
      systemVoltageV: 24,
      outputVoltageV: 12,
      requiredChecks: ['voltage'],
    });
    const outputMismatch = evaluateComponentCompatibility(baseComponent, {
      systemVoltageV: 24,
      outputVoltageV: 24,
      requiredChecks: ['voltage'],
    });

    expect(match.checks.voltage.status).toBe('compatible');
    expect(outputMismatch.checks.voltage.status).toBe('incompatible');
    expect(outputMismatch.checks.voltage.reasons).toContain('voltage.output.range.mismatch');
  });

  it('supports a 24V input / 12V output converter-style synthetic fixture', () => {
    const converter = {
      ...baseComponent,
      electrical: {
        ...baseComponent.electrical,
        nominal_voltage_v: 24,
        input_voltage_range_v: { min: 20, max: 28 },
        output_voltage_range_v: { min: 11, max: 13 },
        ac_output_voltage_v: 12,
      },
    } as ComponentLibraryRecord;

    const compatible = evaluateComponentCompatibility(converter, {
      systemVoltageV: 24,
      outputVoltageV: 12,
      requiredChecks: ['voltage'],
    });
    const incompatible = evaluateComponentCompatibility(converter, {
      systemVoltageV: 24,
      outputVoltageV: 24,
      requiredChecks: ['voltage'],
    });

    expect(compatible.checks.voltage.status).toBe('compatible');
    expect(incompatible.checks.voltage.status).toBe('incompatible');
  });

  it('preserves uncertainty when only nominal voltage data is available', () => {
    const nominalOnly = {
      ...baseComponent,
      electrical: {
        ...baseComponent.electrical,
        input_voltage_range_v: null,
        output_voltage_range_v: null,
      },
    } as ComponentLibraryRecord;

    const result = evaluateComponentCompatibility(nominalOnly, {
      systemVoltageV: 24,
      requiredChecks: ['voltage'],
    });

    expect(result.checks.voltage.status).toBe('unknown');
    expect(result.checks.voltage.reasons).toContain('voltage.system.nominal_only');
    expect(result.checks.voltage.explanation).toContain('no verified operating range');
  });

  it('omits unrelated checks when requiredChecks is not supplied', () => {
    const result = evaluateComponentCompatibility(baseComponent, {
      systemVoltageV: 24,
      requiredPowerW: 400,
      requiredCurrentA: 15,
    });

    expect(result.checks.voltage.required).toBe(true);
    expect(result.checks.current.required).toBe(true);
    expect(result.checks.power.required).toBe(true);
    expect(result.checks.interface.required).toBe(false);
    expect(result.checks.fit.required).toBe(false);
    expect(result.checks.weight.required).toBe(false);
  });

  it('still forces explicitly requested checks even when not inferred', () => {
    const result = evaluateComponentCompatibility(baseComponent, {
      requiredChecks: ['fit'],
    });

    expect(result.checks.fit.required).toBe(true);
    expect(result.checks.fit.status).toBe('unknown');
  });

  it.each([
    ['compatible', ['dc-input', 'rs485'], ['dc-input'], 'compatible'],
    ['incompatible', ['dc-input'], ['dc-input', 'canbus'], 'incompatible'],
    ['unknown', [], ['canbus'], 'unknown'],
  ])(
    'evaluates interface compatibility with %s inputs',
    (_label, present, required, expectedStatus) => {
      const component = {
        ...baseComponent,
        interfaces: present,
      } as ComponentLibraryRecord;

      const result = evaluateComponentCompatibility(component, {
        requiredInterfaces: required,
      });

      expect(result.checks.interface.status).toBe(expectedStatus);
    },
  );

  it('matches stable accessory and converter IDs deterministically', () => {
    const present = evaluateComponentCompatibility(baseComponent, {
      installedAccessories: [{ id: 'accessory.fuse-block', label: 'Fuse block' }],
      installedConverters: [{ id: 'converter.dc-dc-boost', label: 'Boost converter' }],
      requiredChecks: ['accessory', 'converter'],
    });

    expect(present.checks.accessory.status).toBe('compatible');
    expect(present.checks.converter.status).toBe('compatible');
  });

  it('does not match labels when stable IDs differ', () => {
    const mismatched = evaluateComponentCompatibility(baseComponent, {
      installedAccessories: [{ id: 'accessory.other-fuse', label: 'Fuse block' }],
      requiredChecks: ['accessory'],
    });

    expect(mismatched.checks.accessory.status).toBe('incompatible');
    expect(mismatched.checks.accessory.reasons).toContain('accessory.missing_required_accessory');
  });

  it('treats physical fit partial envelopes as unknown instead of incompatible', () => {
    const result = evaluateComponentCompatibility(baseComponent, {
      installationEnvelopeMm: { x: 200, y: 120 },
      requiredChecks: ['fit'],
    });

    expect(result.checks.fit.status).toBe('unknown');
    expect(result.checks.fit.reasons).toContain('fit.missing_installed_envelope');
  });

  it('does not assume identity orientation when evaluating fit', () => {
    const result = evaluateComponentCompatibility(baseComponent, {
      installationEnvelopeMm: { x: 200, y: 120, z: 50 },
      requiredChecks: ['fit'],
    });
    expect(result.checks.fit.status).toBe('unknown');
    expect(result.checks.fit.reasons).toContain('fit.missing_installed_envelope');
  });

  it('evaluates fit using an explicitly derived installed envelope', () => {
    const result = evaluateComponentCompatibility(baseComponent, {
      installationEnvelopeMm: { x: 200, y: 120, z: 50 },
      installedEnvelopeMm: { world_x: 120, world_y: 80, world_z: 40 },
      requiredChecks: ['fit'],
    });
    expect(result.checks.fit.status).toBe('compatible');
  });

  it('keeps advisory linkage separate from engineering compatibility results', () => {
    const derived = evaluateAdvisoryState(baseComponent, {
      status: 'watch',
      recommendation_effect: 'warn',
      summary: 'Visible warning only',
    });
    const compatible = evaluateComponentCompatibility(baseComponent, {
      systemVoltageV: 24,
      requiredChecks: ['voltage'],
    });

    expect(derived.can_recommend).toBe(true);
    expect(compatible.advisory.status).toBe('none');
  });

  it('preserves provenance and verification fields through loading', () => {
    const parsed = parseComponentLibraryText(JSON.stringify(baseComponent));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.verification_status).toBe('unverified');
    expect(parsed.value.source_type).toBe('synthetic');
    expect(parsed.value.source_refs?.[0]?.manufacturer_document_id).toBe('SL-DC-24');
    expect(parsed.value.source_refs?.[0]?.date_checked).toBe('2025-01-15');
    expect(parsed.value.advisory_refs?.[0]?.id).toBe('advisory-1');
  });

  it('loads a file in JSON format and preserves normalized fields using a portable temp path', async () => {
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'component-library-'));
    const filePath = path.join(tempDir, 'component.json');
    await fs.writeFile(filePath, JSON.stringify(baseComponent, null, 2), 'utf8');

    const result = await loadComponentLibraryFile(filePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('synthetic.dc-distribution');
      expect(result.value.interfaces).toEqual(['dc-input', 'rs485']);
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('remains deterministic for repeated compatibility evaluation', () => {
    const first = evaluateComponentCompatibility(baseComponent, {
      systemVoltageV: 24,
      requiredCurrentA: 20,
      requiredPowerW: 480,
      requiredApparentPowerVa: 500,
      requiredInterfaces: ['dc-input'],
      requiredChecks: ['voltage', 'current', 'power', 'interface'],
    });

    expect(first).toEqual(
      evaluateComponentCompatibility(baseComponent, {
        systemVoltageV: 24,
        requiredCurrentA: 20,
        requiredPowerW: 480,
        requiredApparentPowerVa: 500,
        requiredInterfaces: ['dc-input'],
        requiredChecks: ['voltage', 'current', 'power', 'interface'],
      }),
    );
  });

  it('normalizes required field arrays without mutating the source record', () => {
    const original = JSON.parse(JSON.stringify(baseComponent));
    const normalized = normalizeComponentLibraryRecord(original);
    expect(normalized.required_accessories).toEqual([
      { id: 'accessory.fuse-block', label: 'Fuse block' },
    ]);
    expect(original.required_accessories).toEqual([
      { id: 'accessory.fuse-block', label: 'Fuse block' },
    ]);
  });

  it('accepts a typed product role and product family without affecting compatibility', () => {
    const component = {
      ...baseComponent,
      product_role: 'battery',
      product_family: 'house-bank',
    } as ComponentLibraryRecord;

    const validation = validateComponentLibraryRecord(component);
    expect(validation.ok).toBe(true);

    const result = evaluateComponentCompatibility(component, {
      systemVoltageV: 24,
      requiredChecks: ['voltage'],
    });
    expect(result.status).toBe('compatible');
  });

  it('retains distinct current fields, battery data, and metadata without changing legacy behavior', () => {
    const component = {
      ...baseComponent,
      product_role: 'battery',
      product_family: 'house-bank',
      efficiency_fraction: 0.96,
      electrical: {
        ...baseComponent.electrical,
        continuous_current_a: 80,
        continuous_input_current_a: 35,
        continuous_output_current_a: 30,
        peak_input_current_a: 70,
        peak_output_current_a: 60,
        continuous_charge_current_a: 25,
        continuous_discharge_current_a: 40,
        peak_discharge_current_a: 80,
        continuous_power_w: 960,
        apparent_power_va: 1200,
      },
      battery: {
        nominal_capacity_ah: 100,
        usable_capacity_ah: 90,
        nominal_energy_wh: 2400,
        allowed_series_count: { min: 1, max: 2 },
        allowed_parallel_count: { min: 1, max: 4 },
      },
      terminals: [
        {
          function: 'battery',
          type: 'stud',
          designation: 'M8',
          polarity: 'positive',
          notes: 'primary negative',
        },
      ],
      service_clearances_mm: { front: 100, rear: 150, left: 80, right: 80, top: 160, bottom: 120 },
      orientation_constraint: 'manufacturer_defined',
    } as ComponentLibraryRecord;

    const validation = validateComponentLibraryRecord(component);
    expect(validation.ok).toBe(true);

    if (validation.ok) {
      expect(validation.value.electrical?.continuous_input_current_a).toBe(35);
      expect(validation.value.electrical?.continuous_output_current_a).toBe(30);
      expect(validation.value.electrical?.peak_input_current_a).toBe(70);
      expect(validation.value.electrical?.peak_output_current_a).toBe(60);
      expect(validation.value.electrical?.continuous_charge_current_a).toBe(25);
      expect(validation.value.electrical?.continuous_discharge_current_a).toBe(40);
      expect(validation.value.electrical?.peak_discharge_current_a).toBe(80);
      expect(validation.value.battery?.nominal_capacity_ah).toBe(100);
      expect(validation.value.battery?.allowed_parallel_count).toEqual({ min: 1, max: 4 });
      expect(validation.value.efficiency_fraction).toBe(0.96);
      expect(validation.value.terminals?.[0]?.function).toBe('battery');
      expect(validation.value.service_clearances_mm?.front).toBe(100);
      expect(validation.value.orientation_constraint).toBe('manufacturer_defined');
    }
  });

  it('rejects legacy battery BMS metadata and legacy clearances fields', () => {
    const legacyBms = validateComponentLibraryRecord({
      ...baseComponent,
      battery: {
        ...baseComponent.battery,
        bms_limits: { max_charge_current_a: 40 },
      },
    });
    const legacyClearances = validateComponentLibraryRecord({
      ...baseComponent,
      clearances_mm: { front: 200, rear: 100 },
    });

    expect(legacyBms.ok).toBe(false);
    expect(legacyClearances.ok).toBe(false);
  });

  it('rejects invalid efficiency values', () => {
    const tooLow = validateComponentLibraryRecord({
      ...baseComponent,
      efficiency_fraction: 0,
    });
    const tooHigh = validateComponentLibraryRecord({
      ...baseComponent,
      efficiency_fraction: 1.5,
    });

    expect(tooLow.ok).toBe(false);
    expect(tooHigh.ok).toBe(false);
  });

  it('validates battery ranges and rejects malformed ranges', () => {
    const valid = validateComponentLibraryRecord({
      ...baseComponent,
      battery: {
        nominal_capacity_ah: 100,
        usable_capacity_ah: 90,
        nominal_energy_wh: 2400,
        allowed_series_count: { min: 1, max: 2 },
        allowed_parallel_count: { min: 1, max: 3 },
      },
    });
    const malformed = validateComponentLibraryRecord({
      ...baseComponent,
      battery: {
        allowed_series_count: { min: 3, max: 2 },
      },
    });

    expect(valid.ok).toBe(true);
    expect(malformed.ok).toBe(false);
  });

  it('validates structured terminals and rejects malformed function or polarity', () => {
    const valid = validateComponentLibraryRecord({
      ...baseComponent,
      terminals: [{ function: 'dc_input', type: 'stud', designation: 'M8', polarity: 'positive' }],
    });

    const badFunction = validateComponentLibraryRecord({
      ...baseComponent,
      terminals: [{ function: 'not_a_real_function' }],
    });
    const badPolarity = validateComponentLibraryRecord({
      ...baseComponent,
      terminals: [{ function: 'dc_output', polarity: 'left' }],
    });

    expect(valid.ok).toBe(true);
    expect(badFunction.ok).toBe(false);
    expect(badPolarity.ok).toBe(false);
  });

  it('supports optional stable terminal IDs and rejects duplicates', () => {
    const valid = validateComponentLibraryRecord({
      ...baseComponent,
      terminals: [
        { id: 'positive', function: 'battery', polarity: 'positive' },
        { id: 'negative', function: 'battery', polarity: 'negative' },
      ],
    });
    const duplicate = validateComponentLibraryRecord({
      ...baseComponent,
      terminals: [
        { id: 'battery', function: 'battery', polarity: 'positive' },
        { id: 'battery', function: 'battery', polarity: 'negative' },
      ],
    });

    expect(valid.ok).toBe(true);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors.join(' ')).toContain('duplicates terminal ID');
  });

  it('validates service clearances and orientation constraints', () => {
    const valid = validateComponentLibraryRecord({
      ...baseComponent,
      service_clearances_mm: { front: 200, rear: 100, left: 80, right: 80, top: 120, bottom: 80 },
      orientation_constraint: 'manufacturer_defined',
    });
    const invalidClearance = validateComponentLibraryRecord({
      ...baseComponent,
      service_clearances_mm: { front: -10 },
    });
    const invalidOrientation = validateComponentLibraryRecord({
      ...baseComponent,
      orientation_constraint: 'diagonal',
    });
    const negativeLegacyClearance = validateComponentLibraryRecord({
      ...baseComponent,
      service_clearances_mm: { front: -1 },
    });

    expect(valid.ok).toBe(true);
    expect(invalidClearance.ok).toBe(false);
    expect(invalidOrientation.ok).toBe(false);
    expect(negativeLegacyClearance.ok).toBe(false);
  });

  it('keeps W and VA independent even when the new fields are present', () => {
    const component = {
      ...baseComponent,
      electrical: {
        ...baseComponent.electrical,
        continuous_power_w: 960,
        apparent_power_va: 1200,
      },
    } as ComponentLibraryRecord;

    const result = evaluateComponentCompatibility(component, {
      requiredPowerW: 1000,
      requiredApparentPowerVa: 1000,
      requiredChecks: ['power'],
    });

    expect(result.checks.power.status).toBe('incompatible');
    expect(result.checks.power.reasons).toContain('power.real_power.limit_exceeded');
  });

  it('preserves previous behavior when the new fields are omitted', () => {
    const result = validateComponentLibraryRecord(baseComponent);
    expect(result.ok).toBe(true);
  });
});
