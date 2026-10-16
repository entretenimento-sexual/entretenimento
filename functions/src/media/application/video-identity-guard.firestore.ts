import type { DocumentReference, DocumentSnapshot, Firestore, WriteBatch } from 'firebase-admin/firestore';

const VIDEO_DELETION_COLLECTION = 'media_video_deletion_jobs';
const GUARD_COLLECTION = 'video_identity_guards';

/** An identity remains retired after the cleanup job has been removed. */
export class VideoIdentityUnavailableError extends Error {
  constructor() {
    super('Video identity is already used or deletion is pending.');
    this.name = 'VideoIdentityUnavailableError';
  }
}

function identityRef(firestore: Firestore, ownerUid: string, videoId: string): DocumentReference {
  return firestore.doc(`users/${ownerUid}/${GUARD_COLLECTION}/${videoId}`);
}

function deletionRef(firestore: Firestore, ownerUid: string, videoId: string): DocumentReference {
  return firestore.collection(VIDEO_DELETION_COLLECTION).doc(`${ownerUid}_${videoId}`);
}

/**
 * Idempotent register replies must not advertise a video whose deletion has
 * begun. Legacy videos may not have a guard until the deletion is requested.
 */
export async function isVideoIdentityRetiring(
  firestore: Firestore,
  ownerUid: string,
  videoId: string
): Promise<boolean> {
  const [guard, deletion] = await Promise.all([
    identityRef(firestore, ownerUid, videoId).get(),
    deletionRef(firestore, ownerUid, videoId).get(),
  ]);
  return deletion.exists || (guard.exists && (
    guard.get('state') !== 'REGISTERED' ||
    guard.get('ownerUid') !== ownerUid ||
    guard.get('videoId') !== videoId
  ));
}

/**
 * Register atomically with the lifetime identity guard. The legacy deletion
 * queue is read in the SAME Firestore transaction to exclude old, unguarded
 * deletions; a create precondition prevents duplicate video documents.
 */
export async function commitPrivateVideoRegistrationIfUnused(
  firestore: Firestore,
  input: {
    ownerUid: string;
    videoId: string;
    videoRef: DocumentReference;
    publicationRef: DocumentReference;
    videoDocument: Record<string, unknown>;
    publicationDocument: Record<string, unknown>;
    now: number;
  }
): Promise<void> {
  if (!Number.isFinite(input.now)) throw new Error('Invalid video identity time.');
  const guardRef = identityRef(firestore, input.ownerUid, input.videoId);
  const pendingDeletionRef = deletionRef(firestore, input.ownerUid, input.videoId);
  await firestore.runTransaction(async (tx) => {
    const [guard, deletion] = await Promise.all([
      tx.get(guardRef),
      tx.get(pendingDeletionRef),
    ]);
    if (guard.exists || deletion.exists) throw new VideoIdentityUnavailableError();
    tx.create(guardRef, {
      ownerUid: input.ownerUid,
      videoId: input.videoId,
      state: 'REGISTERED',
      createdAt: input.now,
      updatedAt: input.now,
    });
    tx.create(input.videoRef, input.videoDocument);
    tx.set(input.publicationRef, input.publicationDocument);
  });
}

/**
 * Called in the SAME batch as unpublication and deletion-job creation.
 * A retired identity is never released by completion, lease expiration or
 * dead-letter cleanup; future uploads must use a fresh videoId.
 */
export function retireVideoIdentityInBatch(
  firestore: Firestore,
  batch: WriteBatch,
  ownerUid: string,
  videoId: string,
  now: number,
  identitySnapshot: DocumentSnapshot
): void {
  if (!Number.isFinite(now)) throw new Error('Invalid video identity retirement time.');
  const ref = identityRef(firestore, ownerUid, videoId);
  if (identitySnapshot.ref.path !== ref.path) {
    throw new Error('Video identity snapshot points to another video.');
  }
  const retirement = {
    ownerUid,
    videoId,
    state: 'RETIRED',
    retiredAt: now,
    updatedAt: now,
  };
  if (!identitySnapshot.exists) {
    // Exclusão e novo registro competem pela criação do mesmo documento.
    // Se o registro ganhar a corrida, o batch inteiro falha, inclusive o job.
    batch.create(ref, { ...retirement, createdAt: now });
    return;
  }
  if (!identitySnapshot.updateTime ||
      identitySnapshot.get('ownerUid') !== ownerUid ||
      identitySnapshot.get('videoId') !== videoId) {
    throw new Error('Video identity is not valid for this owner and video.');
  }
  // Impede aposentar um snapshot que mudou depois da leitura. Firestore
  // verifica a precondição junto com a retirada da publicação e criação do job.
  batch.update(ref, retirement, { lastUpdateTime: identitySnapshot.updateTime });
}

/**
 * Backfill the permanent guard for deletion jobs created before this protocol.
 * Token fencing ensures an expired/stale worker cannot change the guard.
 * Call before ANY external or Firestore deletion is attempted.
 */
export async function retireVideoIdentityForActiveClaim(
  firestore: Firestore,
  jobRef: DocumentReference,
  leaseToken: string,
  ownerUid: string,
  videoId: string,
  now: number
): Promise<'READY' | 'STALE' | 'CONFLICT'> {
  if (!Number.isFinite(now) || !leaseToken) throw new Error('Invalid active deletion claim.');
  const guardRef = identityRef(firestore, ownerUid, videoId);
  return firestore.runTransaction(async (tx) => {
    const [job, guard] = await Promise.all([tx.get(jobRef), tx.get(guardRef)]);
    const data = job.exists ? job.data() : null;
    if (!data || data['state'] !== 'retryable' || data['leaseToken'] !== leaseToken ||
        data['ownerUid'] !== ownerUid || data['videoId'] !== videoId ||
        !Number.isFinite(data['leaseUntil']) || data['leaseUntil'] <= now) {
      return 'STALE';
    }
    if (guard.exists && (
      guard.get('state') !== 'RETIRED' ||
      guard.get('ownerUid') !== ownerUid ||
      guard.get('videoId') !== videoId
    )) {
      // Um job legado não pode aposentar uma identidade ativa recém-criada.
      return 'CONFLICT';
    }
    if (!guard.exists) {
      tx.create(guardRef, {
        ownerUid, videoId, state: 'RETIRED', retiredAt: now, updatedAt: now,
      });
    }
    return 'READY';
  });
}
