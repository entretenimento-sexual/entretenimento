// src/app/core/utils/discovery/discovery-profile-sort.utils.ts
// -----------------------------------------------------------------------------
// DiscoveryProfileSortUtils
// -----------------------------------------------------------------------------
//
// Ordenação reutilizável para listas de perfis exibíveis.
//
// Critérios atuais:
// 1. online primeiro;
// 2. menor distância, quando existir;
// 3. role/tier mais forte;
// 4. perfis com foto antes de perfis sem foto;
// 5. atualização/criação mais recente;
// 6. município;
// 7. nickname.
export interface DiscoverableProfileSortInput {
  uid?: string | null;
  nickname?: string | null;
  role?: string | null;
  tier?: string | null;
  photoURL?: string | null;
  municipio?: string | null;
  distanciaKm?: number | null;
  isOnline?: boolean | null;
  updatedAt?: unknown;
  createdAt?: unknown;
  lastSeen?: unknown;
  lastOnlineAt?: unknown;
}

const ROLE_PRIORITY: Record<string, number> = {
  vip: 1,
  premium: 2,
  basic: 3,
  free: 4,
  visitante: 5,
};

function getSafeDistance(profile: DiscoverableProfileSortInput): number {
  return typeof profile.distanciaKm === 'number' &&
    Number.isFinite(profile.distanciaKm)
    ? profile.distanciaKm
    : Number.POSITIVE_INFINITY;
}

function getRolePriority(profile: DiscoverableProfileSortInput): number {
  const raw = String(profile.role || profile.tier || 'free')
    .trim()
    .toLowerCase();

  return ROLE_PRIORITY[raw] ?? 5;
}

function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof value === 'string') {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  const maybeTimestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
  } | null | undefined;

  if (typeof maybeTimestamp?.toMillis === 'function') {
    const time = maybeTimestamp.toMillis();
    return Number.isFinite(time) ? time : 0;
  }

  if (typeof maybeTimestamp?.toDate === 'function') {
    const time = maybeTimestamp.toDate().getTime();
    return Number.isFinite(time) ? time : 0;
  }

  return 0;
}

function getRecencyScore(profile: DiscoverableProfileSortInput): number {
  return Math.max(
    toMillis(profile.lastOnlineAt),
    toMillis(profile.lastSeen),
    toMillis(profile.updatedAt),
    toMillis(profile.createdAt)
  );
}

/**
 * Comparador estável para cards de perfis.
 */
export function compareDiscoverableProfilesStable<
  T extends DiscoverableProfileSortInput,
>(a: T, b: T): number {
  if (a.isOnline === true && b.isOnline !== true) return -1;
  if (a.isOnline !== true && b.isOnline === true) return 1;

  const da = getSafeDistance(a);
  const db = getSafeDistance(b);

  if (da !== db) {
    return da - db;
  }

  const ra = getRolePriority(a);
  const rb = getRolePriority(b);

  if (ra !== rb) {
    return ra - rb;
  }

  if (!a.photoURL && b.photoURL) return 1;
  if (a.photoURL && !b.photoURL) return -1;

  const recentA = getRecencyScore(a);
  const recentB = getRecencyScore(b);

  if (recentA !== recentB) {
    return recentB - recentA;
  }

  const municipioCompare = String(a.municipio || '').localeCompare(
    String(b.municipio || ''),
    'pt-BR',
    { sensitivity: 'base' }
  );

  if (municipioCompare !== 0) {
    return municipioCompare;
  }

  return String(a.nickname || '').localeCompare(
    String(b.nickname || ''),
    'pt-BR',
    { sensitivity: 'base' }
  );
}