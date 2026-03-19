// src/app/core/services/navigation/sidebar-config.ts
// Configuração central do sidebar autenticado.
//
// Objetivo:
// - centralizar seções e itens
// - evitar navegação hardcoded em múltiplos componentes
// - permitir filtragem por capacidades (assinante / vip / admin)
// - manter tipagem forte para SidebarSectionKey
//
// Observação:
// - este arquivo é puro
// - não injeta services
// - não consulta Router
// - não consulta Firestore
//
// Ajustes desta revisão:
// - adiciona gating explícito para admin
// - melhora a ordem e precisão dos matchers
// - filtra seções vazias após aplicar permissões
// - adiciona ícones simples compatíveis com o componente atual
export type SidebarSectionKey =
  | 'dashboard'
  | 'profiles'
  | 'chat'
  | 'media'
  | 'admin'
  | 'subscriptions'
  | 'settings'
  | 'unknown';

export interface SidebarItem {
  id: string;
  label: string;
  route: string;
  icon?: string;
  exact?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SidebarItemConfig extends SidebarItem {
  requiresSubscriber?: boolean;
  requiresVip?: boolean;
  requiresAdmin?: boolean;
}

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

/**
 * Ordem importa.
 *
 * Matchers mais específicos devem vir antes dos mais amplos.
 * Exemplo:
 * - /dashboard/featured-profiles pertence semanticamente à área de assinatura,
 *   então subscriptions precisa ser avaliado antes de dashboard.
 */
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
      '/dashboard/featured-profiles',
      '/dashboard/latest-photos',
    ],
  },
  {
    key: 'chat',
    prefixes: ['/chat'],
  },
  {
    key: 'media',
    prefixes: ['/media'],
  },
  {
    key: 'profiles',
    prefixes: [
      '/profile-list',
      '/friends',
      '/perfis-proximos',
      '/outro-perfil',
    ],
  },
  {
    key: 'settings',
    prefixes: ['/perfil', '/perfil-debug'],
  },
  {
    key: 'dashboard',
    prefixes: ['/dashboard'],
  },
] as const;

const AUTH_SIDEBAR_CONFIG: ReadonlyArray<SidebarSectionConfig> = [
  {
    key: 'dashboard',
    title: 'Início',
    items: [
      {
        id: 'dashboard-home',
        label: 'Principal',
        route: '/dashboard/principal',
        icon: '🏠',
        exact: false,
        ariaLabel: 'Ir para a página principal',
      },
      {
        id: 'dashboard-online',
        label: 'Online',
        route: '/dashboard/online',
        icon: '🟢',
        exact: false,
        ariaLabel: 'Ir para usuários online',
      },
    ],
  },
  {
    key: 'profiles',
    title: 'Perfis',
    items: [
      {
        id: 'profiles-list',
        label: 'Explorar perfis',
        route: '/profile-list',
        icon: '🔎',
        exact: false,
        ariaLabel: 'Explorar perfis',
      },
      {
        id: 'friends',
        label: 'Amizades',
        route: '/friends',
        icon: '👥',
        exact: false,
        ariaLabel: 'Ir para gerenciamento de amizades',
      },
    ],
  },
  {
    key: 'chat',
    title: 'Conversas',
    items: [
      {
        id: 'chat-list',
        label: 'Chats',
        route: '/chat',
        icon: '💬',
        exact: false,
        ariaLabel: 'Ir para conversas privadas',
      },
      {
        id: 'chat-rooms',
        label: 'Salas',
        route: '/chat/rooms',
        icon: '🧩',
        exact: false,
        ariaLabel: 'Ir para salas',
      },
      {
        id: 'chat-invites',
        label: 'Convites',
        route: '/chat/invite-list',
        icon: '📨',
        exact: false,
        ariaLabel: 'Ir para convites',
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
        icon: '🎥',
        exact: false,
        ariaLabel: 'Ir para vídeos',
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
    title: 'Conta',
    items: [
      {
        id: 'my-profile',
        label: 'Meu perfil',
        route: '/perfil',
        icon: '🙍',
        exact: false,
        ariaLabel: 'Ir para meu perfil',
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
  const {
    isSubscriber,
    isVip,
    isAdmin = false,
  } = flags;

  return AUTH_SIDEBAR_CONFIG
    .map((section): SidebarSection => ({
      key: section.key,
      title: section.title,
      items: section.items.filter((item) => {
        if (item.requiresAdmin && !isAdmin) return false;
        if (item.requiresVip && !isVip) return false;
        if (item.requiresSubscriber && !isSubscriber) return false;
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}
