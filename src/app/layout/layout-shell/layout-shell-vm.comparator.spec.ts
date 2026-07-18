import { describe, expect, it } from 'vitest';

import {
  areLayoutShellVmsEqual,
  type LayoutShellVm,
} from './layout-shell-vm.comparator';

function createVm(): LayoutShellVm {
  return {
    currentUrl: '/perfil',
    shellMode: 'auth',
    showSidebar: true,
    showFooter: true,
    friendRequestsCount: 2,
    isChatLayout: false,
    sidebar: {
      isMobile: false,
      isOpen: true,
      isCollapsed: false,
      currentUrl: '/perfil',
      currentSection: 'settings',
      expandedGroupIds: ['account'],
      sections: [
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
              ],
            },
          ],
        },
      ],
    },
    sidebarUser: {
      uid: 'u1',
      displayName: 'Pessoa',
      email: 'pessoa@example.com',
      subtitle: 'Conta premium',
      photoURL: null,
      profileRoute: ['/perfil', 'u1'],
    },
    sidebarShouldOverlay: false,
    sidebarShouldCompact: false,
    navbarContextActions: [
      {
        id: 'friend-requests',
        label: 'Solicitações (2)',
        route: ['/friends/requests'],
        queryParams: {
          redirectTo: '/perfil',
        },
        variant: 'primary',
        badgeCount: 2,
      },
    ],
    sidebarQuickActions: [
      {
        id: 'subscription-plan',
        label: 'Ver planos',
        route: ['/subscription-plan'],
        variant: 'ghost',
      },
    ],
  };
}

describe('areLayoutShellVmsEqual', () => {
  it('considera equivalentes VMs recriadas com o mesmo conteúdo', () => {
    expect(areLayoutShellVmsEqual(createVm(), createVm())).toBe(true);
  });

  it('detecta alteração nos grupos expandidos', () => {
    const previous = createVm();
    const current = createVm();
    current.sidebar.expandedGroupIds = [];

    expect(areLayoutShellVmsEqual(previous, current)).toBe(false);
  });

  it('detecta alteração em parâmetros de ação contextual', () => {
    const previous = createVm();
    const current = createVm();
    current.navbarContextActions[0] = {
      ...current.navbarContextActions[0],
      queryParams: {
        redirectTo: '/dashboard/principal',
      },
    };

    expect(areLayoutShellVmsEqual(previous, current)).toBe(false);
  });

  it('detecta alteração em badges da navegação', () => {
    const previous = createVm();
    const current = createVm();
    current.sidebar.sections[0].items[0] = {
      ...current.sidebar.sections[0].items[0],
      children: [
        {
          id: 'my-profile',
          label: 'Meu perfil',
          route: '/perfil',
          badgeCount: 1,
        },
      ],
    };

    expect(areLayoutShellVmsEqual(previous, current)).toBe(false);
  });
});
