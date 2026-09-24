// src/app/community/presentation/community-social-space.adapter.ts
// -----------------------------------------------------------------------------
// COMMUNITY SOCIAL-SPACE ADAPTER
// -----------------------------------------------------------------------------
// Community e Venue reutilizam infraestrutura social, mas não são o mesmo produto.
// Este adapter concentra as diferenças de copy, navegação e capacidades usadas
// pelas superfícies hospedadas em /community. Components devem consumir este
// contrato em vez de espalhar comparações literais de source.type.
// -----------------------------------------------------------------------------

import type {
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import {
  getSocialSpaceDefinition,
  type SocialSpaceCapabilities,
  type SocialSpaceDefinition,
} from 'src/app/core/domain/social-space.definition';
import type { CommunityFeedView } from '../data-access/community-feed.model';
import type {
  CommunityPreviewJoinPolicy,
  CommunityPreviewSourceType,
  CommunityPreviewViewerMode,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';

export type CommunitySocialSpaceDiscoveryMode = 'explore' | 'mine';
export type CommunityMembershipActionKind = 'request' | 'leave';
export type CommunityMembershipResultStatus = 'active' | 'pending' | 'left';

export interface CommunitySocialSpaceFeedPresentation {
  readonly sectionLabel: string;
  readonly ariaLabel: string;
  readonly loadingLabel: string;
  readonly errorLabel: string;
  readonly emptyLabel: string;
}

export interface CommunitySocialSpaceAdapter {
  readonly sourceType: CommunityPreviewSourceType;
  readonly definition: SocialSpaceDefinition;
  readonly capabilities: Readonly<SocialSpaceCapabilities>;
  readonly ownerRoleLabel: string;
  readonly showKindBadge: boolean;
  readonly officialEntityTargetType: 'venue' | null;
  readonly discovery: {
    readonly hubTitle: string;
    readonly emptyExploreMessage: string;
    readonly canCreateVenue: boolean;
    readonly canCreateCommunity: boolean;
    detailsRoute(
      communityId: string,
      mode: CommunitySocialSpaceDiscoveryMode
    ): readonly string[];
    returnTarget(
      mode: CommunitySocialSpaceDiscoveryMode,
      selectedTagId: string | null
    ): string;
  };
  readonly membership: {
    actionLabel(join: CommunityPreviewJoinPolicy): string;
    joinLabel(join: CommunityPreviewJoinPolicy): string;
    leaveActionLabel(join: CommunityPreviewJoinPolicy): string;
    interactionRestrictedLabel: string;
    successMessage(input: {
      readonly kind: CommunityMembershipActionKind;
      readonly resultStatus: CommunityMembershipResultStatus;
      readonly pending: boolean;
    }): string;
    errorFallback(kind: CommunityMembershipActionKind): string;
    leaveConfirmation(input: {
      readonly viewerMode: CommunityPreviewViewerMode;
      readonly viewerRole: CommunityPreviewViewerRole | null;
      readonly join: CommunityPreviewJoinPolicy;
    }): ConfirmationDialogData;
  };
  feed(view: CommunityFeedView): CommunitySocialSpaceFeedPresentation;
  readonly management: {
    readonly requestsTitle: string;
    readonly hubTitle: string;
    readonly hubDescription: string;
    readonly emptyRequestsMessage: string;
    approvalSuccessMessage(label: string): string;
    readonly loadRequestsError: string;
    readonly reviewRequestError: string;
  };
}

interface SocialSpaceCopy {
  readonly ownerRoleLabel: string;
  readonly showKindBadge: boolean;
  readonly officialEntityTargetType: 'venue' | null;
  readonly discovery: {
    readonly hubTitle: string;
    readonly emptyExploreMessage: string;
    readonly canCreateVenue: boolean;
    readonly canCreateCommunity: boolean;
  };
  readonly membership: {
    readonly openAction: string;
    readonly restrictedAction: string;
    readonly joinLabels: Readonly<Record<CommunityPreviewJoinPolicy, string>>;
    readonly leaveOpenAction: string;
    readonly leaveRestrictedAction: string;
    readonly interactionRestrictedLabel: string;
    readonly activeSuccess: string;
    readonly pendingSuccess: string;
    readonly leftSuccess: string;
    readonly leaveError: string;
    readonly requestError: string;
  };
  readonly feed: {
    readonly sectionLabel: string;
    readonly ariaLabel: string;
    readonly loadingLabel: string;
    readonly errorLabel: string;
    readonly emptyLabel: string;
    readonly photosAriaLabel: string;
  };
  readonly management: {
    readonly requestsTitle: string;
    readonly hubTitle: string;
    readonly hubDescription: string;
    readonly emptyRequestsMessage: string;
    readonly approvalSuccessSuffix: string;
    readonly loadRequestsError: string;
    readonly reviewRequestError: string;
  };
  readonly leave: {
    readonly owner: ConfirmationDialogData;
    readonly admin: ConfirmationDialogData;
    readonly moderator: ConfirmationDialogData;
    readonly member: Omit<ConfirmationDialogData, 'detail'>;
  };
}

const COPY: Readonly<Record<CommunityPreviewSourceType, SocialSpaceCopy>> =
  Object.freeze({
    community: Object.freeze({
      ownerRoleLabel: 'Proprietário',
      showKindBadge: false,
      officialEntityTargetType: null,
      discovery: Object.freeze({
        hubTitle: 'Comunidades',
        emptyExploreMessage: 'Ainda não há Comunidades por aqui.',
        canCreateVenue: false,
        canCreateCommunity: true,
      }),
      membership: Object.freeze({
        openAction: 'Participar',
        restrictedAction: 'Solicitar',
        joinLabels: Object.freeze({
          open: 'Participação aberta',
          approval: 'Entrada por aprovação',
          invite_only: 'Somente convite',
        }),
        leaveOpenAction: 'Sair da Comunidade',
        leaveRestrictedAction: 'Sair da Comunidade',
        interactionRestrictedLabel: 'Interação reservada aos membros da Comunidade',
        activeSuccess: 'Você entrou na Comunidade.',
        pendingSuccess: 'Solicitação enviada.',
        leftSuccess: 'Você saiu da Comunidade.',
        leaveError: 'Não foi possível sair desta Comunidade agora.',
        requestError:
          'Não foi possível concluir a participação nesta Comunidade agora.',
      }),
      feed: Object.freeze({
        sectionLabel: 'Mural',
        ariaLabel: 'Mural da Comunidade',
        loadingLabel: 'Carregando mural...',
        errorLabel: 'Não foi possível carregar o mural da Comunidade.',
        emptyLabel: 'Nenhuma mensagem no Mural ainda.',
        photosAriaLabel: 'Fotos da Comunidade',
      }),
      management: Object.freeze({
        requestsTitle: 'Solicitações de entrada',
        hubTitle: 'Gestão da Comunidade',
        hubDescription:
          'Acompanhe pessoas, acesso e configurações sem transformar a Comunidade em um painel administrativo.',
        emptyRequestsMessage: 'Nenhuma solicitação de entrada pendente.',
        approvalSuccessSuffix: 'entrou na Comunidade.',
        loadRequestsError: 'Não foi possível carregar as solicitações de entrada.',
        reviewRequestError: 'Não foi possível revisar esta solicitação de entrada.',
      }),
      leave: Object.freeze({
        owner: Object.freeze({
          eyebrow: 'Propriedade da Comunidade',
          title: 'Encerrar seu vínculo com a Comunidade?',
          message:
            'A Comunidade já está encerrada. Ao sair, sua propriedade será liberada e seu vínculo ficará inativo.',
          detail:
            'Essa ação não reabre a Comunidade nem transfere a propriedade para outra pessoa.',
          confirmLabel: 'Liberar propriedade e sair',
          cancelLabel: 'Manter meu vínculo',
          icon: 'logout',
          tone: 'danger',
        }),
        admin: Object.freeze({
          eyebrow: 'Administração da Comunidade',
          title: 'Sair da Comunidade?',
          message:
            'Você deixará esta Comunidade e perderá imediatamente seu papel de Administração.',
          detail:
            'Para voltar, será necessário entrar ou solicitar aprovação novamente. A Administração não será restaurada automaticamente.',
          confirmLabel: 'Sair da Comunidade',
          cancelLabel: 'Continuar na Administração',
          icon: 'logout',
          tone: 'danger',
        }),
        moderator: Object.freeze({
          eyebrow: 'Moderação da Comunidade',
          title: 'Sair da Comunidade?',
          message:
            'Você deixará esta Comunidade e perderá imediatamente seu papel de Moderação.',
          detail:
            'Para voltar, será necessário entrar ou solicitar aprovação novamente. A Moderação não será restaurada automaticamente.',
          confirmLabel: 'Sair da Comunidade',
          cancelLabel: 'Continuar na Moderação',
          icon: 'logout',
          tone: 'danger',
        }),
        member: Object.freeze({
          eyebrow: 'Participação na Comunidade',
          title: 'Sair da Comunidade?',
          message: 'Você deixará de participar desta Comunidade.',
          confirmLabel: 'Sair da Comunidade',
          cancelLabel: 'Continuar participando',
          icon: 'logout',
          tone: 'warning',
        }),
      }),
    }),
    venue: Object.freeze({
      ownerRoleLabel: 'Responsável',
      showKindBadge: true,
      officialEntityTargetType: 'venue',
      discovery: Object.freeze({
        hubTitle: 'Locais',
        emptyExploreMessage: 'Nenhum Local disponível.',
        canCreateVenue: true,
        canCreateCommunity: false,
      }),
      membership: Object.freeze({
        openAction: 'Seguir',
        restrictedAction: 'Solicitar acesso',
        joinLabels: Object.freeze({
          open: 'Acompanhamento aberto',
          approval: 'Acesso por aprovação',
          invite_only: 'Acesso por convite',
        }),
        leaveOpenAction: 'Deixar de seguir',
        leaveRestrictedAction: 'Sair do Local',
        interactionRestrictedLabel:
          'Interação reservada às pessoas autorizadas no Local',
        activeSuccess: 'Você começou a seguir o Local.',
        pendingSuccess: 'Solicitação de acesso enviada.',
        leftSuccess: 'Você saiu do Local.',
        leaveError: 'Não foi possível sair deste Local agora.',
        requestError: 'Não foi possível solicitar acesso a este Local agora.',
      }),
      feed: Object.freeze({
        sectionLabel: 'Novidades',
        ariaLabel: 'Novidades do Local',
        loadingLabel: 'Carregando novidades...',
        errorLabel: 'Não foi possível carregar as novidades.',
        emptyLabel: 'Nenhuma novidade publicada.',
        photosAriaLabel: 'Fotos do Local',
      }),
      management: Object.freeze({
        requestsTitle: 'Solicitações de acesso',
        hubTitle: 'Gestão do Local',
        hubDescription:
          'Acompanhe solicitações sem sair da experiência do Local.',
        emptyRequestsMessage: 'Nenhuma solicitação de acesso pendente.',
        approvalSuccessSuffix: 'recebeu acesso ao Local.',
        loadRequestsError: 'Não foi possível carregar as solicitações de acesso.',
        reviewRequestError: 'Não foi possível revisar esta solicitação de acesso.',
      }),
      leave: Object.freeze({
        owner: Object.freeze({
          eyebrow: 'Responsabilidade do Local',
          title: 'Encerrar seu vínculo com o Local?',
          message:
            'Este espaço já está encerrado. Ao sair, sua responsabilidade será liberada e seu vínculo ficará inativo.',
          detail:
            'Essa ação não reabre o Local nem transfere sua responsabilidade para outra pessoa.',
          confirmLabel: 'Liberar responsabilidade e sair',
          cancelLabel: 'Manter meu vínculo',
          icon: 'logout',
          tone: 'danger',
        }),
        admin: Object.freeze({
          eyebrow: 'Administração do Local',
          title: 'Sair do Local?',
          message:
            'Você deixará este Local e perderá imediatamente seu acesso de Administração.',
          detail:
            'Para voltar, será necessário obter acesso novamente. A Administração não será restaurada automaticamente.',
          confirmLabel: 'Sair do Local',
          cancelLabel: 'Continuar na Administração',
          icon: 'logout',
          tone: 'danger',
        }),
        moderator: Object.freeze({
          eyebrow: 'Moderação do Local',
          title: 'Sair do Local?',
          message:
            'Você deixará este Local e perderá imediatamente seu acesso de Moderação.',
          detail:
            'Para voltar, será necessário obter acesso novamente. A Moderação não será restaurada automaticamente.',
          confirmLabel: 'Sair do Local',
          cancelLabel: 'Continuar na Moderação',
          icon: 'logout',
          tone: 'danger',
        }),
        member: Object.freeze({
          eyebrow: 'Participação no Local',
          title: 'Sair do Local?',
          message: 'Você deixará de participar deste Local.',
          confirmLabel: 'Sair do Local',
          cancelLabel: 'Continuar participando',
          icon: 'logout',
          tone: 'warning',
        }),
      }),
    }),
  });

function feedPresentation(
  copy: SocialSpaceCopy,
  view: CommunityFeedView
): CommunitySocialSpaceFeedPresentation {
  if (view === 'photos') {
    return {
      sectionLabel: 'Fotos',
      ariaLabel: copy.feed.photosAriaLabel,
      loadingLabel: 'Carregando fotos...',
      errorLabel: 'Não foi possível carregar as fotos.',
      emptyLabel: 'Nenhuma foto compartilhada ainda.',
    };
  }

  return copy.feed;
}

function leaveConfirmation(
  copy: SocialSpaceCopy,
  input: {
    readonly viewerMode: CommunityPreviewViewerMode;
    readonly viewerRole: CommunityPreviewViewerRole | null;
    readonly join: CommunityPreviewJoinPolicy;
  }
): ConfirmationDialogData {
  if (input.viewerRole === 'owner') return copy.leave.owner;
  if (input.viewerRole === 'admin') return copy.leave.admin;
  if (input.viewerRole === 'moderator' || input.viewerMode === 'moderator') {
    return copy.leave.moderator;
  }

  return {
    ...copy.leave.member,
    detail: input.join === 'approval'
      ? 'Para voltar, será necessário solicitar aprovação novamente.'
      : 'Você poderá entrar novamente enquanto este espaço continuar disponível.',
  };
}

function createAdapter(
  sourceType: CommunityPreviewSourceType
): CommunitySocialSpaceAdapter {
  const copy = COPY[sourceType];
  const definition = getSocialSpaceDefinition(sourceType);

  const communityDetailsRoute = (
    communityId: string,
    mode: CommunitySocialSpaceDiscoveryMode
  ): readonly string[] =>
    mode === 'mine'
      ? ['/dashboard/comunidades/minhas', communityId]
      : ['/dashboard/comunidades', communityId];

  const communityReturnTarget = (
    mode: CommunitySocialSpaceDiscoveryMode,
    selectedTagId: string | null
  ): string => {
    if (mode === 'mine') return '/dashboard/comunidades/minhas';
    return selectedTagId
      ? `/dashboard/comunidades?interesse=${selectedTagId}`
      : '/dashboard/comunidades';
  };

  const detailsRoute = sourceType === 'venue'
    ? (communityId: string): readonly string[] => [
        '/dashboard/locais',
        communityId,
      ]
    : communityDetailsRoute;
  const returnTarget = sourceType === 'venue'
    ? (): string => '/dashboard/locais'
    : communityReturnTarget;

  return Object.freeze({
    sourceType,
    definition,
    capabilities: definition.capabilities,
    ownerRoleLabel: copy.ownerRoleLabel,
    showKindBadge: copy.showKindBadge,
    officialEntityTargetType: copy.officialEntityTargetType,
    discovery: Object.freeze({
      ...copy.discovery,
      detailsRoute,
      returnTarget,
    }),
    membership: Object.freeze({
      actionLabel: (join: CommunityPreviewJoinPolicy) =>
        join === 'open'
          ? copy.membership.openAction
          : copy.membership.restrictedAction,
      joinLabel: (join: CommunityPreviewJoinPolicy) =>
        copy.membership.joinLabels[join],
      leaveActionLabel: (join: CommunityPreviewJoinPolicy) =>
        join === 'open'
          ? copy.membership.leaveOpenAction
          : copy.membership.leaveRestrictedAction,
      interactionRestrictedLabel: copy.membership.interactionRestrictedLabel,
      successMessage: (input: {
        readonly kind: CommunityMembershipActionKind;
        readonly resultStatus: CommunityMembershipResultStatus;
        readonly pending: boolean;
      }) => {
        if (input.kind === 'request') {
          return input.resultStatus === 'active'
            ? copy.membership.activeSuccess
            : copy.membership.pendingSuccess;
        }
        if (input.pending) return 'Solicitação cancelada.';
        return copy.membership.leftSuccess;
      },
      errorFallback: (kind: CommunityMembershipActionKind) =>
        kind === 'leave'
          ? copy.membership.leaveError
          : copy.membership.requestError,
      leaveConfirmation: (input) => leaveConfirmation(copy, input),
    }),
    feed: (view: CommunityFeedView) => feedPresentation(copy, view),
    management: Object.freeze({
      requestsTitle: copy.management.requestsTitle,
      hubTitle: copy.management.hubTitle,
      hubDescription: copy.management.hubDescription,
      emptyRequestsMessage: copy.management.emptyRequestsMessage,
      approvalSuccessMessage: (label: string) =>
        `${label} ${copy.management.approvalSuccessSuffix}`,
      loadRequestsError: copy.management.loadRequestsError,
      reviewRequestError: copy.management.reviewRequestError,
    }),
  });
}

export const COMMUNITY_SOCIAL_SPACE_ADAPTERS: Readonly<
  Record<CommunityPreviewSourceType, CommunitySocialSpaceAdapter>
> = Object.freeze({
  community: createAdapter('community'),
  venue: createAdapter('venue'),
});

export function normalizeCommunitySocialSpaceSourceType(
  value: unknown
): CommunityPreviewSourceType {
  return value === 'venue' ? 'venue' : 'community';
}

export function getCommunitySocialSpaceAdapter(
  sourceType: CommunityPreviewSourceType
): CommunitySocialSpaceAdapter {
  return COMMUNITY_SOCIAL_SPACE_ADAPTERS[sourceType];
}
