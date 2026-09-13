// Composição pública do sidebar autenticado.
//
// Responsabilidade:
// - preservar os contratos e filtros puros de sidebar-config.ts;
// - apresentar Feed, Pessoas, Locais e Comunidades dentro de Descobrir;
// - apresentar Minhas conexões e Solicitações dentro de Conexões;
// - apresentar somente Mensagens dentro de Conversas;
// - mover a gestão da assinatura para o grupo Conta;
// - apresentar documentos legais, avisos e manifestações dentro da conta;
// - manter Área VIP como destino condicional enquanto possuir rota real;
// - resolver seção e item ativos a partir de uma única autoridade de rota;
// - remover seções que fiquem vazias após a composição.
import {
  SOCIAL_SPACE_DEFINITIONS,
} from '@core/domain/social-space.definition';
import {
  buildSidebarSections as buildBaseSidebarSections,
  isSidebarGroupItem,
  resolveSidebarSectionFromUrl as resolveBaseSidebarSectionFromUrl,
  type SidebarAccessFlags,
  type SidebarGroupItem,
  type SidebarItem,
  type SidebarLinkItem,
  type SidebarSection,
  type SidebarSectionKey,
} from './sidebar-config';

export type {
  SidebarAccessFlags,
  SidebarGroupItem,
  SidebarGroupItemConfig,
  SidebarItem,
  SidebarItemConfig,
  SidebarLinkItem,
  SidebarLinkItemConfig,
  SidebarSection,
  SidebarSectionConfig,
  SidebarSectionKey,
} from './sidebar-config';

export { isSidebarGroupItem } from './sidebar-config';

export interface SidebarRuntimeOptions {
  readonly communityPreviewEnabled?: boolean;
}

const ACCOUNT_GROUP_ID = 'account';
const SUBSCRIPTION_ITEM_ID = 'subscription-plan';
const LEGAL_DOCUMENTS_ITEM_ID = 'legal-documents';
const COMPLIANCE_CASES_ITEM_ID = 'compliance-cases';
const SAFETY_ITEM_ID = 'safety-center';

const LEGAL_DOCUMENTS_ITEM: SidebarLinkItem = {
  id: LEGAL_DOCUMENTS_ITEM_ID,
  label: 'Documentos legais',
  route: '/conta/documentos-legais',
  icon: '📄',
  exact: false,
  ariaLabel: 'Consultar Termos de Uso, Privacidade e Cookies',
};

const COMPLIANCE_CASES_ITEM: SidebarLinkItem = {
  id: COMPLIANCE_CASES_ITEM_ID,
  label: 'Avisos e manifestações',
  route: '/conta/conformidade',
  icon: '⚖️',
  exact: false,
  ariaLabel: 'Consultar avisos de conformidade e manifestações da conta',
};

export function buildSidebarSections(
  flags: SidebarAccessFlags,
  options: SidebarRuntimeOptions = {}
): SidebarSection[] {
  const baseSections = buildBaseSidebarSections(flags);
  let subscriptionItem: SidebarLinkItem | null = null;

  const sectionsWithoutSubscription = baseSections
    .map((section): SidebarSection => {
      if (section.key !== 'subscriptions') {
        return section;
      }

      const items = section.items.filter((item) => {
        if (
          !isSidebarGroupItem(item)
          && item.id === SUBSCRIPTION_ITEM_ID
        ) {
          subscriptionItem = item;
          return false;
        }

        return true;
      });

      return {
        ...section,
        title: 'Premium',
        items,
      };
    })
    .filter((section) => section.items.length > 0);

  const domainSections = composeDomainNavigation(
    sectionsWithoutSubscription,
    options.communityPreviewEnabled !== false
  );

  return domainSections.map((section): SidebarSection => {
    if (section.key !== 'settings') {
      return section;
    }

    return {
      ...section,
      items: section.items.map((item): SidebarItem =>
        appendAccountDestinations(
          item,
          subscriptionItem as SidebarLinkItem | null
        )
      ),
    };
  });
}

