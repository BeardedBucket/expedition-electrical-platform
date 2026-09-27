import { createOperatorApi } from './api.js';
import { createProductionOperatorService, operatorConfiguration } from './runtime.js';

const config = operatorConfiguration();
const server = createOperatorApi(
  await createProductionOperatorService(config),
  config.browserOrigin,
);
server.listen(config.port, config.host, () => {
  console.log(`Ingestion API: http://${config.host}:${config.port}`);
  console.log(`Job storage: ${config.jobRoot}`);
  console.log(`Canonical destination (reserved): ${config.canonicalRoot}`);
});
