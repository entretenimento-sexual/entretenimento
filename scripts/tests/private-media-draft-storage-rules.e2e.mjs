import { readFile } from 'node:fs/promises';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

const projectId = 'demo-entretenimento-media-draft-rules';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:18080';
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:19199';
const [firestoreHostname, firestorePort] = firestoreHost.split(':');
const [storageHostname, storagePort] = storageHost.split(':');

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: firestoreHostname,
    port: Number(firestorePort),
    rules: await readFile('firestore.rules', 'utf8'),
  },
  storage: {
    host: storageHostname,
    port: Number(storagePort),
    rules: await readFile('storage.rules', 'utf8'),
  },
});

const ownerUid = 'eligible-owner';
const otherUid = 'other-user';
const photoPath = `users/${ownerUid}/uploads/images/photo-1.jpg`;
const videoPath = `users/${ownerUid}/uploads/videos/video-1.mp4`;
const posterPath = `users/${ownerUid}/uploads/video-posters/video-1/poster.jpg`;

function eligibleUser(uid, overrides = {}) {
  return {
    uid,
    accountStatus: 'active',
    emailVerified: true,
    profileCompleted: true,
    adultConsent: { accepted: true },
    acceptedTerms: {
      accepted: true,
      adultAccessAcknowledgement: true,
    },
    ...overrides,
  };
}

async function seedDocument(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

async function seedReservation({
  reservationId,
  kind,
  sourceStoragePath,
  sourceSizeBytes,
  auxiliaryStoragePath = null,
  auxiliarySizeBytes = 0,
  state = 'ACTIVE',
  expiresAt = Date.now() + 10 * 60 * 1000,
}) {
  await seedDocument(`media_private_upload_reservations/${reservationId}`, {
    reservationId,
    ownerUid,
    mediaId: kind === 'video' ? 'video-1' : 'photo-1',
    kind,
    operation: 'CREATE',
    state,
    sourceStoragePath,
    sourceSizeBytes,
    auxiliaryStoragePath,
    auxiliarySizeBytes,
    expiresAt: Timestamp.fromMillis(expiresAt),
  });
}

async function uploadAs(uid, path, bytes, contentType, reservationId, claims = {}) {
  const context = testEnv.authenticatedContext(uid, {
    email_verified: true,
    ...claims,
  });

  return uploadBytes(
    ref(context.storage(), path),
    new Uint8Array(bytes),
    {
      contentType,
      customMetadata: reservationId
        ? { mediaReservationId: reservationId }
        : undefined,
    }
  );
}

async function assertIneligibleAccount(
  caseId,
  userOverrides,
  claims = {}
) {
  const path = `users/${ownerUid}/uploads/images/${caseId}.jpg`;

  await seedDocument(
    `users/${ownerUid}`,
    eligibleUser(ownerUid, userOverrides)
  );
  await seedReservation({
    reservationId: caseId,
    kind: 'photo',
    sourceStoragePath: path,
    sourceSizeBytes: 10,
  });
  await assertFails(
    uploadAs(ownerUid, path, 10, 'image/jpeg', caseId, claims)
  );
  await seedDocument(`users/${ownerUid}`, eligibleUser(ownerUid));
}

try {
  await seedDocument(`users/${ownerUid}`, eligibleUser(ownerUid));
  await seedDocument(`users/${otherUid}`, eligibleUser(otherUid));

  await assertFails(
    uploadAs(ownerUid, photoPath, 10, 'image/jpeg', '')
  );

  await seedReservation({
    reservationId: 'valid-photo',
    kind: 'photo',
    sourceStoragePath: photoPath,
    sourceSizeBytes: 10,
  });
  await assertSucceeds(
    uploadAs(ownerUid, photoPath, 10, 'image/jpeg', 'valid-photo')
  );

  await seedReservation({
    reservationId: 'wrong-size',
    kind: 'photo',
    sourceStoragePath: `users/${ownerUid}/uploads/images/wrong-size.jpg`,
    sourceSizeBytes: 9,
  });
  await assertFails(
    uploadAs(
      ownerUid,
      `users/${ownerUid}/uploads/images/wrong-size.jpg`,
      10,
      'image/jpeg',
      'wrong-size'
    )
  );

  await seedReservation({
    reservationId: 'expired-photo',
    kind: 'photo',
    sourceStoragePath: `users/${ownerUid}/uploads/images/expired.jpg`,
    sourceSizeBytes: 10,
    expiresAt: Date.now() - 1,
  });
  await assertFails(
    uploadAs(
      ownerUid,
      `users/${ownerUid}/uploads/images/expired.jpg`,
      10,
      'image/jpeg',
      'expired-photo'
    )
  );

  await seedReservation({
    reservationId: 'other-user-reservation',
    kind: 'photo',
    sourceStoragePath: `users/${ownerUid}/uploads/images/other-user.jpg`,
    sourceSizeBytes: 10,
  });
  await assertFails(
    uploadAs(
      otherUid,
      `users/${ownerUid}/uploads/images/other-user.jpg`,
      10,
      'image/jpeg',
      'other-user-reservation'
    )
  );

  await assertIneligibleAccount(
    'restricted-user',
    { suspended: true }
  );
  await assertIneligibleAccount(
    'email-unverified',
    { emailVerified: false },
    { email_verified: false }
  );
  await assertIneligibleAccount(
    'underage-user',
    { idade: 17 }
  );
  await assertIneligibleAccount(
    'terms-required',
    {
      acceptedTerms: {
        accepted: false,
        adultAccessAcknowledgement: false,
      },
    }
  );
  await assertIneligibleAccount(
    'profile-incomplete',
    { profileCompleted: false }
  );

  await seedReservation({
    reservationId: 'valid-video',
    kind: 'video',
    sourceStoragePath: videoPath,
    sourceSizeBytes: 20,
    auxiliaryStoragePath: posterPath,
    auxiliarySizeBytes: 10,
  });
  await assertSucceeds(
    uploadAs(ownerUid, videoPath, 20, 'video/mp4', 'valid-video')
  );
  await assertSucceeds(
    uploadAs(ownerUid, posterPath, 10, 'image/jpeg', 'valid-video')
  );

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(
      doc(context.firestore(), 'media_private_upload_reservations/valid-video'),
      { state: 'CONSUMED' }
    );
  });
  await assertFails(
    uploadAs(ownerUid, videoPath, 20, 'video/mp4', 'valid-video')
  );

  console.log('[media-draft-storage-rules] todos os cenários passaram');
} finally {
  await testEnv.cleanup();
}
