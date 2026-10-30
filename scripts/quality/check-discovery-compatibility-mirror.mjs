// Fail CI whenever the backend compatibility policy diverges from the
// pure, tested Angular policy. No separate algorithms or inferred preferences.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const frontendPath = resolve(root, 'src/app/core/utils/discovery/profile-compatibility.util.ts');
const backendPath = resolve(root, 'functions/src/discovery/profile-compatibility.server.ts');
const frontend = readFileSync(frontendPath, 'utf8').replace(/\r\n/gu, '\n');
const backend = readFileSync(backendPath, 'utf8').replace(/\r\n/gu, '\n');
const marker = '// src/app/core/utils/discovery/profile-compatibility.util.ts';
const offset = backend.indexOf(marker);
if (offset < 0 || backend.slice(offset) !== frontend) {
  console.error('[discovery:compatibility] FAIL: políticas frontend/backend divergentes.');
  process.exitCode = 1;
} else {
  console.log('[discovery:compatibility] OK: política pura espelhada sem divergência.');
}
