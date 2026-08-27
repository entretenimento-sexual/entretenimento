import { Observable, concat, defer, of, timer } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import type { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';

const HOUR_MS = 60 * 60 * 1000;

export function formatUserIntentStatusExpiresIn(
  expiresAt: number,
  now: number = Date.now()
): string {
  const remainingMs = Math.max(expiresAt - now, 0);
  const remainingHours = Math.ceil(remainingMs / HOUR_MS);

  if (remainingHours <= 1) {
    return 'Expira em até 1h';
  }

  return `Expira em ${remainingHours}h`;
}

export function projectActiveUserIntentStatusCards(
  items: readonly IUserIntentStatusCardVm[],
  now: number = Date.now()
): IUserIntentStatusCardVm[] {
  return (items ?? [])
    .filter((item) =>
      item.moderation.state === 'active' && item.expiresAt > now
    )
    .map((item) => ({
      ...item,
      expiresInLabel: formatUserIntentStatusExpiresIn(item.expiresAt, now),
      isActive: true,
    }));
}

export function getEarliestUserIntentStatusExpiryAt(
  items: readonly IUserIntentStatusCardVm[],
  now: number = Date.now()
): number | null {
  let earliestExpiryAt: number | null = null;

  for (const item of items ?? []) {
    if (item.moderation.state !== 'active' || item.expiresAt <= now) {
      continue;
    }

    if (earliestExpiryAt === null || item.expiresAt < earliestExpiryAt) {
      earliestExpiryAt = item.expiresAt;
    }
  }

  return earliestExpiryAt;
}

export function getNextUserIntentStatusTransitionAt(
  items: readonly IUserIntentStatusCardVm[],
  now: number = Date.now()
): number | null {
  let nextTransitionAt: number | null = null;

  for (const item of items ?? []) {
    if (item.moderation.state !== 'active' || item.expiresAt <= now) {
      continue;
    }

    const remainingMs = item.expiresAt - now;
    const remainingHours = Math.ceil(remainingMs / HOUR_MS);
    const labelTransitionAt = remainingHours > 1
      ? item.expiresAt - (remainingHours - 1) * HOUR_MS
      : item.expiresAt;
    const candidate = Math.max(labelTransitionAt, now + 1);

    if (nextTransitionAt === null || candidate < nextTransitionAt) {
      nextTransitionAt = candidate;
    }
  }

  return nextTransitionAt;
}

/**
 * Reprojeta os Momentos somente quando alguma informação temporal visível
 * realmente precisa mudar (rótulo de horas ou expiração). Uma nova emissão da
 * fonte Firestore cancela este relógio via switchMap no consumidor.
 */
export function watchUserIntentStatusTime$(
  items: readonly IUserIntentStatusCardVm[]
): Observable<readonly IUserIntentStatusCardVm[]> {
  return defer(() => {
    const now = Date.now();
    const projected = projectActiveUserIntentStatusCards(items, now);
    const nextTransitionAt = getNextUserIntentStatusTransitionAt(items, now);

    if (nextTransitionAt === null) {
      return of(projected);
    }

    const delayMs = Math.max(nextTransitionAt - now, 1);

    return concat(
      of(projected),
      timer(delayMs).pipe(
        switchMap(() => watchUserIntentStatusTime$(items))
      )
    );
  });
}

export function watchSingleUserIntentStatusTime$(
  item: IUserIntentStatusCardVm
): Observable<IUserIntentStatusCardVm | null> {
  return watchUserIntentStatusTime$([item]).pipe(
    map((items) => items[0] ?? null)
  );
}
