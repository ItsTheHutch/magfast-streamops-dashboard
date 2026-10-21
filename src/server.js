import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { isLoopback } from './access.js';

const config = loadConfig();
const app = createApp(config);

await app.listen(config.port, config.host);

console.log(`magFAST StreamOps listening on http://localhost:${config.port}`);
console.log(`  Dashboard: http://localhost:${config.port}/`);
console.log(`  OBS text files: ${app.outputDir()}`);
console.log(isLoopback(config.host)
  ? '  Only this computer can open the dashboard.'
  : `  Other computers on the network can open it too (host ${config.host}). There's no password, so only do this on a network you trust.`);
if (!config.hasLocalConfig) {
  console.log('  Note: using defaults. Copy config/config.example.json to config/config.json to customize.');
}