export function resolveSidebarSectionFromUrl(
  url: string
): SidebarSectionKey {
  const clean = normalizeUrl(url);

  // `/perfil/:uid` é o destino canônico de visualização de perfil alheio,
  // inclusive quando aberto a partir da descoberta. Ele pertence ao contexto
  // de descoberta, não ao grupo da conta. Rotas mais profundas de edição do
  // próprio perfil continuam sendo classificadas pelo resolver-base como Conta.
  if (isCanonicalPublicProfileRoute(clean)) {
    return 'explore';
  }

  if (
    matchesRoute(clean, '/subscription-plan')
    || matchesRoute(clean, '/conta/documentos-legais')
    || matchesRoute(clean, '/conta/conformidade')
  ) {
    return 'settings';
  }

  if (
    matchesRoute(clean, '/dashboard/locais')
    || matchesRoute(clean, '/dashboard/comunidades')
  ) {
    return 'explore';
  }

  if (
    matchesRoute(clean, '/friends')
    || matchesRoute(clean, '/dashboard/friends')
  ) {
    return 'profiles';
  }

  return resolveBaseSidebarSectionFromUrl(clean);
}

/**
 * Resolve o item visualmente ativo a partir da rota canônica/contextual.
 *
 * Esse é o contrato usado pelo sidebar desktop para impedir estados ativos
 * concorrentes causados por prefixos sobrepostos (por exemplo `/conta` e
 * `/conta/documentos-legais`) e para manter contexto em páginas de detalhe.
 */
export function resolveSidebarItemIdFromUrl(url: string): string | null {
  const clean = normalizeUrl(url);

  if (isCanonicalPublicProfileRoute(clean)) return 'discover-people';

  if (
    matchesRoute(clean, '/outro-perfil')
    || matchesRoute(clean, '/profile-list')
    || matchesRoute(clean, '/perfis-proximos')
    || matchesRoute(clean, '/dashboard/perfis-sugeridos')
    || matchesRoute(clean, '/dashboard/suggested-profiles')
    || matchesRoute(clean, '/dashboard/online')
    || matchesRoute(clean, '/dashboard/online-users')
  ) {
    return 'discover-people';
  }

  if (matchesRoute(clean, '/descobrir')) return 'social-feed';
  if (matchesRoute(clean, '/dashboard/explorar')) return 'discover-people';
  if (matchesRoute(clean, '/dashboard/locais')) return 'discover-venues';
  if (matchesRoute(clean, '/dashboard/comunidades')) {
    return 'discover-communities';
  }

  if (
    matchesRoute(clean, '/friends/requests')
    || matchesRoute(clean, '/dashboard/friends/requests')
  ) {
    return 'friend-requests';
  }

  if (
    matchesRoute(clean, '/friends')
    || matchesRoute(clean, '/dashboard/friends')
  ) {
    return 'friends-list';
  }

  if (matchesRoute(clean, '/chat')) return 'chat-list';

  const mediaItemId = resolveMediaItemId(clean);
  if (mediaItemId) return mediaItemId;

  if (matchesRoute(clean, '/conta/documentos-legais')) {
    return LEGAL_DOCUMENTS_ITEM_ID;
  }

  if (matchesRoute(clean, '/conta/conformidade')) {
    return COMPLIANCE_CASES_ITEM_ID;
  }

  if (matchesRoute(clean, '/subscription-plan')) return SUBSCRIPTION_ITEM_ID;
  if (matchesRoute(clean, '/dashboard/seguranca')) return SAFETY_ITEM_ID;
  if (matchesRoute(clean, '/preferencias')) return 'preferences';

  if (clean === '/perfil' || matchesRoute(clean, '/perfil')) {
    return 'my-profile';
  }

  if (matchesRoute(clean, '/conta')) return 'my-account';
  if (matchesRoute(clean, '/dashboard/featured-profiles')) return 'vip-area';
  if (matchesRoute(clean, '/admin-dashboard')) return 'admin-dashboard';

  if (
    matchesRoute(clean, '/dashboard/principal')
    || clean === '/principal'
  ) {
    return 'dashboard-home';
  }

  return null;
}

