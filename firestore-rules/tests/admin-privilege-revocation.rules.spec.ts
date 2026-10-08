import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const ACTOR = 'admin-revocation-actor';
let env: RulesTestEnvironment;

async function setLiveAccount(data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ACTOR), data);
  });
}

describe('revogação de privilégios administrativos (Firestore Rules)', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1',
        port: 8180,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await setLiveAccount({ accountStatus: 'active', role: 'admin' });
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'admin_logs', 'revocation-test'), {
        adminUid: ACTOR, action: 'probe', targetUserUid: 'target',
        timestamp: new Date(),
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('revoga leitura admin imediatamente mantendo o mesmo JWT/claims', async () => {
    // Reutilizar o mesmo contexto é crucial: as claims simulam o JWT anterior.
    const db = env.authenticatedContext(ACTOR, { admin: true }).firestore();
    const audit = doc(db, 'admin_logs', 'revocation-test');
    await assertSucceeds(getDoc(audit));
    await setLiveAccount({ accountStatus: 'active', role: 'free' });
    await assertFails(getDoc(audit));
    await setLiveAccount({ accountStatus: 'active', role: 'admin' });
    await assertSucceeds(getDoc(audit));
  });

  it('nega claim administrativa sem papel atual', async () => {
    await setLiveAccount({ accountStatus: 'active', role: 'free' });
    const db = env.authenticatedContext(ACTOR, { admin: true }).firestore();
    await assertFails(getDoc(doc(db, 'admin_logs', 'revocation-test')));
  });

  it('não concede acesso só pelo papel no documento sem claim', async () => {
    const db = env.authenticatedContext(ACTOR, { admin: false }).firestore();
    await assertFails(getDoc(doc(db, 'admin_logs', 'revocation-test')));
  });

  it('suspensão prevalece sobre papel e claim antigos', async () => {
    await setLiveAccount({ accountStatus: 'moderation_suspended', role: 'admin', suspended: true });
    const db = env.authenticatedContext(ACTOR, { admin: true }).firestore();
    await assertFails(getDoc(doc(db, 'admin_logs', 'revocation-test')));
  });

  it('nega usuário sem documento atual mesmo com token admin', async () => {
    await env.clearFirestore();
    const db = env.authenticatedContext(ACTOR, { admin: true }).firestore();
    await assertFails(getDoc(doc(db, 'admin_logs', 'revocation-test')));
  });
});
