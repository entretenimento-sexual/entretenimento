// functions/src/community/community-official-verification-window.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL VERIFICATION WINDOW
// -----------------------------------------------------------------------------
// Define a janela operacional dos vínculos oficiais automáticos. Esta policy
// não decide autoridade; ela somente agenda nova checagem/expiração depois que
// a fonte canônica já foi validada pelo domínio responsável.
// -----------------------------------------------------------------------------

export const COMMUNITY_OFFICIAL_AUTOMATED_REVALIDATION_INTERVAL_MS =
  30 * 24 * 60 * 60 * 1_000;

export interface CommunityOfficialVerificationWindow {
  readonly revalidationDueAt: number | null;
  readonly verificationExpiresAt: number | null;
}

function futureEpoch(value: unknown, now: number): number | null {
  if (value === null || value === undefined) return null;
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) && normalized > now ? normalized : null;
}

function earliest(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length > 0 ? Math.min(...available) : null;
}

export function resolveCommunityOfficialVerificationWindow(input: {
  readonly now: number;
  readonly sourceRevalidationDueAt?: unknown;
  readonly sourceExpiryCandidates?: readonly unknown[];
}): Readonly<CommunityOfficialVerificationWindow> {
  const now = Math.trunc(Number(input.now));
  if (!Number.isFinite(now) || now <= 0) {
    return Object.freeze({
      revalidationDueAt: null,
      verificationExpiresAt: null,
    });
  }

  const verificationExpiresAt = earliest(
    (input.sourceExpiryCandidates ?? []).map((value) => futureEpoch(value, now))
  );
  const sourceRevalidationDueAt = futureEpoch(
    input.sourceRevalidationDueAt,
    now
  );
  const periodicRevalidationDueAt =
    now + COMMUNITY_OFFICIAL_AUTOMATED_REVALIDATION_INTERVAL_MS;
  const candidateRevalidationDueAt = earliest([
    sourceRevalidationDueAt,
    periodicRevalidationDueAt,
  ]);
  const revalidationDueAt =
    candidateRevalidationDueAt !== null
    && (
      verificationExpiresAt === null
      || candidateRevalidationDueAt < verificationExpiresAt
    )
      ? candidateRevalidationDueAt
      : null;

  return Object.freeze({
    revalidationDueAt,
    verificationExpiresAt,
  });
}
