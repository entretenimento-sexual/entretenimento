// Composição pública do sidebar autenticado.
//
// Responsabilidade:
// - preservar os contratos e filtros puros de sidebar-config.ts;
// - mover a gestão da assinatura para o grupo Conta;
// - manter Área VIP e Recursos premium como destinos condicionais;
// - remover seções que fiquem vazias após a composição.
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
          !isSidebarGroupItem(item) &&
          item.id === SUBSCRIPTION_ITEM_ID
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

  if (!subscriptionItem) {
    return sectionsWithoutSubscription;
  }

  return sectionsWithoutSubscription.map((section): SidebarSection => {
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
    clean === '/subscription-plan' ||
    clean.startsWith('/subscription-plan/')
  ) {
    return 'settings';
  }

  return resolveBaseSidebarSectionFromUrl(url);
}

function appendSubscriptionToAccount(
  item: SidebarItem,
  subscriptionItem: SidebarLinkItem
): SidebarItem {
  if (
    !isSidebarGroupItem(item) ||
    item.id !== ACCOUNT_GROUP_ID ||
    item.children.some((child) => child.id === SUBSCRIPTION_ITEM_ID)
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
