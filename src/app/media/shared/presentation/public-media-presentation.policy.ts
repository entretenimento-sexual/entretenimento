import type { IPublicMediaContinuationContext } from 'src/app/core/interfaces/media/i-public-media-continuation-context';

export type PublicMediaRecommendationSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'sponsored'
  | 'boosted'
  | 'unknown'
  | null
  | undefined;

export interface PublicMediaRecommendationContext {
  readonly key:
    | 'profile'
    | 'network'
    | 'compatible'
    | 'latest'
    | 'top'
    | 'sponsored'
    | 'discover';
  readonly label: string;
  readonly ariaLabel: string;
  readonly iconClass: string;
  readonly commercial: boolean;
}

export function resolvePublicMediaRecommendationContext(input: {
  readonly source: PublicMediaRecommendationSource;
  readonly ownerUid: string | null | undefined;
  readonly continuationContext?: IPublicMediaContinuationContext | null;
}): PublicMediaRecommendationContext | null {
  const ownerUid = String(input.ownerUid ?? '').trim();
  const source = input.source ?? 'unknown';

  if (source === 'profile') {
    return Object.freeze({
      key: 'profile',
      label: 'Do perfil',
      ariaLabel: 'Motivo desta mídia no seu fluxo: Do perfil.',
      iconClass: 'fas fa-user',
      commercial: false,
    });
  }

  if (
    ownerUid &&
    input.continuationContext?.connectionOwnerUids?.includes(ownerUid)
  ) {
    return Object.freeze({
      key: 'network',
      label: 'Da sua rede',
      ariaLabel: 'Motivo desta mídia no seu fluxo: Da sua rede.',
      iconClass: 'fas fa-user-group',
      commercial: false,
    });
  }

  if (
    ownerUid &&
    input.continuationContext?.compatibleOwnerUids?.includes(ownerUid)
  ) {
    return Object.freeze({
      key: 'compatible',
      label: 'Sugestão para você',
      ariaLabel: 'Motivo desta mídia no seu fluxo: Sugestão para você.',
      iconClass: 'fas fa-compass',
      commercial: false,
    });
  }

  if (source === 'latest') {
    return Object.freeze({
      key: 'latest',
      label: 'Recente',
      ariaLabel: 'Motivo desta mídia no seu fluxo: Recente.',
      iconClass: 'fas fa-clock',
      commercial: false,
    });
  }

  if (source === 'top') {
    return Object.freeze({
      key: 'top',
      label: 'Em alta',
      ariaLabel: 'Motivo desta mídia no seu fluxo: Em alta.',
      iconClass: 'fas fa-arrow-trend-up',
      commercial: false,
    });
  }

  if (source === 'sponsored' || source === 'boosted') {
    return Object.freeze({
      key: 'sponsored',
      label: 'Patrocinado',
      ariaLabel: 'Motivo desta mídia no seu fluxo: Patrocinado.',
      iconClass: 'fas fa-bullhorn',
      commercial: true,
    });
  }

  if (source === 'discover') {
    return Object.freeze({
      key: 'discover',
      label: 'Descoberta',
      ariaLabel: 'Motivo desta mídia no seu fluxo: Descoberta.',
      iconClass: 'fas fa-compass',
      commercial: false,
    });
  }

  return null;
}

export function hasOfficialMediaContext(value: {
  readonly officialMediaContext?: {
    readonly contexts?: readonly unknown[] | null;
  } | null;
} | null | undefined): boolean {
  return (value?.officialMediaContext?.contexts?.length ?? 0) > 0;
}
