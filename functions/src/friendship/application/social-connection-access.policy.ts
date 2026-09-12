import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import { isActiveBlockData } from './bilateral-block-access.policy';

interface SocialConnectionAccessInput {
  actorFriendExists: boolean;
  targetFriendExists: boolean;
  actorBlock?: { isBlocked?: unknown } | null;
  targetBlock?: { isBlocked?: unknown } | null;
}

export interface SocialConnectionAccessResolution {
  readonly friendTargetUids: ReadonlySet<string>;
  readonly blockedTargetUids: ReadonlySet<string>;
}

function normalizeUid(value: unknown): string {
  const uid = String(value ?? '').trim();
  return uid && uid.length <= 128 && !uid.includes('/') ? uid : '';
}

export function evaluateSocialConnectionAccess(
  input: SocialConnectionAccessInput
): { isFriend: boolean; isBlocked: boolean } {
  const isBlocked =
    isActiveBlockData(input.actorBlock) || isActiveBlockData(input.targetBlock);

  return {
    isBlocked,
    isFriend:
      !isBlocked && input.actorFriendExists && input.targetFriendExists,
  };
}

/**
 * Revalida, em uma única leitura em lote, a relação social usada para conteúdo
 * restrito. A audiência FRIENDS exige as duas arestas porque as Rules legadas
 * ainda permitem ao próprio usuário manter a sua aresta local; uma declaração
 * unilateral nunca pode liberar conteúdo do outro perfil.
 */
export async function resolveSocialConnectionAccess(
  actorUid: string,
  targetUids: readonly string[]
): Promise<SocialConnectionAccessResolution> {
  const actor = normalizeUid(actorUid);

  if (!actor) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const targets = [
    ...new Set(
      (targetUids ?? [])
        .map((value) => normalizeUid(value))
        .filter((value) => value && value !== actor)
    ),
  ];

  if (!targets.length) {
    return {
      friendTargetUids: new Set<string>(),
      blockedTargetUids: new Set<string>(),
    };
  }

  const refs = targets.flatMap((targetUid) => [
    db.doc(`users/${actor}/friends/${targetUid}`),
    db.doc(`users/${targetUid}/friends/${actor}`),
    db.doc(`users/${actor}/blocks/${targetUid}`),
    db.doc(`users/${targetUid}/blocks/${actor}`),
  ]);
  const snapshots = await db.getAll(...refs);
  const friendTargetUids = new Set<string>();
  const blockedTargetUids = new Set<string>();

  targets.forEach((targetUid, index) => {
    const offset = index * 4;
    const actorFriendSnapshot = snapshots[offset];
    const targetFriendSnapshot = snapshots[offset + 1];
    const actorBlockSnapshot = snapshots[offset + 2];
    const targetBlockSnapshot = snapshots[offset + 3];
    const resolution = evaluateSocialConnectionAccess({
      actorFriendExists: actorFriendSnapshot?.exists === true,
      targetFriendExists: targetFriendSnapshot?.exists === true,
      actorBlock: actorBlockSnapshot?.exists
        ? actorBlockSnapshot.data()
        : null,
      targetBlock: targetBlockSnapshot?.exists
        ? targetBlockSnapshot.data()
        : null,
    });

    if (resolution.isBlocked) {
      blockedTargetUids.add(targetUid);
      return;
    }

    if (resolution.isFriend) {
      friendTargetUids.add(targetUid);
    }
  });

  return { friendTargetUids, blockedTargetUids };
}
