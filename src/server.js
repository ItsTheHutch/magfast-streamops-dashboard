import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp(config);

await app.listen(config.port, config.host);

console.log(`magFAST StreamOps listening on http://localhost:${config.port}`);
console.log(`  Dashboard: http://localhost:${config.port}/`);
console.log(`  OBS text files: ${app.outputDir()}`);
if (!config.hasLocalConfig) {
  console.log('  Note: using defaults. Copy config/config.example.json to config/config.json to customize.');
}
