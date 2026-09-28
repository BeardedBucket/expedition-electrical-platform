import { loadIntakeSuggestions } from './suggestions.js';
import { createOperatorApi } from './api.js';
import { createProductionOperatorService, operatorConfiguration } from './runtime.js';

const config = operatorConfiguration();
const server = createOperatorApi(
  await createProductionOperatorService(config),
  config.browserOrigin,
  () => loadIntakeSuggestions(config),
  config.canonicalRoot,
);
server.listen(config.port, config.host, () => {
  console.log(`Ingestion API: http://${config.host}:${config.port}`);
  console.log(`Job storage: ${config.jobRoot}`);
  console.log(`Batch storage: ${config.batchRoot}`);
  console.log(`Canonical destination: ${config.canonicalRoot}`);
});
