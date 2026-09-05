import type { DemoData } from './contracts.js';

export const demoData: DemoData = {
  versions: {
    components: { id: 'components.demo', version: '0.1.0', status: 'synthetic' },
    builders: { id: 'builders.demo', version: '0.1.0', status: 'synthetic' },
    advisories: { id: 'advisories.demo', version: '0.1.0', status: 'synthetic' },
    ruleSet: { id: 'rules.demo', version: '0.1.0', status: 'synthetic' },
  },
  components: [],
  builders: [],
  advisories: [],
  ruleSet: {
    id: 'rules.demo',
    version: '0.1.0',
    status: 'synthetic',
    description: 'Synthetic demo metadata; no engineering rule values are supplied.',
  },
};
