// src/app/community/presentation/community-official.presentation.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL PRESENTATION
// -----------------------------------------------------------------------------
// Única fonte de texto visual para a projeção pública de associação oficial.
// A UI nunca deduz autenticidade por plano, role, ownerUid ou source isolado.
// -----------------------------------------------------------------------------

import type { CommunityPreviewCard } from '../data-access/community-preview.model';

export interface CommunityOfficialPresentation {
  readonly label: string;
  readonly ariaLabel: string;
}

export function resolveCommunityOfficialPresentation(
  community: CommunityPreviewCard | null | undefined
): CommunityOfficialPresentation | null {
  const official = community?.officialAssociation;
  if (!community || official?.verified !== true) return null;

  const target = official.target;

  if (target.type === 'venue') {
    if (
      community.source.type === 'venue'
      && community.source.id === target.id
    ) {
      return {
        label: 'Local oficial',
        ariaLabel: 'Local com vínculo oficial verificado',
      };
    }

    return {
      label: 'Oficial do Local',
      ariaLabel: 'Comunidade com vínculo oficial verificado com um Local',
    };
  }

  if (target.type === 'profile') {
    return {
      label: 'Oficial do perfil',
      ariaLabel: 'Comunidade com vínculo oficial verificado com este perfil',
    };
  }

  if (target.type === 'organization') {
    return {
      label: 'Oficial da organização',
      ariaLabel: 'Comunidade com vínculo oficial verificado com uma organização',
    };
  }

  if (target.type === 'event') {
    return {
      label: 'Oficial do evento',
      ariaLabel: 'Comunidade com vínculo oficial verificado com um evento',
    };
  }

  return null;
}
