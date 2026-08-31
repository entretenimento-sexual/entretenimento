// src/app/core/domain/public-user-identity/public-user-identity.model.ts
// -----------------------------------------------------------------------------
// PUBLIC USER IDENTITY
// -----------------------------------------------------------------------------
// Contrato universal e sanitizado para representar um usuário em superfícies
// sociais: Comunidades, Chat, Pessoas, Conexões, notificações etc.
// Nunca contém nome civil, endereço detalhado ou dados de KYC.
// -----------------------------------------------------------------------------

import {
  PROFILE_IDENTITY_OPTIONS,
  resolveProfileIdentityOption,
  type ProfileIdentityDiscoveryGroup,
} from '../profile-identity/profile-identity.catalog';

export interface PublicUserIdentity {
  /** Identificador público opcional. Algumas projeções deliberadamente o omitem. */
  readonly profileId?: string | null;
  readonly nickname: string;
  /** Alias temporário para consumidores legados durante a migração. */
  readonly label: string;
  readonly avatarUrl: string | null;
  /** Código estável declarado pelo usuário (ex.: casal-ele-ela). */
  readonly identityCode?: string | null;
  /** Labels resolvidos pela camada canônica; não são a fonte persistente. */
  readonly identityLabel?: string | null;
  readonly identityShortLabel?: string | null;
  readonly discoveryGroup?: ProfileIdentityDiscoveryGroup | null;
  readonly city?: string | null;
  readonly state?: string | null;
  /** Aliases temporários usados por projeções de Comunidades já publicadas. */
  readonly profileType?: ProfileIdentityDiscoveryGroup | null;
  readonly profileTypeLabel?: string | null;
}

const DISCOVERY_GROUPS = new Set<ProfileIdentityDiscoveryGroup>([
  'man',
  'woman',
  'couple',
  'trans_woman',
  'trans_man',
  'travesti',
  'transgender',
  'crossdresser',
  'nonbinary',
]);

const BRAZILIAN_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

function normalizeText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint === 9 || codePoint === 10 || codePoint === 13) return ' ';
      return codePoint >= 32 && codePoint !== 127 ? character : '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

function normalizeMediaUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'https:') return parsed.toString();
    if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeState(value: unknown): string | null {
  // A projeção pública já deve transportar a UF canônica. Não truncamos nomes
  // completos para duas letras, pois isso poderia fabricar códigos inexistentes
  // como "RI" a partir de "Rio de Janeiro".
  const state = normalizeText(value, 40).toUpperCase();
  return BRAZILIAN_UFS.has(state) ? state : null;
}

function normalizeDiscoveryGroup(
  value: unknown
): ProfileIdentityDiscoveryGroup | null {
  return typeof value === 'string'
    && DISCOVERY_GROUPS.has(value as ProfileIdentityDiscoveryGroup)
    ? value as ProfileIdentityDiscoveryGroup
    : null;
}

function resolveGroupFallback(
  discoveryGroup: ProfileIdentityDiscoveryGroup | null
) {
  return discoveryGroup
    ? PROFILE_IDENTITY_OPTIONS.find(
        (option) => option.discoveryGroup === discoveryGroup
      ) ?? null
    : null;
}

export function normalizePublicUserIdentity(
  raw: unknown
): PublicUserIdentity | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const nickname = normalizeText(
    source['nickname'] ?? source['label'],
    60
  );
  if (nickname.length < 2) return null;

  const explicitIdentityCode = normalizeText(
    source['identityCode'] ?? source['declaredIdentityCode'],
    80
  ).toLowerCase() || null;
  const legacyGenderOption = explicitIdentityCode
    ? null
    : resolveProfileIdentityOption(
        normalizeText(source['gender'], 80).toLowerCase()
      );
  const identityCode = explicitIdentityCode ?? legacyGenderOption?.code ?? null;
  const identityOption = resolveProfileIdentityOption(identityCode);
  const discoveryGroup = identityOption?.discoveryGroup
    ?? normalizeDiscoveryGroup(
      source['identityDiscoveryGroup']
        ?? source['discoveryGroup']
        ?? source['profileType']
    );
  const groupFallback = resolveGroupFallback(discoveryGroup);
  const identityLabel = identityOption?.label
    ?? groupFallback?.shortLabel
    ?? null;
  const identityShortLabel = identityOption?.shortLabel
    ?? groupFallback?.shortLabel
    ?? null;

  return {
    profileId: normalizeText(source['profileId'] ?? source['uid'], 128) || null,
    nickname,
    label: nickname,
    avatarUrl: normalizeMediaUrl(source['avatarUrl'] ?? source['photoURL']),
    identityCode,
    identityLabel,
    identityShortLabel,
    discoveryGroup,
    city: normalizeText(source['city'] ?? source['municipio'], 80) || null,
    state: normalizeState(source['state'] ?? source['estado']),
    profileType: discoveryGroup,
    profileTypeLabel: identityShortLabel,
  };
}
