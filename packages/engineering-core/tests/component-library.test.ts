import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateAdvisoryState,
  evaluateComponentCompatibility,
  loadComponentLibraryFile,
  normalizeComponentLibraryRecord,
  parseComponentLibraryText,
  validateComponentLibraryRecord,
  type ComponentLibraryRecord,
} from '../src/index.js';

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
    expect(result.checks.fit.reasons).toContain('fit.partial_envelope');
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
});
