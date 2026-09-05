import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from './App.js';

afterEach(() => {
  cleanup();
});

describe('configurator app', () => {
  it('renders eligible candidates for a generic evaluation', () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText('24 V'));
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(screen.getByText(/recommended \/ eligible/i)).toBeInTheDocument();
    expect(screen.getByText(/eligible standard/i)).toBeInTheDocument();
  });

  it('blocks incomplete forms before invoking the engine', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/select a system voltage/i);
  });

  it('requires a builder profile when builder-specific mode is enabled', () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText('24 V'));
    fireEvent.click(screen.getByRole('radio', { name: /builder-specific/i }));
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      /choose a builder profile when builder-specific mode is enabled/i,
    );
    expect(screen.queryByText(/recommended \/ eligible/i)).not.toBeInTheDocument();
  });
});
