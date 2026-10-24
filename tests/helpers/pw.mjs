// Playwright, found the way CommonJS finds it (NODE_PATH included), so a machine with a global install
// works as well as one with node_modules.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require('playwright');
export const chromium = pw.chromium;
