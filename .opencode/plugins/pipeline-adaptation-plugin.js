import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPipelineAdaptationHooks } = require('../../src/opencode/pipeline-adaptation-plugin.cjs');

export default async function pipelineAdaptationPlugin(input = {}, options = {}) {
  return createPipelineAdaptationHooks(input, options);
}
