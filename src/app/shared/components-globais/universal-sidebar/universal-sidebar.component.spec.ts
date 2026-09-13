import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { describe, expect, it, vi } from 'vitest';

import type {
  SidebarGroupItem,
  SidebarLinkItem,
} from '@core/services/navigation/sidebar-config';
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
    {
      id: 'my-account',
      label: 'Dados da conta',
      route: '/conta',
    },
    {
      id: 'legal-documents',
      label: 'Documentos legais',
      route: '/conta/documentos-legais',
    },
  ],
};

function buildVm(
  currentUrl: string,
  currentItemId: string | null,
  isCollapsed = false,
  expandedGroupIds: readonly string[] = []
): SidebarVm {
  return {
    isMobile: false,
    isOpen: true,
    isCollapsed,
    currentUrl,
    currentSection: 'settings',
    currentItemId,
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

function buildBadgeVm(item: SidebarLinkItem): SidebarVm {
  return {
    isMobile: false,
    isOpen: true,
    isCollapsed: false,
    currentUrl: '/friends/requests',
    currentSection: 'profiles',
    currentItemId: 'friend-requests',
    expandedGroupIds: [],
    sections: [
      {
        key: 'profiles',
        title: 'Conexões',
        items: [item],
      },
    ],
  };
}

describe('UniversalSidebarComponent account group', () => {
  it('mantém a rota filha ativa sem forçar a abertura do grupo', () => {
    const component = new UniversalSidebarComponent();
    component.vm = buildVm('/preferencias/editar/u1', 'preferences');

    expect(component.isGroupActive(accountGroup)).toBe(true);
    expect(component.isGroupExpanded(accountGroup)).toBe(false);
  });

  it('abre o grupo somente por expansão explícita', () => {
    const component = new UniversalSidebarComponent();
    component.vm = buildVm('/perfil', 'my-profile', false, ['account']);

    expect(component.isGroupActive(accountGroup)).toBe(true);
    expect(component.isGroupExpanded(accountGroup)).toBe(true);
  });

  it('mantém o rail recolhido dependente de expansão explícita', () => {
    const component = new UniversalSidebarComponent();
    component.vm = buildVm('/preferencias', 'preferences', true);

    expect(component.isGroupActive(accountGroup)).toBe(true);
    expect(component.isGroupExpanded(accountGroup)).toBe(false);

    component.vm = buildVm('/preferencias', 'preferences', true, ['account']);
    expect(component.isGroupExpanded(accountGroup)).toBe(true);
  });

  it('mantém somente o destino específico ativo quando rotas se sobrepõem', () => {
    const component = new UniversalSidebarComponent();
    component.vm = buildVm(
      '/conta/documentos-legais',
      'legal-documents',
      false,
      ['account']
    );

    const myAccount = accountGroup.children.find(
      (child) => child.id === 'my-account'
    );
    const legalDocuments = accountGroup.children.find(
      (child) => child.id === 'legal-documents'
    );

    expect(myAccount).toBeTruthy();
    expect(legalDocuments).toBeTruthy();
    expect(component.isLinkActive(myAccount!)).toBe(false);
    expect(component.isLinkActive(legalDocuments!)).toBe(true);
    expect(component.isGroupActive(accountGroup)).toBe(true);
  });

  it('não acende a Conta ao visualizar perfil alheio na descoberta', () => {
    const component = new UniversalSidebarComponent();
    component.vm = {
      ...buildVm('/perfil/usuario-2', 'discover-people'),
      currentSection: 'explore',
    };

    expect(component.isGroupActive(accountGroup)).toBe(false);
    expect(component.isLinkActive(accountGroup.children[0])).toBe(false);
  });

  it('emite os pedidos de alternância e fechamento sem acessar o serviço', () => {
    const component = new UniversalSidebarComponent();
    component.vm = buildVm('/dashboard/principal', 'dashboard-home');
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

  it('renderiza badge em link comum da navegação', async () => {
    await TestBed.configureTestingModule({
      imports: [UniversalSidebarComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(UniversalSidebarComponent);
    fixture.componentInstance.vm = buildBadgeVm({
      id: 'friend-requests',
      label: 'Solicitações de conexão',
      route: '/friends/requests',
      badgeCount: 2,
      badgeLabel: '2 solicitações de conexão recebidas',
    });
    fixture.detectChanges();

    const badge = fixture.debugElement.query(
      By.css('.universal-sidebar__link .universal-sidebar__badge')
    );

    expect(badge).toBeTruthy();
    expect(badge.nativeElement.textContent.trim()).toBe('2');
  });
});
