// src/app/community/presentation/community-social-space.adapter.ts
// -----------------------------------------------------------------------------
// COMMUNITY SOCIAL-SPACE ADAPTER
// -----------------------------------------------------------------------------
// Community e Venue reutilizam infraestrutura social, mas são produtos distintos.
// Este adapter concentra somente diferenças de apresentação/navegação usadas por
// componentes compartilhados. Regras de domínio permanecem em suas policies.
// -----------------------------------------------------------------------------

import type {
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import {
  getSocialSpaceDefinition,
  normalizeActiveSocialSpaceKind,
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

type CommunitySocialSpaceDiscoveryMode = 'explore' | 'mine';
type CommunityMembershipActionKind = 'request' | 'leave';
type CommunityMembershipResultStatus = 'active' | 'pending' | 'left';

interface CommunitySocialSpaceFeedPresentation {
  readonly sectionLabel: string;
  readonly ariaLabel: string;
  readonly loadingLabel: string;
  readonly errorLabel: string;
  readonly emptyLabel: string;
  readonly composerPlaceholder: string;
}

interface CommunitySocialSpaceAdapter {
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
    readonly interactionRestrictedLabel: string;
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

interface ProductCopy {
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
  readonly feed: Omit<CommunitySocialSpaceFeedPresentation, 'sectionLabel'> & {
    readonly sectionLabel: string;
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
}

const COPY: Readonly<Record<CommunityPreviewSourceType, ProductCopy>> =
  Object.freeze({
    community: Object.freeze({
      ownerRoleLabel: 'Proprietário',
      showKindBadge: false,
      officialEntityTargetType: null,
      discovery: {
        hubTitle: 'Comunidades',
        emptyExploreMessage: 'Ainda não há Comunidades por aqui.',
        canCreateVenue: false,
        canCreateCommunity: true,
      },
      membership: {
        openAction: 'Participar',
        restrictedAction: 'Solicitar',
        joinLabels: {
          open: 'Participação aberta',
          approval: 'Entrada por aprovação',
          invite_only: 'Somente convite',
        },
        leaveOpenAction: 'Sair da Comunidade',
        leaveRestrictedAction: 'Sair da Comunidade',
        interactionRestrictedLabel:
          'Interação reservada aos membros da Comunidade',
        activeSuccess: 'Você entrou na Comunidade.',
        pendingSuccess: 'Solicitação enviada.',
        leftSuccess: 'Você saiu da Comunidade.',
        leaveError: 'Não foi possível sair desta Comunidade agora.',
        requestError:
          'Não foi possível concluir a participação nesta Comunidade agora.',
      },
      feed: {
        sectionLabel: 'Mural',
        ariaLabel: 'Mural da Comunidade',
        loadingLabel: 'Carregando mural...',
        errorLabel: 'Não foi possível carregar o mural da Comunidade.',
        emptyLabel: 'Nenhuma mensagem no Mural ainda.',
        composerPlaceholder: 'Compartilhe algo com a Comunidade...',
        photosAriaLabel: 'Fotos da Comunidade',
      },
      management: {
        requestsTitle: 'Solicitações de entrada',
        hubTitle: 'Gestão da Comunidade',
        hubDescription:
          'Acompanhe pessoas, acesso e configurações sem transformar a Comunidade em um painel administrativo.',
        emptyRequestsMessage: 'Nenhuma solicitação de entrada pendente.',
        approvalSuccessSuffix: 'entrou na Comunidade.',
        loadRequestsError:
          'Não foi possível carregar as solicitações de entrada.',
        reviewRequestError:
          'Não foi possível revisar esta solicitação de entrada.',
      },
    }),
    venue: Object.freeze({
      ownerRoleLabel: 'Responsável',
      showKindBadge: true,
      officialEntityTargetType: 'venue',
      discovery: {
        hubTitle: 'Locais',
        emptyExploreMessage: 'Nenhum Local disponível.',
        canCreateVenue: true,
        canCreateCommunity: false,
      },
      membership: {
        openAction: 'Seguir',
        restrictedAction: 'Solicitar acesso',
        joinLabels: {
          open: 'Acompanhamento aberto',
          approval: 'Acesso por aprovação',
          invite_only: 'Acesso por convite',
        },
        leaveOpenAction: 'Deixar de seguir',
        leaveRestrictedAction: 'Sair do Local',
        interactionRestrictedLabel:
          'Interação reservada às pessoas autorizadas no Local',
        activeSuccess: 'Você começou a seguir o Local.',
        pendingSuccess: 'Solicitação de acesso enviada.',
        leftSuccess: 'Você saiu do Local.',
        leaveError: 'Não foi possível sair deste Local agora.',
        requestError: 'Não foi possível solicitar acesso a este Local agora.',
      },
      feed: {
        sectionLabel: 'Novidades',
        ariaLabel: 'Novidades do Local',
        loadingLabel: 'Carregando novidades...',
        errorLabel: 'Não foi possível carregar as novidades.',
        emptyLabel: 'Nenhuma novidade publicada.',
        composerPlaceholder: 'Compartilhe uma novidade...',
        photosAriaLabel: 'Fotos do Local',
      },
      management: {
        requestsTitle: 'Solicitações de acesso',
        hubTitle: 'Gestão do Local',
        hubDescription:
          'Acompanhe solicitações sem sair da experiência do Local.',
        emptyRequestsMessage: 'Nenhuma solicitação de acesso pendente.',
        approvalSuccessSuffix: 'recebeu acesso ao Local.',
        loadRequestsError:
          'Não foi possível carregar as solicitações de acesso.',
        reviewRequestError:
          'Não foi possível revisar esta solicitação de acesso.',
      },
    }),
  });

function buildLeaveConfirmation(
  sourceType: CommunityPreviewSourceType,
  input: {
    readonly viewerMode: CommunityPreviewViewerMode;
    readonly viewerRole: CommunityPreviewViewerRole | null;
    readonly join: CommunityPreviewJoinPolicy;
  }
): ConfirmationDialogData {
  const isVenue = sourceType === 'venue';

  if (input.viewerRole === 'owner') {
    return {
      eyebrow: isVenue ? 'Responsabilidade do Local' : 'Propriedade da Comunidade',
      title: isVenue
        ? 'Encerrar seu vínculo com o Local?'
        : 'Encerrar seu vínculo com a Comunidade?',
      message: isVenue
        ? 'Este espaço já está encerrado. Ao sair, sua responsabilidade será liberada e seu vínculo ficará inativo.'
        : 'A Comunidade já está encerrada. Ao sair, sua propriedade será liberada e seu vínculo ficará inativo.',
      detail: isVenue
        ? 'Essa ação não reabre o Local nem transfere sua responsabilidade para outra pessoa.'
        : 'Essa ação não reabre a Comunidade nem transfere a propriedade para outra pessoa.',
      confirmLabel: isVenue
        ? 'Liberar responsabilidade e sair'
        : 'Liberar propriedade e sair',
      cancelLabel: 'Manter meu vínculo',
      icon: 'logout',
      tone: 'danger',
    };
  }

  if (input.viewerRole === 'admin') {
    return {
      eyebrow: isVenue ? 'Administração do Local' : 'Administração da Comunidade',
      title: isVenue ? 'Sair do Local?' : 'Sair da Comunidade?',
      message: isVenue
        ? 'Você deixará este Local e perderá imediatamente seu acesso de Administração.'
        : 'Você deixará esta Comunidade e perderá imediatamente seu papel de Administração.',
      detail: isVenue
        ? 'Para voltar, será necessário obter acesso novamente. A Administração não será restaurada automaticamente.'
        : 'Para voltar, será necessário entrar ou solicitar aprovação novamente. A Administração não será restaurada automaticamente.',
      confirmLabel: isVenue ? 'Sair do Local' : 'Sair da Comunidade',
      cancelLabel: 'Continuar na Administração',
      icon: 'logout',
      tone: 'danger',
    };
  }

  if (input.viewerRole === 'moderator' || input.viewerMode === 'moderator') {
    return {
      eyebrow: isVenue ? 'Moderação do Local' : 'Moderação da Comunidade',
      title: isVenue ? 'Sair do Local?' : 'Sair da Comunidade?',
      message: isVenue
        ? 'Você deixará este Local e perderá imediatamente seu acesso de Moderação.'
        : 'Você deixará esta Comunidade e perderá imediatamente seu papel de Moderação.',
      detail: isVenue
        ? 'Para voltar, será necessário obter acesso novamente. A Moderação não será restaurada automaticamente.'
        : 'Para voltar, será necessário entrar ou solicitar aprovação novamente. A Moderação não será restaurada automaticamente.',
      confirmLabel: isVenue ? 'Sair do Local' : 'Sair da Comunidade',
      cancelLabel: 'Continuar na Moderação',
      icon: 'logout',
      tone: 'danger',
    };
  }

  return {
    eyebrow: isVenue ? 'Participação no Local' : 'Participação na Comunidade',
    title: isVenue ? 'Sair do Local?' : 'Sair da Comunidade?',
    message: isVenue
      ? 'Você deixará de participar deste Local.'
      : 'Você deixará de participar desta Comunidade.',
    detail: input.join === 'approval'
      ? 'Para voltar, será necessário solicitar aprovação novamente.'
      : 'Você poderá entrar novamente enquanto este espaço continuar disponível.',
    confirmLabel: isVenue ? 'Sair do Local' : 'Sair da Comunidade',
    cancelLabel: 'Continuar participando',
    icon: 'logout',
    tone: 'warning',
  };
}

function createAdapter(
  sourceType: CommunityPreviewSourceType
): CommunitySocialSpaceAdapter {
  const copy = COPY[sourceType];
  const definition = getSocialSpaceDefinition(sourceType);
  const isVenue = sourceType === 'venue';

  return Object.freeze({
    definition,
    capabilities: definition.capabilities,
    ownerRoleLabel: copy.ownerRoleLabel,
    showKindBadge: copy.showKindBadge,
    officialEntityTargetType: copy.officialEntityTargetType,
    discovery: Object.freeze({
      ...copy.discovery,
      detailsRoute: (
        communityId: string,
        mode: CommunitySocialSpaceDiscoveryMode
      ): readonly string[] =>
        isVenue
          ? ['/dashboard/locais', communityId]
          : mode === 'mine'
            ? ['/dashboard/comunidades/minhas', communityId]
            : ['/dashboard/comunidades', communityId],
      returnTarget: (
        mode: CommunitySocialSpaceDiscoveryMode,
        selectedTagId: string | null
      ): string => {
        if (isVenue) return '/dashboard/locais';
        if (mode === 'mine') return '/dashboard/comunidades/minhas';
        return selectedTagId
          ? `/dashboard/comunidades?interesse=${selectedTagId}`
          : '/dashboard/comunidades';
      },
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
      }): string => {
        if (input.kind === 'request') {
          return input.resultStatus === 'active'
            ? copy.membership.activeSuccess
            : copy.membership.pendingSuccess;
        }
        return input.pending
          ? 'Solicitação cancelada.'
          : copy.membership.leftSuccess;
      },
      errorFallback: (kind: CommunityMembershipActionKind) =>
        kind === 'leave'
          ? copy.membership.leaveError
          : copy.membership.requestError,
      leaveConfirmation: (input: {
        readonly viewerMode: CommunityPreviewViewerMode;
        readonly viewerRole: CommunityPreviewViewerRole | null;
        readonly join: CommunityPreviewJoinPolicy;
      }) => buildLeaveConfirmation(sourceType, input),
    }),
    feed: (view: CommunityFeedView): CommunitySocialSpaceFeedPresentation =>
      view === 'photos'
        ? {
            sectionLabel: 'Fotos',
            ariaLabel: copy.feed.photosAriaLabel,
            loadingLabel: 'Carregando fotos...',
            errorLabel: 'Não foi possível carregar as fotos.',
            emptyLabel: 'Nenhuma foto compartilhada ainda.',
            composerPlaceholder: copy.feed.composerPlaceholder,
          }
        : copy.feed,
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

const COMMUNITY_SOCIAL_SPACE_ADAPTERS: Readonly<
  Record<CommunityPreviewSourceType, CommunitySocialSpaceAdapter>
> = Object.freeze({
  community: createAdapter('community'),
  venue: createAdapter('venue'),
});

export function normalizeCommunitySocialSpaceSourceType(
  value: unknown
): CommunityPreviewSourceType {
  return normalizeActiveSocialSpaceKind(value);
}

export function getCommunitySocialSpaceAdapter(
  sourceType: CommunityPreviewSourceType
): CommunitySocialSpaceAdapter {
  return COMMUNITY_SOCIAL_SPACE_ADAPTERS[sourceType];
}
