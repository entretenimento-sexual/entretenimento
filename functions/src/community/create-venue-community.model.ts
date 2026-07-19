// functions/src/community/create-venue-community.model.ts
// -----------------------------------------------------------------------------
// CREATE VENUE COMMUNITY CONTRACT
// -----------------------------------------------------------------------------
// Normalização pura do comando que cria um Local e sua comunidade oficial no
// ambiente funcional controlado. Nenhum identificador, papel ou estado de
// moderação é aceito do cliente.
// -----------------------------------------------------------------------------

export type CreateVenueKind =
  | 'bar'
  | 'club'
  | 'restaurant'
  | 'pub'
  | 'event_space'
  | 'hotel'
  | 'other';

export type CreateVenueJoinPolicy = 'open' | 'approval';

export interface CreateVenueCommunityRequest {
  requestId?: unknown;
  name?: unknown;
  kind?: unknown;
  description?: unknown;
  region?: unknown;
  addressHint?: unknown;
  joinPolicy?: unknown;
}

export interface NormalizedCreateVenueCommunityRequest {
  requestId: string;
  venueId: string;
  communityId: string;
  name: string;
  slug: string;
  kind: CreateVenueKind;
  description: string | null;
  region: {
    uf: string;
    city: string;
    district: string | null;
  };
  addressHint: string | null;
  joinPolicy: CreateVenueJoinPolicy;
}

export interface CreateVenueCommunityResponse {
  venueId: string;
  communityId: string;
  created: boolean;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  const normalized = normalizeText(value, maxLength);
  return normalized || null;
}

function normalizeSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 72)
    .replace(/-+$/g, '');
}

function normalizeKind(value: unknown): CreateVenueKind | null {
  return value === 'bar'
    || value === 'club'
    || value === 'restaurant'
    || value === 'pub'
    || value === 'event_space'
    || value === 'hotel'
    || value === 'other'
    ? value
    : null;
}

export function normalizeCreateVenueCommunityRequest(
  raw: CreateVenueCommunityRequest | null | undefined
): NormalizedCreateVenueCommunityRequest | null {
  const requestId = normalizeText(raw?.requestId, 64);
  const name = normalizeText(raw?.name, 80);
  const kind = normalizeKind(raw?.kind);
  const region = (raw?.region ?? {}) as Record<string, unknown>;
  const uf = normalizeText(region['uf'], 2).toUpperCase();
  const city = normalizeText(region['city'], 80).toLowerCase();
  const district = normalizeOptionalText(region['district'], 80);
  const description = normalizeOptionalText(raw?.description, 240);
  const addressHint = normalizeOptionalText(raw?.addressHint, 160);
  const joinPolicy: CreateVenueJoinPolicy =
    raw?.joinPolicy === 'open' ? 'open' : 'approval';
  const slug = normalizeSlug(name);

  if (
    !REQUEST_ID_PATTERN.test(requestId)
    || name.length < 2
    || !kind
    || !/^[A-Z]{2}$/.test(uf)
    || city.length < 1
    || slug.length < 2
  ) {
    return null;
  }

  return {
    requestId,
    venueId: `venue-${requestId}`,
    communityId: `community-${requestId}`,
    name,
    slug,
    kind,
    description,
    region: { uf, city, district },
    addressHint,
    joinPolicy,
  };
}
