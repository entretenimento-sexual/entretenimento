// src/app/core/services/navigation/sidebar-config.ts
// Configuração central do sidebar autenticado.
//
// Objetivo:
// - centralizar seções e itens;
// - evitar navegação hardcoded em múltiplos componentes;
// - permitir filtragem por capacidades (assinante / vip / admin);
// - manter tipagem forte para SidebarSectionKey;
// - alinhar a navegação desktop com a bottom nav mobile.
//
// Observação:
// - este arquivo é puro;
// - não injeta services;
// - não consulta Router;
// - não consulta Firestore.
//
// Definições de navegação:
// - Pessoas: perfis encontrados na descoberta;
// - Locais: lugares físicos ou estabelecimentos reais;
// - Comunidades: grupos permanentes de pessoas com membros, regras e mural;
// - Salas: espaços de conversa em tempo real dentro de Conversas.
//
// Sala não é Comunidade. Local não é Comunidade. A infraestrutura interna pode
// ser compartilhada, mas os destinos e rótulos apresentados são distintos.
export type SidebarSectionKey =
  | 'dashboard'
  | 'explore'
  | 'communities' // legado de tipagem; a composição pública usa `explore`.
  | 'profiles'
  | 'chat'
  | 'media'
  | 'admin'
  | 'subscriptions'
  | 'settings'
  | 'unknown';

export interface SidebarLinkItem {
  id: string;
  label: string;
  route: string;
  icon?: string;
  exact?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  badgeCount?: number | null;
  badgeLabel?: string | null;
}

export interface SidebarGroupItem {
  kind: 'group';
  id: string;
  label: string;
  icon?: string;
  ariaLabel?: string;
  disabled?: boolean;
  children: SidebarLinkItem[];
}

export type SidebarItem = SidebarLinkItem | SidebarGroupItem;

interface SidebarAccessRequirements {
  requiresSubscriber?: boolean;
  requiresVip?: boolean;
  requiresAdmin?: boolean;
}

export interface SidebarLinkItemConfig
  extends SidebarLinkItem,
    SidebarAccessRequirements {}

export interface SidebarGroupItemConfig
  extends SidebarGroupItem,
    SidebarAccessRequirements {
  children: SidebarLinkItemConfig[];
}

export type SidebarItemConfig =
  | SidebarLinkItemConfig
  | SidebarGroupItemConfig;

export interface SidebarSection {
  key: SidebarSectionKey;
  title: string;
  items: SidebarItem[];
}

export interface SidebarSectionConfig {
  key: SidebarSectionKey;
  title: string;
  items: SidebarItemConfig[];
}

export interface SidebarAccessFlags {
  isSubscriber: boolean;
  isVip: boolean;
  isAdmin?: boolean;
}

const SECTION_MATCHERS: ReadonlyArray<{
  key: SidebarSectionKey;
  prefixes: readonly string[];
}> = [
  {
    key: 'admin',
    prefixes: ['/admin-dashboard'],
  },
  {
    key: 'subscriptions',
    prefixes: [
      '/subscription-plan',
      '/checkout',
      '/billing/return',
      '/dashboard/featured-profiles',
      '/dashboard/latest-photos',
    ],
  },
  {
    key: 'explore',
    prefixes: [
      '/dashboard/explorar',
      '/dashboard/locais',
      '/dashboard/comunidades',
      '/descobrir',
      '/dashboard/online',
      '/dashboard/online-users',
      '/perfis-proximos',
      '/outro-perfil',
      '/profile-list',
    ],
  },
  {
    key: 'chat',
    prefixes: ['/chat', '/friends'],
  },
  {
    key: 'media',
    prefixes: ['/media'],
  },
  {
    key: 'settings',
    prefixes: ['/perfil', '/perfil-debug', '/preferencias', '/conta', '/dashboard/seguranca'],
  },
  {
    key: 'dashboard',
    prefixes: ['/dashboard'],
  },
] as const;

