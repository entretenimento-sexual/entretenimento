import type { CommunityOfficialTargetType } from 'src/app/core/community/community-official-association.model';
import type { CommunityDiscoveryPage } from './community-preview.model';

export interface CommunityOfficialTarget {
  readonly type: CommunityOfficialTargetType;
  readonly id: string;
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
