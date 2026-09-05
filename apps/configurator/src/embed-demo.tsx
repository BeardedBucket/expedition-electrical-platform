import { mountConfiguratorEmbed } from './embed.js';

const logEvent = (event: unknown) => {
  const output = document.createElement('pre');
  output.textContent = JSON.stringify(event, null, 2);
  document.body.append(output);
};

mountConfiguratorEmbed(document.getElementById('generic-embed')!, {
  mode: 'generic',
  theme: { accent: 'blue', density: 'compact' },
  onEvent: logEvent,
  onInquiry: logEvent,
});

mountConfiguratorEmbed(document.getElementById('builder-embed')!, {
  mode: 'builder',
  builderId: 'builder.northwind',
  visibleSections: ['system-basics', 'loads', 'builder-context', 'results', 'inquiry'],
  onEvent: logEvent,
});

mountConfiguratorEmbed(document.getElementById('unresolved-embed')!, {
  mode: 'builder',
  builderId: 'builder.not-found',
  initialConfiguration: {
    selectedVoltage: 24,
    loads: [
      {
        id: 'demo-load',
        name: 'Demo load',
        quantity: '1',
        powerW: '100',
        operatingVoltage: '',
        basis: 'direct-source',
        conversionEfficiency: '',
      },
    ],
  },
  onEvent: logEvent,
});
