// functions/src/authority/event-authority.policy.ts
// -----------------------------------------------------------------------------
// CANONICAL EVENT AUTHORITY
// -----------------------------------------------------------------------------
// Fonte backend-only de autoridade sobre Evento. Nenhum campo do documento
// público do evento, creatorUid ou payload do navegador concede autoridade.
// O vínculo precisa existir em event_authority_records/{eventId}:{holderUid}.
// -----------------------------------------------------------------------------

import {
  normalizeCanonicalAuthorityResourceId,
  type CanonicalResourceAuthorityRole,
} from './canonical-resource-authority.model';

export const EVENT_AUTHORITY_POLICY_VERSION = 1;

export type CanonicalEventAuthorityRole = Extract<
  CanonicalResourceAuthorityRole,
  'organizer' | 'promoter' | 'responsible'
>;

export type EventAuthorityDenialReason =
  | 'record_invalid'
  | 'authority_inactive'
  | 'event_inactive'
  | 'authority_mismatch';

export interface EventAuthorityDecision {
  readonly allowed: boolean;
  readonly eventId: string;
  readonly holderUid: string | null;
  readonly role: CanonicalEventAuthorityRole | null;
  readonly sponsorOrganizationId: string | null;
  readonly verificationPolicyVersion: number | null;
  readonly denialReason: EventAuthorityDenialReason | null;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeRole(value: unknown): CanonicalEventAuthorityRole | null {
  return value === 'organizer'
    || value === 'promoter'
    || value === 'responsible'
    ? value
    : null;
}

function denied(input: {
  eventId: string;
  holderUid?: string | null;
  denialReason: EventAuthorityDenialReason;
}): Readonly<EventAuthorityDecision> {
  return Object.freeze({
    allowed: false,
    eventId: input.eventId,
    holderUid: input.holderUid ?? null,
    role: null,
    sponsorOrganizationId: null,
    verificationPolicyVersion: null,
    denialReason: input.denialReason,
  });
}

export function buildEventAuthorityRecordId(
  eventIdValue: unknown,
  holderUidValue: unknown
): string | null {
  const eventId = normalizeCanonicalAuthorityResourceId(eventIdValue);
  const holderUid = normalizeCanonicalAuthorityResourceId(holderUidValue);
  return eventId && holderUid ? `${eventId}:${holderUid}` : null;
}

export function evaluateEventAuthority(input: {
  readonly actorUid: string;
  readonly eventId: string;
  readonly rawAuthorityRecord: unknown;
  readonly now?: number;
}): Readonly<EventAuthorityDecision> {
  const actorUid = normalizeCanonicalAuthorityResourceId(input.actorUid);
  const eventId = normalizeCanonicalAuthorityResourceId(input.eventId) ?? '';
  const source = asRecord(input.rawAuthorityRecord);

  if (!actorUid || !eventId || !source) {
    return denied({
      eventId,
      holderUid: actorUid,
      denialReason: 'record_invalid',
    });
  }

  const sourceEventId = normalizeCanonicalAuthorityResourceId(source['eventId']);
  const holderUid = normalizeCanonicalAuthorityResourceId(source['holderUid']);
  const role = normalizeRole(source['role']);
  const policyVersion = Math.trunc(Number(source['policyVersion']));
  const startsAt = normalizeEpoch(source['startsAt']);
  const endsAt = source['endsAt'] === null || source['endsAt'] === undefined
    ? null
    : normalizeEpoch(source['endsAt']);
  const revalidationDueAt =
    source['revalidationDueAt'] === null || source['revalidationDueAt'] === undefined
      ? null
      : normalizeEpoch(source['revalidationDueAt']);
  const sponsorOrganizationId =
    source['sponsorOrganizationId'] === null
      || source['sponsorOrganizationId'] === undefined
      || String(source['sponsorOrganizationId']).trim() === ''
      ? null
      : normalizeCanonicalAuthorityResourceId(source['sponsorOrganizationId']);
  const now = Math.trunc(input.now ?? Date.now());

  if (sourceEventId !== eventId || holderUid !== actorUid) {
    return denied({
      eventId,
      holderUid,
      denialReason: 'authority_mismatch',
    });
  }

  if (
    !role
    || policyVersion !== EVENT_AUTHORITY_POLICY_VERSION
    || !startsAt
    || !Number.isFinite(now)
    || now <= 0
    || (source['endsAt'] !== null && source['endsAt'] !== undefined && !endsAt)
    || (
      source['revalidationDueAt'] !== null
      && source['revalidationDueAt'] !== undefined
      && !revalidationDueAt
    )
    || (
      source['sponsorOrganizationId'] !== null
      && source['sponsorOrganizationId'] !== undefined
      && String(source['sponsorOrganizationId']).trim() !== ''
      && !sponsorOrganizationId
    )
  ) {
    return denied({ eventId, holderUid, denialReason: 'record_invalid' });
  }

  if (source['eventStatus'] !== 'active') {
    return denied({ eventId, holderUid, denialReason: 'event_inactive' });
  }

  if (
    source['status'] !== 'active'
    || source['revokedAt'] !== null
    || startsAt > now
    || (endsAt !== null && endsAt <= now)
    || (revalidationDueAt !== null && revalidationDueAt <= now)
  ) {
    return denied({ eventId, holderUid, denialReason: 'authority_inactive' });
  }

  return Object.freeze({
    allowed: true,
    eventId,
    holderUid,
    role,
    sponsorOrganizationId,
    verificationPolicyVersion: policyVersion,
    denialReason: null,
  });
}
