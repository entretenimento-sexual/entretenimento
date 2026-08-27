import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';

interface BlockDocumentData {
  isBlocked?: unknown;
}

function normalizeUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return uid && uid.length <= 128 && !uid.includes('/') ? uid : '';
}

export function isActiveBlockData(
  data: BlockDocumentData | null | undefined
): boolean {
  return data?.isBlocked === true;
}

export function buildBilateralBlockPaths(
  actorUid: string,
  targetUid: string
): readonly [string, string] {
  const actor = normalizeUid(actorUid);
  const target = normalizeUid(targetUid);

  if (!actor || !target) {
    return ['', ''];
  }

  return [
    `users/${actor}/blocks/${target}`,
    `users/${target}/blocks/${actor}`,
  ] as const;
}

export function isBilateralBlockActive(input: {
  actorBlock?: BlockDocumentData | null;
  targetBlock?: BlockDocumentData | null;
}): boolean {
  return isActiveBlockData(input.actorBlock) ||
    isActiveBlockData(input.targetBlock);
}

export async function resolveBlockedTargetUids(
  actorUid: string,
  targetUids: readonly string[]
): Promise<Set<string>> {
  const actor = normalizeUid(actorUid);

  if (!actor) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const targets = [
    ...new Set(
      targetUids
        .map((value) => normalizeUid(value))
        .filter((value) => value && value !== actor)
    ),
  ];

  if (!targets.length) {
    return new Set<string>();
  }

  const refs = targets.flatMap((targetUid) => {
    const [actorBlockPath, targetBlockPath] = buildBilateralBlockPaths(
      actor,
      targetUid
    );

    return [db.doc(actorBlockPath), db.doc(targetBlockPath)];
  });
  const snapshots = await db.getAll(...refs);
  const blocked = new Set<string>();

  targets.forEach((targetUid, index) => {
    const actorBlockSnapshot = snapshots[index * 2];
    const targetBlockSnapshot = snapshots[index * 2 + 1];

    if (
      isBilateralBlockActive({
        actorBlock: actorBlockSnapshot?.exists
          ? actorBlockSnapshot.data() as BlockDocumentData
          : null,
        targetBlock: targetBlockSnapshot?.exists
          ? targetBlockSnapshot.data() as BlockDocumentData
          : null,
      })
    ) {
      blocked.add(targetUid);
    }
  });

  return blocked;
}

export async function assertNoActiveBilateralBlock(
  actorUid: string,
  targetUid: string,
  unavailableMessage = 'Conteúdo indisponível.'
): Promise<void> {
  const target = normalizeUid(targetUid);

  if (!target || normalizeUid(actorUid) === target) {
    return;
  }

  const blocked = await resolveBlockedTargetUids(actorUid, [target]);

  if (blocked.has(target)) {
    throw new HttpsError('not-found', unavailableMessage);
  }
}

export async function assertNoActiveBilateralBlockInTransaction(
  transaction: Transaction,
  actorUid: string,
  targetUid: string,
  unavailableMessage = 'Conteúdo indisponível.'
): Promise<void> {
  const actor = normalizeUid(actorUid);
  const target = normalizeUid(targetUid);

  if (!actor || !target || actor === target) {
    return;
  }

  const [actorBlockPath, targetBlockPath] = buildBilateralBlockPaths(
    actor,
    target
  );
  const [actorBlockSnapshot, targetBlockSnapshot] = await Promise.all([
    transaction.get(db.doc(actorBlockPath)),
    transaction.get(db.doc(targetBlockPath)),
  ]);

  if (
    isBilateralBlockActive({
      actorBlock: actorBlockSnapshot.exists
        ? actorBlockSnapshot.data() as BlockDocumentData
        : null,
      targetBlock: targetBlockSnapshot.exists
        ? targetBlockSnapshot.data() as BlockDocumentData
        : null,
    })
  ) {
    throw new HttpsError('not-found', unavailableMessage);
  }
}
