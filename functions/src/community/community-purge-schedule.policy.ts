// functions/src/community/community-purge-schedule.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE SCHEDULE POLICY
// -----------------------------------------------------------------------------
// O modo operacional é explícito e fail closed:
// - off: scheduler inerte;
// - dry_run: avalia readiness sem excluir dados;
// - execute: permite o executor destrutivo.
// Valores legados/ambíguos nunca habilitam exclusão.
// -----------------------------------------------------------------------------

export type CommunityPurgeScheduleMode = 'off' | 'dry_run' | 'execute';

export interface CommunityPurgeScheduleOptions {
  mode: CommunityPurgeScheduleMode;
  maxPerRun: number;
  pageSize: number;
  maxPagesPerStep: number;
}

const DEFAULT_MAX_PER_RUN = 20;
const MAX_MAX_PER_RUN = 100;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES_PER_STEP = 30;
const MAX_MAX_PAGES_PER_STEP = 100;

export function resolveCommunityPurgeScheduleOptions(
  rawConfig: unknown
): CommunityPurgeScheduleOptions {
  const config = (rawConfig ?? {}) as Record<string, unknown>;

  return {
    mode: normalizeMode(config['communityPurgeMode']),
    maxPerRun: normalizeInteger(
      config['communityPurgeMaxPerRun'],
      DEFAULT_MAX_PER_RUN,
      1,
      MAX_MAX_PER_RUN
    ),
    pageSize: normalizeInteger(
      config['communityPurgePageSize'],
      DEFAULT_PAGE_SIZE,
      1,
      MAX_PAGE_SIZE
    ),
    maxPagesPerStep: normalizeInteger(
      config['communityPurgeMaxPagesPerStep'],
      DEFAULT_MAX_PAGES_PER_STEP,
      1,
      MAX_MAX_PAGES_PER_STEP
    ),
  };
}

function normalizeMode(value: unknown): CommunityPurgeScheduleMode {
  return value === 'dry_run' || value === 'execute' ? value : 'off';
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));

  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}
