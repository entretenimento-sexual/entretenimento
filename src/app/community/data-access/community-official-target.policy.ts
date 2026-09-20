import type { CommunityOfficialTargetType } from 'src/app/core/community/community-official-association.model';
import { normalizePublicProfileId } from 'src/app/core/domain/public-user-identity/public-profile-id.model';
import type { CommunityDiscoveryPage } from './community-preview.model';

export interface CommunityOfficialTarget {
  readonly type: CommunityOfficialTargetType;
  readonly id: string;
}

const SAFE_GENERIC_TARGET_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeTargetType(
  value: unknown
): CommunityOfficialTargetType | null {
  return value === 'profile'
    || value === 'organization'
    || value === 'venue'
    || value === 'event'
    ? value
    : null;
}

function normalizeGenericTargetId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_GENERIC_TARGET_ID_PATTERN.test(normalized)
    ? normalized
    : null;
}

/**
 * Normalização única do alvo oficial no frontend.
 *
 * Perfil usa o identificador público opaco e canônico, inclusive normalização
 * para minúsculas. Organização, Local e Evento preservam o identificador
 * canônico recebido do domínio e aceitam apenas o formato seguro compartilhado
 * com a fronteira backend.
 */
export function normalizeCommunityOfficialTarget(
  raw: unknown
): CommunityOfficialTarget | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const type = normalizeTargetType(source['type']);
  if (!type) return null;

  const id = type === 'profile'
    ? normalizePublicProfileId(source['id'])
    : normalizeGenericTargetId(source['id']);

  return id ? { type, id } : null;
}

/**
 * Defesa em profundidade para superfícies públicas de oficialidade.
 * O backend continua sendo a autoridade e já filtra a projeção; o cliente
 * rejeita qualquer card inconsistente caso uma resposta inválida atravesse
 * essa fronteira por erro de projeção, cache ou contrato.
 */
export function retainCommunitiesForOfficialTarget(
  page: CommunityDiscoveryPage,
  target: Readonly<CommunityOfficialTarget>
): CommunityDiscoveryPage {
  return {
    ...page,
    items: page.items.filter((item) => {
      const association = item.officialAssociation;

      return association?.verified === true
        && association.target.type === target.type
        && association.target.id === target.id;
    }),
  };
}