function composeDomainNavigation(
  sections: readonly SidebarSection[],
  communityPreviewEnabled: boolean
): SidebarSection[] {
  const composed = sections
    .filter((section) => section.key !== 'communities')
    .map((section): SidebarSection => {
      if (section.key === 'explore') {
        const feedItem: SidebarLinkItem = {
          id: 'social-feed',
          label: 'Feed',
          route: '/descobrir',
          icon: '📰',
          exact: true,
          ariaLabel: 'Abrir o feed de publicações recomendadas',
        };
        const peopleItem: SidebarLinkItem = {
          id: 'discover-people',
          label: 'Pessoas',
          route: '/dashboard/explorar',
          icon: '✨',
          exact: false,
          ariaLabel: 'Descobrir pessoas e perfis',
        };

        const socialItems: SidebarLinkItem[] = communityPreviewEnabled
          ? [
              {
                id: 'discover-venues',
                label: SOCIAL_SPACE_DEFINITIONS.venue.pluralLabel,
                route: SOCIAL_SPACE_DEFINITIONS.venue.navigationRoute,
                icon: '📍',
                exact: false,
                ariaLabel: SOCIAL_SPACE_DEFINITIONS.venue.description,
              },
              {
                id: 'discover-communities',
                label: SOCIAL_SPACE_DEFINITIONS.community.pluralLabel,
                route: SOCIAL_SPACE_DEFINITIONS.community.navigationRoute,
                icon: '👥',
                exact: false,
                ariaLabel: SOCIAL_SPACE_DEFINITIONS.community.description,
              },
            ]
          : [];

        return {
          ...section,
          title: 'Descobrir',
          items: [feedItem, peopleItem, ...socialItems],
        };
      }

      if (section.key === 'chat') {
        return {
          ...section,
          title: 'Conversas',
          items: [
            {
              id: 'chat-list',
              label: 'Mensagens',
              route: '/chat',
              icon: '💬',
              exact: true,
              ariaLabel: 'Abrir mensagens diretas',
            },
          ],
        };
      }

      return section;
    });

  const chatIndex = composed.findIndex((section) => section.key === 'chat');
  if (chatIndex < 0) {
    return composed;
  }

  const connectionsSection: SidebarSection = {
    key: 'profiles',
    title: 'Conexões',
    items: [
      {
        id: 'friends-list',
        label: 'Minhas conexões',
        route: '/friends/list',
        icon: '🔗',
        exact: false,
        ariaLabel: 'Abrir minha lista de conexões',
      },
      {
        id: 'friend-requests',
        label: 'Solicitações',
        route: '/friends/requests',
        icon: '🤝',
        exact: false,
        ariaLabel: 'Abrir solicitações de conexão recebidas e enviadas',
      },
    ],
  };

  return [
    ...composed.slice(0, chatIndex),
    connectionsSection,
    ...composed.slice(chatIndex),
  ];
}

function appendAccountDestinations(
  item: SidebarItem,
  subscriptionItem: SidebarLinkItem | null
): SidebarItem {
  if (!isSidebarGroupItem(item) || item.id !== ACCOUNT_GROUP_ID) {
    return item;
  }

  const children = [...item.children];
  const safetyIndex = children.findIndex(
    (child) => child.id === SAFETY_ITEM_ID
  );
  let insertionIndex = safetyIndex >= 0 ? safetyIndex : children.length;

  if (!children.some((child) => child.id === LEGAL_DOCUMENTS_ITEM_ID)) {
    children.splice(insertionIndex, 0, LEGAL_DOCUMENTS_ITEM);
    insertionIndex += 1;
  }

  if (!children.some((child) => child.id === COMPLIANCE_CASES_ITEM_ID)) {
    children.splice(insertionIndex, 0, COMPLIANCE_CASES_ITEM);
    insertionIndex += 1;
  }

  if (
    subscriptionItem &&
    !children.some((child) => child.id === SUBSCRIPTION_ITEM_ID)
  ) {
    children.splice(insertionIndex, 0, subscriptionItem);
  }

  return {
    ...item,
    children,
  } satisfies SidebarGroupItem;
}

function resolveMediaItemId(url: string): string | null {
  if (
    matchesRoute(url, '/media/videos')
    || matchesRoute(url, '/media/video')
    || matchesRoute(url, '/media/denunciar/video')
    || /^\/media\/perfil\/[^/]+\/videos(?:-publicos)?(?:\/|$)/.test(url)
  ) {
    return 'media-videos';
  }

  if (
    matchesRoute(url, '/media/photos')
    || matchesRoute(url, '/media/ultimas-fotos')
    || matchesRoute(url, '/media/fotos-top')
    || matchesRoute(url, '/media/fotos-turbinadas')
    || matchesRoute(url, '/media/denunciar/photo')
    || /^\/media\/perfil\/[^/]+\/fotos(?:-publicas)?(?:\/|$)/.test(url)
  ) {
    return 'media-photos';
  }

  return null;
}

function normalizeUrl(url: string | null | undefined): string {
  const clean = String(url ?? '').trim().split('?')[0].split('#')[0];

  if (!clean || clean === '/') {
    return clean || '/';
  }

  return clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

function matchesRoute(path: string, route: string): boolean {
  const cleanRoute = normalizeUrl(route);
  return path === cleanRoute || path.startsWith(`${cleanRoute}/`);
}

function isCanonicalPublicProfileRoute(url: string): boolean {
  return /^\/perfil\/[^/]+$/.test(url);
}
