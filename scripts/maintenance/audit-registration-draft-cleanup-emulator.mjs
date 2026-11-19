import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
  console.error('Use apenas --dry-run para simular a limpeza.');
  process.exit(1);
}

const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const address = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(host);
const port = Number(address?.[2]);
if (!address || port < 1 || port > 65535) {
  console.error('FIRESTORE_EMULATOR_HOST deve indicar o Firestore Emulator em um endereço de loopback.');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ??
  process.env.GCP_PROJECT ?? 'entretenimento-sexual';
if (projectId !== 'entretenimento-sexual' && !/^demo-[a-z0-9-]{1,60}$/.test(projectId)) {
  console.error('Use o projeto local entretenimento-sexual ou um projeto de demonstração demo-*.');
  process.exit(1);
}

process.env.FIRESTORE_EMULATOR_HOST = host.replace(/^localhost:/, '127.0.0.1:');
const app = initializeApp({ projectId }, 'registration-draft-cleanup-dry-run');
const db = getFirestore(app);
const asOfMs = Date.now();
const counts = { expiredDrafts: 0, validDrafts: 0, accountReceipts: 0, unclassified: 0 };
const draftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

try {
  // A coleção reúne rascunhos de IDs aleatórios e recibos vinculados ao UID.
  // A projeção carrega somente os campos necessários à contagem.
  const records = db.collection('registration_email_link_drafts')
    .select('expiresAtMs', 'adultDeclaredAtMs', 'adultDeclarationVersion')
    .stream();

  for await (const doc of records) {
    const { expiresAtMs, adultDeclaredAtMs, adultDeclarationVersion } = doc.data();
    if (doc.id.startsWith('email-link-preview-') ||
        adultDeclaredAtMs !== undefined || adultDeclarationVersion !== undefined) {
      counts.accountReceipts++;
    } else if (!draftIdPattern.test(doc.id) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
      counts.unclassified++;
    } else if (expiresAtMs <= asOfMs) {
      counts.expiredDrafts++;
    } else {
      counts.validDrafts++;
    }
  }

  console.log(JSON.stringify({
    mode: 'dry-run',
    projectId,
    asOf: new Date(asOfMs).toISOString(),
    ...counts,
  }, null, 2));
} catch {
  console.error('Falha na leitura. Confira se o Firestore Emulator está ativo no projeto indicado.');
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
