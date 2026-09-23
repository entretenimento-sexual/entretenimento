// functions/src/moderation/moderation-reporter-abuse.policy.ts
// -----------------------------------------------------------------------------
// REPORTER ABUSE POLICY
// -----------------------------------------------------------------------------
// Sinal transversal de abuso do canal de denúncias.
// Nunca decide a validade de uma denúncia isolada e nunca decide maioridade.
// Apenas ajusta o custo do rate limit quando há padrão recente de denúncias
// rejeitadas sem confirmações pela moderação.
// -----------------------------------------------------------------------------

export const MODERATION_REPORTER_ABUSE_WINDOW_MS =
  30 * 24 * 60 * 60 * 1_000;
export const MODERATION_REPORTER_ELEVATED_REJECTION_THRESHOLD = 3;

export type ModerationReporterAbuseRisk = 'NORMAL' | 'ELEVATED';

export interface ModerationReporterAbuseState {
  readonly windowStartedAtMs: number;
  readonly rejectedReports: number;
  readonly confirmedReports: number;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function timestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

export function normalizeModerationReporterAbuseState(input: {
  state?: Partial<ModerationReporterAbuseState> | null;
  nowMs: number;
}): ModerationReporterAbuseState {
  const nowMs = timestamp(input.nowMs) || Date.now();
  const startedAt = timestamp(input.state?.windowStartedAtMs);
  const expired =
    startedAt <= 0 ||
    nowMs < startedAt ||
    nowMs - startedAt >= MODERATION_REPORTER_ABUSE_WINDOW_MS;

  if (expired) {
    return {
      windowStartedAtMs: nowMs,
      rejectedReports: 0,
      confirmedReports: 0,
    };
  }

  return {
    windowStartedAtMs: startedAt,
    rejectedReports: count(input.state?.rejectedReports),
    confirmedReports: count(input.state?.confirmedReports),
  };
}

export function moderationReporterAbuseRisk(
  state: ModerationReporterAbuseState
): ModerationReporterAbuseRisk {
  return state.rejectedReports >=
      MODERATION_REPORTER_ELEVATED_REJECTION_THRESHOLD &&
    state.confirmedReports === 0
    ? 'ELEVATED'
    : 'NORMAL';
}

export function applyModerationReporterOutcome(input: {
  state?: Partial<ModerationReporterAbuseState> | null;
  nowMs: number;
  confirmed: boolean;
}): {
  state: ModerationReporterAbuseState;
  risk: ModerationReporterAbuseRisk;
} {
  const current = normalizeModerationReporterAbuseState(input);

  const state: ModerationReporterAbuseState = {
    ...current,
    rejectedReports:
      current.rejectedReports + (input.confirmed ? 0 : 1),
    confirmedReports:
      current.confirmedReports + (input.confirmed ? 1 : 0),
  };

  return {
    state,
    risk: moderationReporterAbuseRisk(state),
  };
}

export function moderationReportRateLimitCost(
  risk: ModerationReporterAbuseRisk
): number {
  return risk === 'ELEVATED' ? 2 : 1;
}
