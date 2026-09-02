// functions/src/community/community-discovery-exposure-retention.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY EXPOSURE RETENTION
// -----------------------------------------------------------------------------
// Retenção operacional dos contadores agregados de exposição qualificada.
// Os IDs de dia são tratados como datas civis; nenhum dado de usuário participa
// do cálculo. O cursor permite recuperar dias perdidos sem varrer toda a base.
// -----------------------------------------------------------------------------

import { resolveCommunityDiscoveryExposureDay } from './community-discovery-exposure.policy';

export const COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_DAYS = 35;
export const COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_MAX_DAYS_PER_RUN = 31;

const DAY_MS = 24 * 60 * 60 * 1_000;
const DAY_ID_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDayId(value: unknown): Date | null {
  const normalized = String(value ?? '').trim();
  if (!DAY_ID_PATTERN.test(normalized)) return null;

  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return Number.isFinite(date.getTime())
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

function formatCalendarDay(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextCalendarDay(dayId: string): string | null {
  const date = parseDayId(dayId);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return formatCalendarDay(date);
}

export function resolveCommunityDiscoveryExposureRetentionCutoffDay(
  now: number
): string {
  const safeNow = Number.isFinite(now) && now > 0 ? Math.trunc(now) : Date.now();
  return resolveCommunityDiscoveryExposureDay(
    safeNow - COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_DAYS * DAY_MS
  );
}

export function buildCommunityDiscoveryExposureRetentionSweep(input: {
  readonly now: number;
  readonly lastPrunedDay?: unknown;
}): readonly string[] {
  const cutoffDay = resolveCommunityDiscoveryExposureRetentionCutoffDay(input.now);
  const lastPrunedDay = parseDayId(input.lastPrunedDay)
    ? String(input.lastPrunedDay).trim()
    : null;

  // No primeiro ciclo basta remover o dia que acabou de sair da janela.
  // A telemetria e o scheduler são introduzidos juntos, portanto não existe
  // histórico anterior a recuperar. Depois disso o cursor cobre interrupções.
  let currentDay = lastPrunedDay ? nextCalendarDay(lastPrunedDay) : cutoffDay;
  const days: string[] = [];

  while (
    currentDay
    && currentDay <= cutoffDay
    && days.length < COMMUNITY_DISCOVERY_EXPOSURE_RETENTION_MAX_DAYS_PER_RUN
  ) {
    days.push(currentDay);
    currentDay = nextCalendarDay(currentDay);
  }

  return days;
}
