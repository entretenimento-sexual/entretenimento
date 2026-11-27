import type { FriendshipVersion } from '../interfaces/friendship/friend.interface';

/** Não converte em epoch: a versão de uma relação preserva nanossegundos. */
export function friendshipVersionOf(value: unknown): FriendshipVersion | null {
  if (!value || typeof value !== 'object') return null;
  const { seconds, nanoseconds } = value as Partial<FriendshipVersion>;
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) ||
      typeof nanoseconds !== 'number' || !Number.isInteger(nanoseconds) ||
      nanoseconds < 0 || nanoseconds >= 1_000_000_000) return null;
  return { seconds, nanoseconds };
}

export function isFriendshipAfter(value: FriendshipVersion | null | undefined,
  cutoff: FriendshipVersion | null | undefined): boolean {
  const a = friendshipVersionOf(value), b = friendshipVersionOf(cutoff);
  return !!a && !!b && (a.seconds > b.seconds ||
    (a.seconds === b.seconds && a.nanoseconds > b.nanoseconds));
}
