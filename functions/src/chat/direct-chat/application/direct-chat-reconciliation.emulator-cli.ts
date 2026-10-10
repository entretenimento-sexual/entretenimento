// Entrada operacional exclusiva do Firestore Emulator. Nunca exportar como Function.
// Uso após build: node lib/chat/direct-chat/application/direct-chat-reconciliation.emulator-cli.js UID_A UID_B
async function main(): Promise<void> {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Auditoria bloqueada: FIRESTORE_EMULATOR_HOST é obrigatório.');
  }
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    throw new Error('Forneça exatamente dois UIDs; sem varredura global.');
  }
  // Carregar Admin SDK somente depois de confirmar o ambiente de emulação.
  const { db } = require('../../../firebaseApp') as typeof import('../../../firebaseApp');
  const { readDirectChatReconciliation } = require('./direct-chat-reconciliation.reader')
    as typeof import('./direct-chat-reconciliation.reader');
  const report = await readDirectChatReconciliation(db, [args[0], args[1]]);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error: unknown) => {
    process.stderr.write(`Falha no dry-run: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
