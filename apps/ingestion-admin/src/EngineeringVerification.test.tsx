import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineeringVerification } from './EngineeringVerification.js';
afterEach(cleanup);
const preview = {
  record: { id: 'synthetic', verification_status: 'unverified', unknown_assertion: null },
  snapshot: `sha256:${'a'.repeat(64)}`,
  content_digest: `sha256:${'b'.repeat(64)}`,
  current: false,
};
describe('explicit engineering verification UI', () => {
  it('performs no authority action on render or preview and requires separate human intent', async () => {
    const client = {
      preview: vi.fn().mockResolvedValue(preview),
      verify: vi.fn().mockResolvedValue({ ...preview, current: true }),
    };
    render(<EngineeringVerification jobId="synthetic-job" client={client} />);
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.verify).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Load canonical content for verification' }),
    );
    const button = await screen.findByRole('button', {
      name: 'Record explicit engineering verification',
    });
    expect(button).toBeDisabled();
    expect(client.verify).not.toHaveBeenCalled();
    expect(screen.getByText(/operator-supplied and unauthenticated/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Verifier operator label'), {
      target: { value: 'Local label' },
    });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await waitFor(() =>
      expect(client.verify).toHaveBeenCalledWith('synthetic-job', preview.snapshot, 'Local label'),
    );
    expect(await screen.findByText(/verified for this exact content/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it('invalidates intent on stale verification and requires a fresh load and confirmation', async () => {
    const client = {
      preview: vi.fn().mockResolvedValue(preview),
      verify: vi.fn().mockRejectedValue(new Error('Canonical verification snapshot is stale.')),
    };
    render(<EngineeringVerification jobId="synthetic-job" client={client} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Load canonical content for verification' }),
    );
    await screen.findByRole('checkbox');
    fireEvent.change(screen.getByLabelText('Verifier operator label'), {
      target: { value: 'Local label' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Record explicit engineering verification' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('stale');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(client.verify).toHaveBeenCalledTimes(1);
  });
});
