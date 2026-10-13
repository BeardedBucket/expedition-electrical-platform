import { describe, expect, it } from 'vitest';
import { productionSemanticFieldDescriptors } from '../../../packages/ingestion/src/field-mapping.js';
import { reviewerProperties, searchEligibleProperties } from './ReviewerProperties.js';

describe('reviewer property presentation contract', () => {
  it('covers every real direct-review target without inventing a target or qualified-only permission', () => {
    const descriptors = productionSemanticFieldDescriptors();
    expect(Object.keys(reviewerProperties).sort()).toEqual(
      descriptors.map((target) => target.canonical_field).sort(),
    );
    for (const target of descriptors) {
      const presentation = reviewerProperties[target.canonical_field];
      expect(presentation.label).toBeTruthy();
      expect(presentation.description).toBeTruthy();
      expect(presentation.distinction).toBeTruthy();
      expect(presentation.terms).toBeTruthy();
      expect(target.dimension).toBeTruthy();
      expect(target.unit).toBeTruthy();
      expect(target.human_adjudication).toBe('source_fact');
    }
    expect(reviewerProperties['electrical.power_consumption_w']).toBeUndefined();
  });
  it('searches ordinary terms only within server eligible descriptors', () => {
    const descriptors = productionSemanticFieldDescriptors();
    const eligible = descriptors.filter(
      (target) => target.canonical_field === 'electrical.continuous_output_current_a',
    );
    expect(
      searchEligibleProperties(eligible, 'output amps').map((target) => target.canonical_field),
    ).toEqual(['electrical.continuous_output_current_a']);
    expect(searchEligibleProperties(eligible, 'input')).toEqual([]);
    expect(searchEligibleProperties([], '')).toEqual([]);
    expect(
      searchEligibleProperties(descriptors, 'surge').every((target) =>
        target.canonical_field.includes('peak'),
      ),
    ).toBe(true);
    expect(reviewerProperties['electrical.apparent_power_va'].distinction).toContain('watts');
    expect(reviewerProperties['dimensions_mm'].distinction).toContain('clearance');
  });
});
