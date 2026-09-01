// functions/src/identity/public-user-identity.model.ts
// -----------------------------------------------------------------------------
// PUBLIC USER IDENTITY - BACKEND
// -----------------------------------------------------------------------------
// Projeção pública e coarse da identidade social. A origem é a declaração do
// usuário/public_profile; KYC, nome civil e endereço detalhado nunca participam.
// -----------------------------------------------------------------------------

import { normalizePublicIdentityMediaUrl } from './public-media-url.normalizer';
import { normalizePublicProfileId } from './public-profile-id';
import {
  resolveProfileIdentityOption,
  type ProfileIdentityDiscoveryGroup,
} from './profile-identity.catalog';

export interface PublicUserIdentity {
  profileId?: string | null;
  nickname: string;
  /** Alias temporário para consumidores legados. */
  label: string;
  avatarUrl: string | null;
  identityCode?: string | null;
  identityLabel?: string | null;
  identityShortLabel?: string | null;
  discoveryGroup?: ProfileIdentityDiscoveryGroup | null;
  city?: string | null;
  state?: string | null;
  /** Aliases temporários usados por Comunidades durante a migração. */
  profileType?: ProfileIdentityDiscoveryGroup | null;
  profileTypeLabel?: string | null;
}

export interface PublicUserIdentityFallback {
  label: string;
  avatarUrl: string | null;
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

const STATE_TO_UF: Readonly<Record<string, string>> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};

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

function normalizeState(value: unknown): string | null {
  const text = normalizeText(value, 40);
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();

  const lookupKey = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return STATE_TO_UF[lookupKey] ?? null;
}

function normalizeDiscoveryGroup(value: unknown): ProfileIdentityDiscoveryGroup | null {
  return typeof value === 'string'
    && DISCOVERY_GROUPS.has(value as ProfileIdentityDiscoveryGroup)
    ? value as ProfileIdentityDiscoveryGroup
    : null;
}

export function buildPublicUserIdentity(
  rawProfile: unknown,
  fallback: PublicUserIdentityFallback
): PublicUserIdentity {
  const source = (rawProfile ?? {}) as Record<string, unknown>;
  const identityCode = normalizeText(
    source['identityCode']
      ?? source['declaredIdentityCode']
      ?? source['gender'],
    80
  ).toLowerCase() || null;
  const identityOption = resolveProfileIdentityOption(identityCode);
  const nickname = normalizeText(source['nickname'], 60)
    || normalizeText(fallback.label, 60)
    || 'Participante';
  const discoveryGroup = normalizeDiscoveryGroup(source['identityDiscoveryGroup'])
    ?? identityOption?.discoveryGroup
    ?? null;
  const identityLabel = normalizeText(source['identityLabel'], 80)
    || identityOption?.label
    || null;
  const identityShortLabel = normalizeText(source['identityShortLabel'], 80)
    || identityOption?.shortLabel
    || identityLabel;

  return {
    profileId: normalizePublicProfileId(source['profileId']),
    nickname,
    label: nickname,
    avatarUrl:
      normalizePublicIdentityMediaUrl(source['avatarUrl'])
      ?? normalizePublicIdentityMediaUrl(source['photoURL'])
      ?? normalizePublicIdentityMediaUrl(fallback.avatarUrl),
    identityCode,
    identityLabel,
    identityShortLabel,
    discoveryGroup,
    city: normalizeText(source['municipio'], 80) || null,
    state: normalizeState(source['estado']),
    profileType: discoveryGroup,
    profileTypeLabel: identityShortLabel,
  };
}
