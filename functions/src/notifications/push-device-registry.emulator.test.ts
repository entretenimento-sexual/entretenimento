import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { db } from '../firebaseApp';
import { buildPushInstallationDocumentId, buildPushTokenDocumentId } from './push-device.policy';
import { registerPushDevice, unregisterPushDevice } from './push-device-registry';

const expectedHost = process.env.CHAT_RECONCILIATION_EXPECTED_EMULATOR_HOST;
const run = expectedHost?.startsWith('127.0.0.1:') &&
  expectedHost === process.env.FIRESTORE_EMULATOR_HOST &&
  process.env.GCLOUD_PROJECT === 'demo-entretenimento' ? describe : describe.skip;

run('Push device registry', () => {
  const first = randomUUID();
  const second = randomUUID();
  const installationId = randomUUID();
  const token = 'synthetic-fcm-' + randomUUID();
  const ownerRef = db.doc(`push_token_owners/${buildPushTokenDocumentId(token)}`);
  const deviceRef = db.doc(`users/${first}/push_devices/${buildPushInstallationDocumentId(installationId)}`);
  const register = (authenticatedUid: string, expectedUid: string, registrationId: string) =>
    registerPushDevice.run({
      auth: { uid: authenticatedUid, token: {} },
      data: { expectedUid, registrationId, installationId, token, platform: 'web' },
    } as Parameters<typeof registerPushDevice.run>[0]);
  const unregister = (authenticatedUid: string, expectedUid: string, cancelledRegistrationIds: string[]) =>
    unregisterPushDevice.run({
      auth: { uid: authenticatedUid, token: {} },
      data: { expectedUid, cancelledRegistrationIds, installationId },
    } as Parameters<typeof unregisterPushDevice.run>[0]);

  before(async () => {
    await Promise.all([first, second].map(uid => db.doc(`users/${uid}`).set({ uid })));
  });
  after(async () => {
    await Promise.all([
      db.recursiveDelete(db.doc(`users/${first}`)),
      db.recursiveDelete(db.doc(`users/${second}`)),
      ownerRef.delete(),
    ]);
  });

  it('recusa registro e remoção para um UID diferente do token', async () => {
    await assert.rejects(register(second, first, randomUUID()), { code: 'failed-precondition' });
    await assert.rejects(unregister(second, first, []), { code: 'failed-precondition' });
    assert.equal((await ownerRef.get()).exists, false);
  });

  it('bloqueia o registro que chega após a remoção e permite uma nova ativação', async () => {
    const oldRegistration = randomUUID();
    await unregister(first, first, [oldRegistration]);
    await assert.rejects(register(first, first, oldRegistration), { code: 'aborted' });
    assert.equal((await deviceRef.get()).get('lastSeenAt'), undefined);
    assert.equal((await ownerRef.get()).exists, false);

    const newRegistration = randomUUID();
    assert.deepEqual(await register(first, first, newRegistration), { ok: true });
    await assert.rejects(register(first, first, oldRegistration), { code: 'aborted' });
    assert.equal((await ownerRef.get()).get('uid'), first);

    assert.deepEqual(await register(second, second, randomUUID()), { ok: true });
    await unregister(first, first, [newRegistration]);
    assert.equal((await deviceRef.get()).get('token'), undefined);
    assert.equal((await ownerRef.get()).get('uid'), second);
  });
});
