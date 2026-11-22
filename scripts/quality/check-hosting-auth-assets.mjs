import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../../firebase.json', import.meta.url)));
const { hosting } = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
const output = join(root, hosting.public);
const worker = 'assets/firebase-messaging-sw.js';

try {
  const index = readFileSync(join(output, 'index.html'), 'utf8');
  if (!index.includes('<app-root')) throw new Error('index.html não contém a aplicação.');
  if (!readFileSync(join(output, worker)).equals(readFileSync(join(root, 'src', worker)))) {
    throw new Error('O service worker no build diverge do código da revisão.');
  }
  console.log('[hosting-auth-assets] Aplicação e service worker presentes no diretório publicado.');
} catch (error) {
  console.error('[hosting-auth-assets] Gere o build de destino antes de publicar.', error.message);
  process.exitCode = 1;
}
