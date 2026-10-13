import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EngineeringPreparation } from './EngineeringPreparation.js';
import { solarFixture } from '../../../packages/engineering-core/tests/fixtures/engineering-envelope.js';

describe('Provisional engineering profile editor/read-model', () => {
  it('shows original units, evidence, assumptions and clears stale preview on edits', () => {
    render(<EngineeringPreparation />);
    const x = solarFixture();
    fireEvent.change(screen.getByLabelText('Proposed engineering profile JSON'), {
      target: { value: JSON.stringify(x.profiles[0]) },
    });
    fireEvent.change(screen.getByLabelText('Optional explicit installed scenario JSON'), {
      target: { value: JSON.stringify(x) },
    });
    fireEvent.click(screen.getByText('Validate and preview proposal'));
    expect(screen.getByText('Selected envelope: ELIGIBLE')).toBeTruthy();
    expect(screen.getByText(/private byte replay still required/)).toBeTruthy();
    expect(screen.getByText(/controlled_synthetic/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Proposed engineering profile JSON'), {
      target: { value: '{}' },
    });
    expect(screen.queryByText('Selected envelope: ELIGIBLE')).toBeNull();
    fireEvent.click(screen.getByText('Validate and preview proposal'));
    expect(screen.getByRole('alert')).toBeTruthy();
    cleanup();
  });
});
