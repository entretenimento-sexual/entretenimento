// Enforces emitted Functions entry points required by Emulator and E2E tests.
// A successful TypeScript exit must never be mistaken for a usable build.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const paths = [
  'lib/index.js',
  'lib/compliance/platform-legal.constants.js',
  'lib/media/application/public-media-consumption-access.policy.js',
  'lib/media/application/start-public-video-playback-session.handler.js',
  'lib/media/application/record-video-view.handler.js',
  'lib/media/application/record-video-retention.handler.js',
];

const missing = paths.filter((item) =>
  !fs.existsSync(path.join(root, item))
);
if (missing.length > 0) {
  console.error(
    '[functions:emit] Compilacao incompleta. Artefatos ausentes:\n- ' +
    missing.join('\n- ')
  );
  console.error(
    '[functions:emit] Verifique as dependencias: npm --prefix functions ci'
  );
  process.exitCode = 1;
} else {
  console.log(
    '[functions:emit] OK: index, compliance e callables de Media compilados.'
  );
}
