import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import abandonment from '../../functions/lib/registration/registration-abandonment.service.js';

const args = process.argv.slice(2);
const mode = args[0] ?? '--dry-run';
if (args.length > 1 || !['--dry-run', '--apply'].includes(mode)) {
  console.error('Use --dry-run para consultar ou --apply para aplicar a triagem em um projeto demo isolado.');
  process.exit(1);
}

function localHost(variable, fallback) {
  const host = process.env[variable] ?? fallback;
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(host);
  const port = Number(match?.[2]);
  if (!match || port < 1 || port > 65535) {
    console.error(`${variable} deve apontar para um emulador local.`);
    process.exit(1);
  }
  return host.replace(/^localhost:/, '127.0.0.1:');
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ??
  process.env.GCP_PROJECT ?? 'entretenimento-sexual';
if (projectId !== 'entretenimento-sexual' && !/^demo-[a-z0-9-]{1,60}$/.test(projectId)) {
  console.error('Use o projeto local entretenimento-sexual ou um projeto de demonstração demo-*.');
  process.exit(1);
}

if (mode === '--apply' && (!/^demo-[a-z0-9-]{1,60}$/.test(projectId) ||
    !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
  console.error('A aplicação manual exige projeto demo-* e os dois endereços de emulador explícitos.');
  process.exit(1);
}

process.env.FIRESTORE_EMULATOR_HOST = localHost('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
process.env.FIREBASE_AUTH_EMULATOR_HOST = localHost('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
const app = initializeApp({ projectId }, 'registration-abandonment');
const nowMs = Date.now();

try {
  const apply = mode === '--apply';
  const { changes, ...report } = await abandonment.sweepRegistrationAbandonment(
    getFirestore(app), getAuth(app), { apply, nowMs },
  );
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    projectId,
    asOf: new Date(nowMs).toISOString(),
    ...report,
    ...(apply ? { changes } : {}),
  }, null, 2));
} catch {
  console.error('Falha na triagem. Confira os emuladores e execute novamente. Cada alteração pode ser repetida.');
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