const AUTH_SIDEBAR_CONFIG: ReadonlyArray<SidebarSectionConfig> = [
  {
    key: 'dashboard',
    title: 'Hoje',
    items: [
      {
        id: 'dashboard-home',
        label: 'Hoje',
        route: '/dashboard/principal',
        icon: '🏠',
        exact: false,
        ariaLabel: 'Ir para Hoje',
      },
    ],
  },
  {
    key: 'explore',
    title: 'Descobrir',
    items: [
      {
        id: 'discover-people',
        label: 'Pessoas',
        route: '/dashboard/explorar',
        icon: '✨',
        exact: false,
        ariaLabel: 'Descobrir pessoas e perfis',
      },
      {
        id: 'discover-venues',
        label: 'Locais',
        route: '/dashboard/locais',
        icon: '📍',
        exact: false,
        ariaLabel: 'Descobrir lugares físicos e estabelecimentos reais',
      },
      {
        id: 'discover-communities',
        label: 'Comunidades',
        route: '/dashboard/comunidades',
        icon: '👥',
        exact: false,
        ariaLabel: 'Descobrir grupos permanentes de pessoas',
      },
    ],
  },
  {
    key: 'chat',
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
        label: 'Salas',
        route: '/chat/rooms',
        icon: '🗨️',
        exact: false,
        ariaLabel: 'Abrir espaços de conversa em tempo real',
      },
    ],
  },
  {
    key: 'media',
    title: 'Mídia',
    items: [
      {
        id: 'media-photos',
        label: 'Fotos',
        route: '/media/photos',
        icon: '🖼️',
        exact: false,
        ariaLabel: 'Ir para fotos',
      },
      {
        id: 'media-videos',
        label: 'Vídeos',
        route: '/media/videos',
        icon: '🎬',
        exact: false,
        ariaLabel: 'Abrir minha biblioteca de vídeos',
      },
    ],
  },
  {
    key: 'subscriptions',
    title: 'Plano',
    items: [
      {
        id: 'subscription-plan',
        label: 'Assinatura',
        route: '/subscription-plan',
        icon: '💎',
        exact: false,
        ariaLabel: 'Ir para assinatura',
      },
      {
        id: 'vip-area',
        label: 'Área VIP',
        route: '/dashboard/featured-profiles',
        icon: '⭐',
        exact: false,
        ariaLabel: 'Ir para área VIP',
        requiresVip: true,
      },
      {
        id: 'premium-area',
        label: 'Recursos premium',
        route: '/dashboard/latest-photos',
        icon: '🔥',
        exact: false,
        ariaLabel: 'Ir para recursos premium',
        requiresSubscriber: true,
      },
    ],
  },
  {
    key: 'settings',
    title: '',
    items: [
      {
        kind: 'group',
        id: 'account',
        label: 'Conta',
        icon: '👤',
        ariaLabel: 'Abrir opções da conta',
        children: [
          {
            id: 'my-profile',
            label: 'Meu perfil',
            route: '/perfil',
            icon: '🙍',
            exact: false,
            ariaLabel: 'Ir para meu perfil',
          },
          {
            id: 'preferences',
            label: 'Preferências',
            route: '/preferencias',
            icon: '⚙️',
            exact: false,
            ariaLabel: 'Ir para preferências',
          },
          {
            id: 'my-account',
            label: 'Dados da conta',
            route: '/conta',
            icon: '🧾',
            exact: false,
            ariaLabel: 'Ir para dados da conta',
          },
          {
            id: 'safety-center',
            label: 'Segurança',
            route: '/dashboard/seguranca',
            icon: '🛡️',
            exact: false,
            ariaLabel: 'Abrir central de segurança e confiança',
          },
        ],
      },
    ],
  },
  {
    key: 'admin',
    title: 'Administração',
    items: [
      {
        id: 'admin-dashboard',
        label: 'Painel admin',
        route: '/admin-dashboard',
        icon: '🛠️',
        exact: false,
        ariaLabel: 'Ir para painel administrativo',
        requiresAdmin: true,
      },
    ],
  },
] as const;

export function isSidebarGroupItem(
  item: SidebarItem
): item is SidebarGroupItem {
  return 'kind' in item && item.kind === 'group';
}

export function resolveSidebarSectionFromUrl(url: string): SidebarSectionKey {
  const clean = (url ?? '').trim();

  for (const matcher of SECTION_MATCHERS) {
    if (matcher.prefixes.some((prefix) => clean.startsWith(prefix))) {
      return matcher.key;
    }
  }

  return 'unknown';
}

export function buildSidebarSections(flags: SidebarAccessFlags): SidebarSection[] {
  return AUTH_SIDEBAR_CONFIG
    .map((section): SidebarSection => ({
      key: section.key,
      title: section.title,
      items: section.items
        .map((item) => buildVisibleItem(item, flags))
        .filter((item): item is SidebarItem => item !== null),
    }))
    .filter((section) => section.items.length > 0);
}

function buildVisibleItem(
  item: SidebarItemConfig,
  flags: SidebarAccessFlags
): SidebarItem | null {
  if (!hasSidebarAccess(item, flags)) {
    return null;
  }

  if ('kind' in item && item.kind === 'group') {
    const children = item.children.filter((child) =>
      hasSidebarAccess(child, flags)
    );

    return children.length > 0
      ? {
          ...item,
          children,
        }
      : null;
  }

  return item;
}

function hasSidebarAccess(
  item: SidebarAccessRequirements,
  flags: SidebarAccessFlags
): boolean {
  const {
    isSubscriber,
    isVip,
    isAdmin = false,
  } = flags;

  if (item.requiresAdmin && !isAdmin) return false;
  if (item.requiresVip && !isVip) return false;
  if (item.requiresSubscriber && !isSubscriber) return false;
  return true;
}
