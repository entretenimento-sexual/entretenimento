// Emulator-only CLI: read-only audits and explicit bounded initialization.
async function main(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host || !/^(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host)) {
    throw new Error('Firestore localhost emulator required');
  }
  const port = Number(host.slice(host.lastIndexOf(':') + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid emulator port');
  }
  const ids = [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GCP_PROJECT].filter(Boolean);
  if (!ids.length || ids.some((id) => id !== 'demo-entretenimento') ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Demo project and no external credentials required');
  }
  if (process.env.FIREBASE_CONFIG) {
    const config = JSON.parse(process.env.FIREBASE_CONFIG) as
      { projectId?: string; project_id?: string };
    if ([config.projectId, config.project_id].some((id) =>
      id !== undefined && id !== 'demo-entretenimento')) {
      throw new Error('Invalid Firebase project');
    }
  }
  const input = process.argv.slice(2);
  const writeEmulator = input[0] === '--initialize-emulator';
  const conversation = input[0] === '--conversation';
  const consistent = input[0] === '--consistent';
  const args = consistent || conversation || writeEmulator ? input.slice(1) : input;
  if (writeEmulator || conversation ? args.length !== 1 : consistent ? args.length !== 2 :
    ![2, 4, 6].includes(args.length)) {
    throw new Error(
      'Usage: --initialize-emulator CHAT_ID | --conversation CHAT_ID | --consistent CHAT_ID UID | ' +
      'CHAT_ID UID [CURSOR PAGE_SIZE [SCANNED UNREAD]]'
    );
  }
  const [chatId, uid, cursorArg = '-', sizeArg = '100', scannedArg = '0', unreadArg = '0'] = args;
  if ([chatId, ...((conversation || writeEmulator) ? [] : [uid])].some((id) => !id || id.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error('Invalid scope');
  const pageSize = Number(sizeArg);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Page size must be 1..100');
  }
  if (cursorArg !== '-' && !/^[A-Za-z0-9_-]{1,256}$/.test(cursorArg)) {
    throw new Error('Invalid cursor');
  }
  const previousScanned = Number(scannedArg);
  const previousUnread = Number(unreadArg);
  if ([previousScanned, previousUnread].some((n) => !Number.isSafeInteger(n) || n < 0) ||
      previousUnread > previousScanned || (cursorArg !== '-' && args.length !== 6)) {
    throw new Error('Cursor requires cumulative scanned/unread counts');
  }
  // Admin SDK is loaded only after validating emulator environment.
  const audit = require('./direct-unread-backfill.audit') as
    typeof import('./direct-unread-backfill.audit');
  if (writeEmulator) {
    const backfill = require('./direct-unread-backfill.emulator') as
      typeof import('./direct-unread-backfill.emulator');
    const result = await backfill.initializeDirectUnreadOnEmulator(chatId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const result = conversation ? await audit.auditDirectUnreadConversation(chatId) : consistent ?
    await audit.auditDirectUnreadConsistent(chatId, uid) :
    await audit.auditDirectUnreadPage(
      chatId, uid, cursorArg === '-' ? null : cursorArg, pageSize,
      previousScanned, previousUnread
    );
  process.stdout.write(`${JSON.stringify({
    mode: 'DRY_RUN', auditMode: conversation ? 'CONVERSATION' : consistent ? 'CONSISTENT' : 'PAGINATED',
    mutationCount: 0, ...result,
  }, null, 2)}\n`);
}
if (require.main === module) {
  main().catch(() => {
    // O modo --initialize-emulator pode ter confirmado etapas parciais.
    const writing = process.argv.includes('--initialize-emulator');
    process.stderr.write(writing ?
      'Unread emulator initialization failed; inspect partial checkpoints.\n' :
      'Unread dry-run failed; no writes attempted.\n');
    process.exitCode = 1;
  });
}
