import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (PhilateLister/) when running from compiled scripts/dist/*.js */
export const repoRoot = join(__dirname, '..', '..');
