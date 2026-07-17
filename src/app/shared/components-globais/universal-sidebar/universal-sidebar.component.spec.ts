import { describe, expect, it, vi } from 'vitest';

import type { SidebarGroupItem } from '@core/services/navigation/sidebar-config';
import type { SidebarVm } from '@core/services/navigation/sidebar.service';

import { UniversalSidebarComponent } from './universal-sidebar.component';

const accountGroup: SidebarGroupItem = {
  kind: 'group',
  id: 'account',
  label: 'Conta',
  children: [
    {
      id: 'my-profile',
      label: 'Meu perfil',
      route: '/perfil',
    },
    {
      id: 'preferences',
      label: 'Preferências',
      route: '/preferencias',
    },
  ],
};

function buildVm(
  currentUrl: string,
  isCollapsed = false,
  expandedGroupIds: readonly string[] = []
): SidebarVm {
  return {
    isMobile: false,
    isOpen: true,
    isCollapsed,
    currentUrl,
    currentSection: 'settings',
    expandedGroupIds,
    sections: [
      {
        key: 'settings',
        title: '',
        items: [accountGroup],
      },
    ],
  };
}

describe('UniversalSidebarComponent account group', () => {
  it('abre automaticamente o grupo da rota ativa no sidebar expandido', () => {
    const component = new UniversalSidebarComponent();
    component.vm = buildVm('/preferencias/editar/u1');

    expect(component.isGroupActive(accountGroup)).toBe(true);
    expect(component.isGroupExpanded(accountGroup)).toBe(true);
  });

  it('mantém o rail recolhido dependente de expansão explícita', () => {
    const component = new UniversalSidebarComponent();
    component.vm = buildVm('/preferencias', true);

    expect(component.isGroupActive(accountGroup)).toBe(true);
    expect(component.isGroupExpanded(accountGroup)).toBe(false);

    component.vm = buildVm('/preferencias', true, ['account']);
    expect(component.isGroupExpanded(accountGroup)).toBe(true);
  });

  it('emite os pedidos de alternância e fechamento sem acessar o serviço', () => {
    const component = new UniversalSidebarComponent();
    component.vm = buildVm('/dashboard/principal');
    const toggleSpy = vi.fn();
    const closeSpy = vi.fn();

    component.groupToggleRequested.subscribe(toggleSpy);
    component.groupCloseRequested.subscribe(closeSpy);

    component.onGroupToggle(accountGroup);
    component.onChildActivated(accountGroup.id);

    expect(toggleSpy).toHaveBeenCalledWith('account');
    expect(closeSpy).toHaveBeenCalledWith('account');
  });

  it('gera identificador estável para aria-controls', () => {
    const component = new UniversalSidebarComponent();

    expect(component.groupPanelId('account settings')).toBe(
      'sidebar-group-account-settings'
    );
  });
});
