import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HumanSourceEditor } from './HumanSourceEditor.js';
import { CorrectionRecord } from './CorrectionRecord.js';
import { OperatorApiError, api, type OperatorApi, type OperatorJobDetail } from './api.js';
import { createDemoController, demoScenarios } from '../demo/scenarios.js';
import { productionSemanticFieldDescriptors } from '../../../packages/ingestion/src/field-mapping.js';
afterEach(cleanup);
const target = 'electrical.continuous_input_current_a';
const descriptor = productionSemanticFieldDescriptors().find((t) => t.canonical_field === target)!;
const source = 'Example Model continuous input current 500 mA';
function show(overrides: Partial<OperatorApi> = {}, existing = false, withSuggestion = false) {
  const controller = createDemoController(demoScenarios.find((s) => s.id === 'scalar')!);
  const job = {
    ...controller.current(),
    human_adjudication: {
      editable: true,
      documents: [
        {
          id: 'document.test',
          title: 'Controlled source',
          block_count: 1,
          source_uri: 'https://example.test/source',
        },
      ],
      history: [],
      ...(withSuggestion
        ? {
            profile_suggestions: [
              {
                authority: 'unreviewed_source_suggestion',
                missing: ['human_source_decision'],
                replaces_fact_ids: ['existing.fact'],
                statement: {
                  label: 'Open-Circuit Voltage (Voc)',
                  value: '26V',
                  wording: 'Open-Circuit Voltage (Voc) 26V',
                  citations: [
                    {
                      document_id: 'document.test',
                      block_id: 'owned.row',
                      quote: 'Complete invented source-owned row with context',
                    },
                  ],
                  applicability: {
                    relationship: 'source_record',
                    citation: {
                      document_id: 'document.test',
                      block_id: 'owned.row',
                      quote: 'Complete invented source-owned row with context',
                    },
                  },
                  mapping: {
                    kind: 'engineering_profile_fact',
                    target: 'engineering_profile',
                    quantity: 'voc_v',
                  },
                },
              },
            ],
          }
        : {}),
      archived_history: undefined,
      original_observations: existing
        ? [
            {
              id: 'existing.fact',
              label: 'Input current',
              value: '500',
              unit: 'mA',
              wording: source,
            },
          ]
        : [],
      correction_records: existing
        ? [
            {
              fact_id: 'existing.fact',
              origin: 'automatic' as const,
              source_ready: true,
              warning: undefined,
              statement: {
                label: 'Input current',
                value: '500',
                unit: 'mA',
                wording: source,
                citations: [
                  { document_id: 'document.test', block_id: 'block.source', quote: source },
                ],
                applicability: {
                  relationship: 'statement' as const,
                  citation: {
                    document_id: 'document.test',
                    block_id: 'block.source',
                    quote: source,
                  },
                },
              },
            },
          ]
        : [],
    },
  } as OperatorJobDetail;
  const client = {
    ...api,
    humanEvidence: vi.fn().mockResolvedValue({
      document_id: 'document.test',
      total: 1,
      offset: 0,
      entries: [
        {
          document_id: 'document.test',
          block_id: 'block.source',
          text: source,
          kind: 'text',
          locator: { kind: 'generic' },
        },
      ],
    }),
    humanProperties: vi.fn().mockResolvedValue({ proposal_id: 'source', targets: [descriptor] }),
    humanPreview: vi.fn().mockResolvedValue({
      version: 'human-adjudication.v1',
      input_digest: 'server.digest',
      disposition: 'ready',
      assertions: [],
      candidate: { electrical: { continuous_input_current_a: 0.5 } },
      non_projected: [],
    }),
    humanAdjudication: vi.fn().mockResolvedValue(job),
    ...overrides,
  } as OperatorApi;
  const onSaved = vi.fn();
  render(
    <HumanSourceEditor
      job={job}
      client={client}
      reviewer="Reviewer"
      factIds={existing ? ['existing.fact'] : []}
      onSaved={onSaved}
      onDirty={vi.fn()}
      onBusy={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { job, client, onSaved };
}
async function fill() {
  fireEvent.change(screen.getByLabelText('What needs correcting?'), { target: { value: 'add' } });
  fireEvent.click(
    await screen.findByRole('button', { name: /Example Model continuous input current 500 mA/ }),
  );
  fireEvent.click(screen.getByLabelText('Value or original statement'));
  fireEvent.click(screen.getByLabelText('Model or part-number relationship'));
  fireEvent.click(screen.getByRole('button', { name: 'Use selected evidence' }));
  fireEvent.change(screen.getByLabelText('Corrected source label (required)'), {
    target: { value: 'Continuous input current' },
  });
  fireEvent.change(screen.getByLabelText('Exact source value (required)'), {
    target: { value: '500' },
  });
  fireEvent.change(screen.getByLabelText('Source-stated unit'), { target: { value: 'mA' } });
  fireEvent.change(screen.getByLabelText('Model relationship (required)'), {
    target: { value: 'statement' },
  });
  fireEvent.change(screen.getByLabelText('Reason for correction (required)'), {
    target: { value: 'Exact-model source evidence supports this correction.' },
  });
  fireEvent.click(screen.getByLabelText('Also correct or assign engineering meaning'));
  fireEvent.change(screen.getByLabelText('Engineering representation'), {
    target: { value: 'scalar' },
  });
  await screen.findByRole('option', { name: 'Continuous input current · A' });
}
describe('human source correction workflow', () => {
  it('loads a complete unreviewed suggestion as an explicit correction without saving or discarding its source relationship', async () => {
    const { client } = show({}, false, true);
    fireEvent.click(screen.getByRole('button', { name: 'Use source suggestion for a correction' }));
    expect(screen.getByLabelText('Exact source value (required)')).toHaveValue('26V');
    expect(screen.getByLabelText('Model relationship (required)')).toHaveValue('source_record');
    expect(screen.getByLabelText('What needs correcting?')).toHaveValue('source');
    expect(client.humanAdjudication).not.toHaveBeenCalled();
    await waitFor(() => expect(client.humanProperties).toHaveBeenCalled());
    const request = vi.mocked(client.humanProperties).mock.calls.at(-1)![1];
    expect(request.intent.action).toBe('correct');
    expect(request.intent.replaces_fact_ids).toEqual(['existing.fact']);
    expect(request.intent.statements[0].citations[0].quote).toContain('with context');
    fireEvent.change(screen.getByLabelText('What needs correcting?'), { target: { value: 'add' } });
    expect(screen.getByLabelText('Exact source value (required)')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'source' },
    });
    expect(screen.getByLabelText('Exact source value (required)')).toHaveValue('26V');
  });
  it('requires an explicit profile quantity and reuses server source eligibility without a default target', async () => {
    const { client } = show();
    await fill();
    fireEvent.change(screen.getByLabelText('Engineering representation'), {
      target: { value: 'engineering_profile_fact' },
    });
    expect(screen.getByLabelText('Profile quantity')).toHaveValue('');
    expect(screen.getByLabelText('Engineering property')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Profile quantity'), { target: { value: 'voc_v' } });
    await waitFor(() =>
      expect(client.humanProperties).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          representation: { kind: 'engineering_profile_fact', quantity: 'voc_v' },
        }),
      ),
    );
    expect(screen.getByLabelText('Engineering property')).toHaveValue('');
  });
  it('reuses valid source values for interpretation-only correction with no hidden target', async () => {
    const { client } = show({}, true);
    expect(screen.getByRole('region', { name: 'Current record' })).toHaveTextContent('500');
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'engineering' },
    });
    await screen.findByRole('option', { name: 'Continuous input current · A' });
    expect(screen.getByLabelText('Engineering property')).toHaveValue('');
    expect(client.humanPreview).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Engineering property'), { target: { value: target } });
    await waitFor(() =>
      expect(client.humanPreview).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          intent: expect.objectContaining({
            rationale: '',
            statements: [
              expect.objectContaining({
                value: '500',
                wording: source,
                mapping: { kind: 'scalar', target },
              }),
            ],
          }),
        }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for correction (required)'), {
      target: {
        value: 'The automatic property was wrong; the original input statement is correct.',
      },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled(),
    );
  });
  it('preserves an existing-record draft while switching to a missed addition and back', () => {
    show({}, true);
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'source' },
    });
    fireEvent.change(screen.getByLabelText('Exact source value (required)'), {
      target: { value: '900' },
    });
    fireEvent.change(screen.getByLabelText('What needs correcting?'), { target: { value: 'add' } });
    expect(screen.getByLabelText('Exact source value (required)')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Exact source value (required)'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'source' },
    });
    expect(screen.getByLabelText('Exact source value (required)')).toHaveValue('900');
    fireEvent.change(screen.getByLabelText('What needs correcting?'), { target: { value: 'add' } });
    expect(screen.getByLabelText('Exact source value (required)')).toHaveValue('2');
  });
  it('source-only editing omits irrelevant property controls while model repair reuses values', () => {
    show({}, true);
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'source' },
    });
    expect(screen.queryByLabelText('Engineering property')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'model' },
    });
    expect(screen.getByLabelText('Model relationship (required)')).toHaveValue('statement');
    expect(screen.getByLabelText('Exact source value (required)')).toHaveValue('500');
  });
  it.each(['dropdown', 'inline', 'explorer'])(
    'uses the same current server preview from %s property selection',
    async (mode) => {
      const { client, onSaved } = show();
      await fill();
      if (mode === 'dropdown')
        fireEvent.change(screen.getByLabelText('Engineering property'), {
          target: { value: target },
        });
      else {
        if (mode === 'explorer')
          fireEvent.click(
            screen.getByRole('button', { name: 'Browse all engineering properties' }),
          );
        const context = mode === 'explorer' ? within(screen.getByRole('dialog')) : screen;
        fireEvent.click(context.getByRole('button', { name: 'Select Continuous input current' }));
      }
      await waitFor(() =>
        expect(client.humanPreview).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            intent: expect.objectContaining({
              statements: [expect.objectContaining({ mapping: { kind: 'scalar', target } })],
            }),
          }),
        ),
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      const request = vi.mocked(client.humanAdjudication).mock.calls[0][1];
      expect(request.intent).not.toHaveProperty('normalized_value');
      expect(request.intent.statements[0].value).toBe('500');
      expect(request.intent.statements[0].citations[0].quote).toBe(source);
    },
  );
  it('requires a source proof and preserves a draft without engineering eligibility', async () => {
    const { client } = show();
    fireEvent.change(screen.getByLabelText('What needs correcting?'), { target: { value: 'add' } });
    fireEvent.change(screen.getByLabelText('Corrected source label (required)'), {
      target: { value: 'Uncertain rating' },
    });
    fireEvent.change(screen.getByLabelText('Exact source value (required)'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByLabelText('Original manufacturer wording (required)'), {
      target: { value: 'Uncertain 500' },
    });
    fireEvent.change(screen.getByLabelText('Reason for correction (required)'), {
      target: { value: 'Extraction failed and scope remains unknown.' },
    });
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save unresolved draft' }));
    await waitFor(() =>
      expect(client.humanAdjudication).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ intent: expect.objectContaining({ disposition: 'draft' }) }),
      ),
    );
    expect(client.humanPreview).not.toHaveBeenCalled();
  });
  it('keeps the actual preview failure visible and retries the selected property', async () => {
    let failures = 0;
    const preview = vi.fn().mockImplementation(async (_id, request) => {
      if (request.intent.statements[0].mapping?.target === target && failures++ === 0)
        throw new OperatorApiError(400, 'Source measurement basis cannot be represented.');
      return {
        candidate: { electrical: { continuous_input_current_a: 0.5 } },
        assertions: [],
        non_projected: [],
      };
    });
    show({ humanPreview: preview });
    await fill();
    fireEvent.change(screen.getByLabelText('Engineering property'), { target: { value: target } });
    await screen.findByText(/Source measurement basis cannot be represented/);
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck source and selected property' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled(),
    );
    expect(failures).toBe(2);
  });
  it('ignores stale responses after source value changes and keeps entered data after failed save', async () => {
    const save = vi
      .fn()
      .mockRejectedValue(new OperatorApiError(409, 'Concurrent source correction; reload.'));
    show({ humanAdjudication: save });
    await fill();
    fireEvent.change(screen.getByLabelText('Engineering property'), { target: { value: target } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await screen.findByText(/Concurrent source correction/);
    expect(screen.getByLabelText('Exact source value (required)')).toHaveValue('500');
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('splits meaningful assertions rather than treating copied extraction fragments as separate specifications', async () => {
    show();
    fireEvent.change(screen.getByLabelText('What needs correcting?'), { target: { value: 'add' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add separate assertion' }));
    expect(
      screen
        .getByRole('navigation', { name: 'Corrected source assertions' })
        .querySelectorAll('button'),
    ).toHaveLength(3);
    expect(screen.getByLabelText('Corrected source label (required)')).toHaveValue('');
    expect(screen.getByText(/Changing the correction type preserves/)).toBeInTheDocument();
  });
  it('focuses the missing assertion instead of treating another row as complete', () => {
    show({}, true);
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'combined' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add separate assertion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Input current' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Complete the source statement and evidence' }),
    );
    expect(screen.getByLabelText('Corrected source label (required)')).toHaveValue('');
    expect(screen.getByLabelText('Corrected source label (required)')).toHaveFocus();
  });
  it('incomplete extraction has draft-specific readiness and no irrelevant mapping requirements', async () => {
    const { client } = show({}, true);
    fireEvent.change(screen.getByLabelText('What needs correcting?'), {
      target: { value: 'combined' },
    });
    fireEvent.change(screen.getByLabelText('How should these observations be repaired?'), {
      target: { value: 'incomplete' },
    });
    vi.mocked(client.humanPreview).mockClear();
    expect(
      screen.getByLabelText('Model relationship (optional for unresolved draft)'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Model relationship (required)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Engineering property')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Select an eligible engineering property' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason for correction (required)'), {
      target: { value: 'Segmentation and qualifier ownership need further source review.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save unresolved draft' }));
    await waitFor(() =>
      expect(client.humanAdjudication).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          intent: expect.objectContaining({ action: 'incomplete', disposition: 'draft' }),
        }),
      ),
    );
    expect(client.humanPreview).not.toHaveBeenCalled();
  });
  it('reopened human corrections expose original extraction and effective meaning before search', () => {
    const controller = createDemoController(
      demoScenarios.find((scenario) => scenario.id === 'scalar')!,
    );
    const item = structuredClone(controller.current().semantic_review!.work.required[0]);
    item.evidence[0].id = 'human.fact';
    const statement = {
      label: 'Corrected input current',
      value: '500',
      unit: 'mA',
      wording: source,
      citations: [],
      applicability: { relationship: 'unresolved' },
      mapping: { kind: 'scalar', target },
    };
    const current = {
      ...controller.current(),
      human_adjudication: {
        correction_records: [{ fact_id: 'human.fact', origin: 'human', statement }],
        history: [
          {
            intent: { group_id: 'group' },
            facts: [{ id: 'human.fact' }],
            original_fact_refs: [{ reference: 'original.fact' }],
          },
        ],
        original_observations: [
          { id: 'original.fact', label: 'Incorrect extraction', value: '900', unit: 'mA' },
        ],
      },
    } as unknown as OperatorJobDetail;
    render(<CorrectionRecord job={current} item={item} factIds={['human.fact']} />);
    expect(screen.getByRole('region', { name: 'Current record' })).toHaveTextContent(
      'Original automatic extraction: Incorrect extraction',
    );
    expect(screen.getByRole('region', { name: 'Current record' })).toHaveTextContent('900');
    expect(screen.getByText('Continuous input current')).toBeInTheDocument();
    expect(screen.getByText('Human source correction · provisional')).toBeInTheDocument();
  });
  it('discards a late preview for the previous source value', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    const preview = vi.fn().mockImplementation(async (_id, req) => {
      if (
        req.intent.statements[0].mapping?.target === target &&
        req.intent.statements[0].value === '500'
      )
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return {
        candidate: { electrical: { continuous_input_current_a: 0.9 } },
        assertions: [],
        non_projected: [],
      };
    });
    show({ humanPreview: preview });
    await fill();
    fireEvent.change(screen.getByLabelText('Engineering property'), { target: { value: target } });
    await screen.findByText('Waiting for server validation…');
    fireEvent.change(screen.getByLabelText('Exact source value (required)'), {
      target: { value: '900' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled(),
    );
    await act(async () => {
      resolveOld({
        candidate: { electrical: { continuous_input_current_a: 0.5 } },
        assertions: [],
        non_projected: [],
      });
    });
    expect(screen.getByText('0.9')).toBeInTheDocument();
    expect(screen.queryByText('0.5')).not.toBeInTheDocument();
  });
  it('readiness actions focus the missing rationale and model relationship controls', async () => {
    show();
    fireEvent.change(screen.getByLabelText('What needs correcting?'), { target: { value: 'add' } });
    fireEvent.change(screen.getByLabelText('Corrected source label (required)'), {
      target: { value: 'Input current' },
    });
    fireEvent.change(screen.getByLabelText('Exact source value (required)'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByLabelText('Original manufacturer wording (required)'), {
      target: { value: source },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /Example Model continuous input current 500 mA/ }),
    );
    fireEvent.click(screen.getByLabelText('Value or original statement'));
    fireEvent.click(screen.getByRole('button', { name: 'Use selected evidence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explain the correction' }));
    expect(screen.getByLabelText('Reason for correction (required)')).toHaveFocus();
    fireEvent.click(
      screen.getByRole('button', { name: /Complete the source statement and evidence/ }),
    );
    expect(screen.getByLabelText('Model relationship (required)')).toHaveFocus();
  });
});
