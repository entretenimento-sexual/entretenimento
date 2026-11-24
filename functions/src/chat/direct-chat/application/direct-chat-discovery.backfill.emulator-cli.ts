// CHAT-R1.3: emulator-only operational entry point for historical discovery.
// Usage after build:
// node lib/chat/direct-chat/application/direct-chat-discovery.backfill.emulator-cli.js UID_A UID_B [--apply]
async function main(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host || !/^(?:127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host)) {
    throw new Error('Local Firestore Emulator is required.');
  }
  const port = Number(host.slice(host.lastIndexOf(':') + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid Firestore Emulator port.');
  }
  const projectIds = [
    process.env.GCLOUD_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GCP_PROJECT,
  ].filter((value): value is string => Boolean(value));
  if (projectIds.length === 0 ||
    projectIds.some(id => id !== 'demo-entretenimento')) {
    throw new Error('Demo project is required.');
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('External credentials are prohibited.');
  }
  if (process.env.FIREBASE_CONFIG) {
    let config: { projectId?: unknown; project_id?: unknown };
    try { config = JSON.parse(process.env.FIREBASE_CONFIG) as typeof config; } catch {
      throw new Error('Invalid Firebase config.');
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)
      || [config.projectId, config.project_id].some(
        id => id !== undefined && id !== 'demo-entretenimento')) {
      throw new Error('Invalid Firebase project.');
    }
  }
  const args = process.argv.slice(2);
  if (!(args.length === 2 || (args.length === 3 && args[2] === '--apply'))) {
    throw new Error('Expected exactly two UIDs and optional --apply.');
  }
  if (args[0] === args[1] || args.slice(0, 2).some(uid => !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) {
    throw new Error('Invalid participant pair.');
  }
  // Load Admin SDK only after emulator validation; never log raw UIDs/chat IDs.
  const { reconcileHistoricalDirectChatDiscovery } =
    require('./direct-chat-discovery.backfill') as
      typeof import('./direct-chat-discovery.backfill');
  const result = await reconcileHistoricalDirectChatDiscovery(
    args[0], args[1], args[2] === '--apply'
  );
  process.stdout.write(JSON.stringify({
    mode: args[2] === '--apply' ? 'EMULATOR_APPLY' : 'DRY_RUN',
    status: result.status,
    reason: result.reason ?? null,
    scanned: result.scanned,
    candidateCount: result.candidates,
  }) + '\n');
  if (result.status === 'manual-review') process.exitCode = 2;
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('Historical discovery reconciliation failed.\n');
    process.exitCode = 1;
  });
}
