// scripts/tests/run-video-publication-e2e.mjs
// -----------------------------------------------------------------------------
// Executa os E2Es de vídeo com variáveis restritas ao processo dos emuladores.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import path from 'node:path';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
const firebaseCli = path.resolve(
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js'
);
const testCommand = [
  'node scripts/tests/video-publication.e2e.mjs',
  'node scripts/tests/video-social.e2e.mjs',
  'node scripts/tests/video-ratings.e2e.mjs',
  'node scripts/tests/video-reports.e2e.mjs',
].join(' && ');

const child = spawn(
  process.execPath,
  [
    firebaseCli,
    'emulators:exec',
    '--config',
    'firebase.media-e2e.json',
    '--only',
    'auth,firestore,storage,functions',
    '--project',
    PROJECT_ID,
    testCommand,
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MEDIA_AUTO_APPROVE_VIDEOS: 'true',
      FIREBASE_STORAGE_BUCKET: STORAGE_BUCKET,
    },
    stdio: 'inherit',
  }
);

child.on('error', (error) => {
  console.error('Não foi possível iniciar o E2E de vídeo.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`E2E de vídeo interrompido por ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
