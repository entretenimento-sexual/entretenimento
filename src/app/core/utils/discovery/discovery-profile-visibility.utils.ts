// src/app/core/utils/discovery/discovery-profile-visibility.utils.ts
// -----------------------------------------------------------------------------
// DiscoveryProfileVisibilityUtils
// -----------------------------------------------------------------------------
//
// Regra compartilhada de elegibilidade pública para discovery.
//
// Objetivo:
// - evitar que "Todos", "Online", "Perto" e futuros modos usem critérios
//   conflitantes;
// - impedir exposição de perfis sem identidade pública mínima;
// - permitir critérios diferentes por modo sem duplicar regra em componentes.
//
// Importante:
// - esta camada decide se um perfil pode aparecer em determinado modo;
// - ela não calcula score;
// - ela não consulta Firestore;
// - ela não calcula distância;
// - ela não decide ordenação.
//
// Regra de produto:
// - "Todos" é mais exigente, porque funciona como feed geral qualificado;
// - "Online" não deve morrer por ausência de cidade/gênero se o perfil tem
//   uid, nickname e presença online;
// - "Hoje" usa status temporários moderados como fonte principal;
// - "Perto" depende de coordenadas;
// - "Região" depende de estado ou município;
// - modos futuros podem começar com regra mínima e depois ganhar critérios.

import { extractValidGeoCoordinates } from 'src/app/core/services/geolocation/utils/geolocation-coordinate.utils';

export type PublicDiscoveryMode =
  | 'all'
  | 'online'
  | 'today'
  | 'nearby'
  | 'region'
  | 'recent'
  | 'trending'
  | 'compatible';

export type PublicDiscoveryProfileRejectionReason =
  | 'missing_profile'
  | 'missing_uid'
  | 'hidden_from_online'
  | 'missing_nickname'
  | 'missing_gender'
  | 'missing_estado'
  | 'missing_municipio'
  | 'missing_region'
  | 'missing_coordinates'
  | 'not_online'
  | null;

export interface PublicDiscoveryVisibilityContext {
  mode?: PublicDiscoveryMode;
}

export interface PublicDiscoveryProfileLike {
  uid?: unknown;
  nickname?: unknown;

  gender?: unknown;

  estado?: unknown;
  municipio?: unknown;

  latitude?: unknown;
  longitude?: unknown;

  isOnline?: unknown;

  hideFromOnline?: unknown;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasRegion(profile: PublicDiscoveryProfileLike): boolean {
  return hasText(profile.estado) || hasText(profile.municipio);
}

function hasCoordinates(profile: PublicDiscoveryProfileLike): boolean {
  return !!extractValidGeoCoordinates(profile);
}

function getBaseRejectionReason(
  profile: PublicDiscoveryProfileLike | null | undefined
): PublicDiscoveryProfileRejectionReason {
  if (!profile) {
    return 'missing_profile';
  }

  if (!hasText(profile.uid)) {
    return 'missing_uid';
  }

  if (profile.hideFromOnline === true) {
    return 'hidden_from_online';
  }

  if (!hasText(profile.nickname)) {
    return 'missing_nickname';
  }

  return null;
}

/**
 * Regra de elegibilidade por modo.
 *
 * Mantém compatibilidade:
 * - chamada antiga sem contexto continua assumindo mode = "all".
 */
export function getPublicDiscoveryProfileRejectionReason(
  profile: PublicDiscoveryProfileLike | null | undefined,
  context: PublicDiscoveryVisibilityContext = {}
): PublicDiscoveryProfileRejectionReason {
  const baseReason = getBaseRejectionReason(profile);

  if (baseReason !== null) {
    return baseReason;
  }

  const safeProfile = profile as PublicDiscoveryProfileLike;
  const mode = context.mode ?? 'all';

  switch (mode) {
    case 'online': {
      if (safeProfile.isOnline !== true) {
        return 'not_online';
      }

      return null;
    }

    case 'nearby': {
      if (!hasCoordinates(safeProfile)) {
        return 'missing_coordinates';
      }

      return null;
    }

    case 'region': {
      if (!hasRegion(safeProfile)) {
        return 'missing_region';
      }

      return null;
    }

    case 'today': {
      /**
       * A listagem de Hoje nasce de user_intent_statuses e já exige um perfil
       * mínimo, moderação ativa e expiração válida antes de chegar à interface.
       */
      return null;
    }

    case 'recent':
    case 'trending':
    case 'compatible': {
      /**
       * Para modos futuros, começamos com contrato público mínimo.
       * Score/filtros específicos entram na camada de enriquecimento.
       */
      return null;
    }

    case 'all':
    default: {
      /**
       * "Todos" é o feed geral qualificado.
       * Por isso continua mais rígido.
       */
      if (!hasText(safeProfile.gender)) {
        return 'missing_gender';
      }

      if (!hasText(safeProfile.estado)) {
        return 'missing_estado';
      }

      if (!hasText(safeProfile.municipio)) {
        return 'missing_municipio';
      }

      return null;
    }
  }
}

export function canExposePublicDiscoveryProfile(
  profile: PublicDiscoveryProfileLike | null | undefined,
  context: PublicDiscoveryVisibilityContext = {}
): boolean {
  return getPublicDiscoveryProfileRejectionReason(profile, context) === null;
}
