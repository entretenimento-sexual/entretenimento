// Composição pública do sidebar autenticado.
//
// Responsabilidade:
// - preservar os contratos e filtros puros de sidebar-config.ts;
// - apresentar Pessoas, Locais e Comunidades dentro de Descobrir;
// - apresentar Mensagens e Salas dentro de Conversas;
// - mover a gestão da assinatura para o grupo Conta;
// - manter Área VIP e Recursos premium como destinos condicionais;
// - remover seções que fiquem vazias após a composição.
import { isFeatureEnabled } from '@core/guards/access-guard/feature-flag.guard';
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

const ACCOUNT_GROUP_ID = 'account';
const SUBSCRIPTION_ITEM_ID = 'subscription-plan';
const SAFETY_ITEM_ID = 'safety-center';
const COMMUNITY_PREVIEW_ENABLED = isFeatureEnabled('communityPreview');

export function buildSidebarSections(
  flags: SidebarAccessFlags
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

  const domainSections = composeDomainNavigation(sectionsWithoutSubscription);

  if (!subscriptionItem) {
    return domainSections;
  }

  return domainSections.map((section): SidebarSection => {
    if (section.key !== 'settings') {
      return section;
    }

    return {
      ...section,
      items: section.items.map((item): SidebarItem =>
        appendSubscriptionToAccount(item, subscriptionItem as SidebarLinkItem)
      ),
    };
  });
}

export function resolveSidebarSectionFromUrl(
  url: string
): SidebarSectionKey {
  const clean = normalizeUrl(url);

  if (
    clean === '/subscription-plan'
    || clean.startsWith('/subscription-plan/')
  ) {
    return 'settings';
  }

  if (
    clean === '/dashboard/locais'
    || clean.startsWith('/dashboard/locais/')
    || clean === '/dashboard/comunidades'
    || clean.startsWith('/dashboard/comunidades/')
  ) {
    return 'explore';
  }

  return resolveBaseSidebarSectionFromUrl(url);
}

function composeDomainNavigation(
  sections: readonly SidebarSection[]
): SidebarSection[] {
  return sections
    .filter((section) => section.key !== 'communities')
    .map((section): SidebarSection => {
      if (section.key === 'explore') {
        const peopleItem: SidebarLinkItem = {
          id: 'discover-people',
          label: 'Pessoas',
          route: '/dashboard/explorar',
          icon: '✨',
          exact: false,
          ariaLabel: 'Descobrir pessoas e perfis',
        };

        const socialItems: SidebarLinkItem[] = COMMUNITY_PREVIEW_ENABLED
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
          items: [peopleItem, ...socialItems],
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
            {
              id: 'chat-rooms',
              label: SOCIAL_SPACE_DEFINITIONS.room.pluralLabel,
              route: SOCIAL_SPACE_DEFINITIONS.room.navigationRoute,
              icon: '🗨️',
              exact: false,
              ariaLabel: SOCIAL_SPACE_DEFINITIONS.room.description,
            },
          ],
        };
      }

      return section;
    });
}

function appendSubscriptionToAccount(
  item: SidebarItem,
  subscriptionItem: SidebarLinkItem
): SidebarItem {
  if (
    !isSidebarGroupItem(item)
    || item.id !== ACCOUNT_GROUP_ID
    || item.children.some((child) => child.id === SUBSCRIPTION_ITEM_ID)
  ) {
    return item;
  }

  const children = [...item.children];
  const safetyIndex = children.findIndex(
    (child) => child.id === SAFETY_ITEM_ID
  );
  const insertionIndex = safetyIndex >= 0 ? safetyIndex : children.length;

  children.splice(insertionIndex, 0, subscriptionItem);

  return {
    ...item,
    children,
  } satisfies SidebarGroupItem;
}

function normalizeUrl(url: string | null | undefined): string {
  return String(url ?? '').trim().split('?')[0].split('#')[0];
}
