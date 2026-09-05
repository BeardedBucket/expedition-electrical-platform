import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountConfiguratorEmbed, type EmbedEvent } from './embed.js';
import type { LoadItem } from './configurator-model.js';

const mounted: Array<{ dispose: () => void }> = [];

afterEach(() => {
  mounted.splice(0).forEach((controller) => controller.dispose());
  document.body.innerHTML = '';
});

const mount = (config: Parameters<typeof mountConfiguratorEmbed>[1] = {}) => {
  const element = document.createElement('div');
  document.body.append(element);
  let controller: ReturnType<typeof mountConfiguratorEmbed>;
  act(() => {
    controller = mountConfiguratorEmbed(element, config);
  });
  mounted.push(controller!);
  return { element, controller: controller! };
};

const evaluate = () => {
  fireEvent.click(screen.getByLabelText('24 V'));
  fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));
};

const validLoads: readonly LoadItem[] = [
  {
    id: 'load-test',
    name: 'Test load',
    quantity: '1',
    powerW: '100',
    operatingVoltage: '',
    basis: 'direct-source',
    conversionEfficiency: '',
  },
];

describe('configurator embed boundary', () => {
  it('mounts generic mode and emits a typed evaluation event with one explicit timestamp', () => {
    const onEvent = vi.fn<(event: EmbedEvent) => void>();
    mount({
      onEvent,
      clock: () => new Date('2026-09-02T03:04:05Z'),
      initialConfiguration: { loads: validLoads },
    });

    act(evaluate);

    const evaluation = onEvent.mock.calls.find(([event]) => event.type === 'evaluation_completed');
    expect(evaluation?.[0]).toMatchObject({
      type: 'evaluation_completed',
      payload: {
        evaluatedAt: '2026-09-02T03:04:05.000Z',
        status: 'evaluated',
        candidates: expect.any(Array),
      },
    });
    expect(screen.getByText(/recommended \/ eligible/i)).toBeInTheDocument();
  });

  it('keeps an unknown builder unresolved rather than falling back to generic recommendations', () => {
    const onEvent = vi.fn<(event: EmbedEvent) => void>();
    mount({
      mode: 'builder',
      builderId: 'builder.missing',
      onEvent,
      initialConfiguration: { loads: validLoads },
    });
    evaluate();

    expect(screen.getByText(/unresolved \(builder\.missing\)/i)).toBeInTheDocument();
    expect(screen.getByText(/builder identity is unresolved/i)).toBeInTheDocument();
    expect(onEvent).toHaveBeenCalledWith({
      type: 'builder_unresolved',
      builderId: 'builder.missing',
    });
  });

  it('does not allow a generic host configuration to provide a builder ID', () => {
    const onEvent = vi.fn<(event: EmbedEvent) => void>();
    mount({
      mode: 'generic',
      builderId: 'builder.northwind',
      onEvent,
      initialConfiguration: { loads: validLoads },
    });
    evaluate();

    expect(screen.getByRole('alert')).toHaveTextContent(/must not provide a builder id/i);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'validation_error' }));
  });

  it('emits a narrow inquiry payload and cleans up on dispose', () => {
    const onInquiry = vi.fn();
    const { element, controller } = mount({
      onInquiry,
      inquiryDestination: 'synthetic-route',
      visibleSections: ['system-basics', 'loads', 'results', 'inquiry'],
      initialConfiguration: { loads: validLoads },
    });
    evaluate();
    fireEvent.click(screen.getAllByRole('button', { name: /inquire about this candidate/i })[0]!);

    expect(onInquiry).toHaveBeenCalledWith(
      expect.objectContaining({
        componentId: expect.any(String),
        inquiryDestination: 'synthetic-route',
        configuration: expect.objectContaining({ selectedVoltage: 24, loadCount: 1 }),
      }),
    );
    act(() => controller.dispose());
    expect(element).toBeEmptyDOMElement();
    expect(() => controller.dispose()).not.toThrow();
    expect(onInquiry).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate hidden required loads', () => {
    mount({ visibleSections: ['system-basics', 'results'] });
    fireEvent.click(screen.getByLabelText('24 V'));
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/at least one load is required/i);
  });

  it('rejects malformed initial engineering values instead of normalizing them', () => {
    mount({
      initialConfiguration: {
        selectedVoltage: 13 as never,
        loads: validLoads,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/not a supported evaluation option/i);
  });

  it('supports updating configuration and remounting after disposal', () => {
    const { element, controller } = mount({
      initialConfiguration: { loads: validLoads },
    });
    act(() => controller.updateConfig({ mode: 'builder', builderId: 'builder.northwind' }));
    expect(element).toHaveTextContent(/builder-scoped configuration/i);
    act(() => controller.dispose());

    const remounted = mount({ initialConfiguration: { loads: validLoads } });
    expect(remounted.element).toHaveTextContent(/configure from requirements/i);
  });

  it('resolves a valid builder and applies its inventory filter through the public API', () => {
    const { element } = mount({
      mode: 'builder',
      builderId: 'builder.northwind',
      initialConfiguration: { loads: validLoads },
    });
    evaluate();

    expect(element).toHaveTextContent('Northwind Builds');
    const recommended = within(element).getByRole('heading', {
      name: /recommended \/ eligible/i,
    }).parentElement;
    expect(recommended).toHaveTextContent('eligible standard');
    expect(recommended).not.toHaveTextContent('builder gap');
  });

  it('keeps a builder inventory gap distinct from ineligible results through the public API', () => {
    const { element } = mount({
      mode: 'builder',
      builderId: 'builder.gap',
      initialConfiguration: { loads: validLoads },
    });
    evaluate();

    const gap = within(element).getByRole('heading', {
      name: /builder inventory gap/i,
    }).parentElement;
    const ineligible = within(element).getByRole('heading', {
      name: /ineligible \/ incompatible/i,
    }).parentElement;
    expect(gap).toHaveTextContent('eligible standard');
    expect(ineligible).not.toHaveTextContent('eligible standard');
  });

  it('does not accept host result-authority fields for advisory candidates', () => {
    const onResult = vi.fn();
    mount({
      mode: 'generic',
      onResult,
      initialConfiguration: { loads: validLoads },
      recommendationEligible: true,
      engineeringStatus: 'compatible',
      advisoryAction: 'caution',
      groups: [{ id: 'recommended', items: [] }],
    } as never);
    evaluate();

    const payload = onResult.mock.calls[0]?.[0];
    const suppressed = payload.candidates.find(
      (candidate: { id: string }) => candidate.id === 'component.eligible.suppressed',
    );
    const excluded = payload.candidates.find(
      (candidate: { id: string }) => candidate.id === 'component.eligible.excluded',
    );
    expect(suppressed).toMatchObject({
      recommendationEligible: false,
      advisoryAction: 'suppress_recommendation',
    });
    expect(excluded).toMatchObject({ recommendationEligible: false, advisoryAction: 'exclude' });
    expect(
      payload.candidates.some(
        (candidate: { group: string; id: string }) =>
          candidate.group === 'recommended' && /suppressed|excluded/.test(candidate.id),
      ),
    ).toBe(false);
  });

  it('changes theme presentation without changing public result semantics', () => {
    const first = vi.fn();
    const second = vi.fn();
    mount({
      onResult: first,
      theme: { accent: 'blue' },
      initialConfiguration: { selectedVoltage: 24, loads: validLoads },
    });
    evaluate();
    const firstPayload = first.mock.calls[0]?.[0];
    document.body.innerHTML = '';
    mount({
      onResult: second,
      theme: { accent: 'green', density: 'compact' },
      initialConfiguration: { selectedVoltage: 24, loads: validLoads },
    });
    evaluate();
    const secondPayload = second.mock.calls[0]?.[0];
    expect(secondPayload.candidates).toEqual(firstPayload.candidates);
    expect(within(document.body).getAllByText(/cautioned/i).length).toBeGreaterThan(0);
  });

  it('maps named radius tokens safely without changing result semantics', () => {
    const onResult = vi.fn();
    const { element } = mount({
      onResult,
      theme: { borderRadius: 'pill' },
      initialConfiguration: { selectedVoltage: 24, loads: validLoads },
    });
    evaluate();
    const themedRoot = element.querySelector('.embed-root');
    expect(themedRoot).toHaveStyle('--embed-radius: 999px');
    const validPayload = onResult.mock.calls[0]?.[0];

    document.body.innerHTML = '';
    const invalidResult = vi.fn();
    const invalidMount = mount({
      onResult: invalidResult,
      theme: { borderRadius: 'calc(100vw)' } as never,
      initialConfiguration: { selectedVoltage: 24, loads: validLoads },
    });
    evaluate();
    expect(invalidMount.element.querySelector('.embed-root')).toHaveStyle('--embed-radius: 1rem');
    expect(invalidResult.mock.calls[0]?.[0].candidates).toEqual(validPayload.candidates);
  });

  it('invokes the injected clock once per evaluation and uses each returned timestamp', () => {
    const clock = vi
      .fn()
      .mockReturnValueOnce(new Date('2026-09-02T03:04:05Z'))
      .mockReturnValueOnce(new Date('2026-09-02T03:04:06Z'));
    const onResult = vi.fn();
    mount({ clock, onResult, initialConfiguration: { loads: validLoads } });
    evaluate();
    expect(clock).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0].evaluatedAt).toBe('2026-09-02T03:04:05.000Z');
    fireEvent.click(screen.getByRole('button', { name: /evaluate configuration/i }));
    expect(clock).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls[1]?.[0].evaluatedAt).toBe('2026-09-02T03:04:06.000Z');
  });

  it('keeps mounts isolated and replaces callbacks on updateConfig', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first, second);
    const callbackA = vi.fn();
    const callbackB = vi.fn();
    let firstController!: ReturnType<typeof mountConfiguratorEmbed>;
    act(() => {
      firstController = mountConfiguratorEmbed(first, {
        onEvent: callbackA,
        initialConfiguration: { loads: validLoads },
      });
      mountConfiguratorEmbed(second, {
        mode: 'builder',
        builderId: 'builder.northwind',
        initialConfiguration: { loads: validLoads },
      });
    });
    firstController.updateConfig({
      onEvent: callbackB,
      initialConfiguration: { selectedVoltage: 24, loads: validLoads },
    });
    fireEvent.click(within(first).getByLabelText('24 V'));
    fireEvent.click(within(first).getByRole('button', { name: /evaluate configuration/i }));
    expect(callbackA).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'evaluation_completed' }),
    );
    expect(callbackB).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'evaluation_completed' }),
    );
    expect(within(second).queryByText(/recommended \/ eligible/i)).not.toBeInTheDocument();
  });

  it('renders hostile builder text as text and keeps read-only evaluation usable', () => {
    const onInquiry = vi.fn();
    const { element } = mount({
      mode: 'builder',
      builderId: '<img src=x onerror="bad">',
      readOnly: true,
      onInquiry,
      visibleSections: ['system-basics', 'loads', 'results', 'inquiry'],
      initialConfiguration: { selectedVoltage: 24, loads: validLoads },
    });
    expect(within(element).getByLabelText('24 V')).toBeDisabled();
    expect(element.querySelector('img')).toBeNull();
    expect(element).toHaveTextContent('<img src=x onerror="bad">');
    fireEvent.click(within(element).getByRole('button', { name: /evaluate configuration/i }));
    expect(
      within(element).getByRole('heading', { name: /recommended \/ eligible/i }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(element).getAllByRole('button', { name: /inquire about this candidate/i })[0]!,
    );
    expect(onInquiry).toHaveBeenCalled();
  });
});
