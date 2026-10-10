// Entrada operacional exclusiva do Firestore Emulator. Nunca exportar como Function.
// Uso após build: node lib/chat/direct-chat/application/direct-chat-reconciliation.emulator-cli.js UID_A UID_B
async function main(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) {
    throw new Error('Auditoria bloqueada: FIRESTORE_EMULATOR_HOST é obrigatório.');
  }
  // Aceitar apenas emulador Firestore local, sem URLs, DNS remoto ou credenciais.
  if (!/^(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host)) {
    throw new Error('Auditoria bloqueada: Firestore Emulator deve usar host loopback.');
  }
  const port = Number(host.slice(host.lastIndexOf(':') + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Auditoria bloqueada: porta do emulador inválida.');
  }
  const projectIds = [
    process.env.GCLOUD_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GCP_PROJECT,
  ].filter((value): value is string => Boolean(value));
  if (projectIds.length === 0 || projectIds.some((id) => id !== 'demo-entretenimento')) {
    throw new Error('Auditoria bloqueada: projeto demo-entretenimento obrigatório.');
  }
  if (process.env.FIREBASE_CONFIG) {
    let config: { projectId?: unknown; project_id?: unknown };
    try {
      config = JSON.parse(process.env.FIREBASE_CONFIG) as typeof config;
    } catch {
      throw new Error('Auditoria bloqueada: FIREBASE_CONFIG inválido.');
    }
    const configProject = config?.projectId ?? config?.project_id;
    if (configProject !== undefined && configProject !== 'demo-entretenimento') {
      throw new Error('Auditoria bloqueada: FIREBASE_CONFIG aponta para outro projeto.');
    }
  }
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    throw new Error('Forneça exatamente dois UIDs; sem varredura global.');
  }
  if (args.some((uid) => !uid || uid.length > 128 || uid.includes('/')
    || /[\x00-\x1f\x7f]/.test(uid)) || args[0] === args[1]) {
    throw new Error('Auditoria bloqueada: par de UIDs inválido.');
  }
  // Carregar Admin SDK somente depois de confirmar o ambiente de emulação.
  const { db } = require('../../../firebaseApp') as typeof import('../../../firebaseApp');
  const { readDirectChatReconciliation } = require('./direct-chat-reconciliation.reader') as
    typeof import('./direct-chat-reconciliation.reader');
  const report = await readDirectChatReconciliation(db, [args[0], args[1]]);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error: unknown) => {
    process.stderr.write(`Falha no dry-run: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
