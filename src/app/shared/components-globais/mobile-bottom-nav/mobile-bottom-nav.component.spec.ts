import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { MobileBottomNavComponent } from './mobile-bottom-nav.component';

describe('MobileBottomNavComponent', () => {
  it('usa cinco destinos principais e mantém conexões separadas do chat', async () => {
    await TestBed.configureTestingModule({
      imports: [MobileBottomNavComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(MobileBottomNavComponent);
    const component = fixture.componentInstance;

    expect(component.items.map((item) => item.label)).toEqual([
      'Hoje',
      'Feed',
      'Conexões',
      'Chat',
      'Perfil',
    ]);
    expect(component.items[1]).toMatchObject({
      id: 'feed',
      route: ['/descobrir'],
      ariaLabel: 'Abrir feed e áreas de descoberta',
    });
    expect(component.items[2]).toMatchObject({
      id: 'connections',
      route: ['/friends', 'list'],
      ariaLabel: 'Abrir minhas conexões e solicitações',
    });
  });

  it('mantém o Feed ativo nas rotas de descoberta', async () => {
    await TestBed.configureTestingModule({
      imports: [MobileBottomNavComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(MobileBottomNavComponent);
    const component = fixture.componentInstance;
    const feed = component.items.find((item) => item.id === 'feed');

    expect(feed).toBeTruthy();

    component.currentUrl = '/descobrir';
    expect(component.isActive(feed!)).toBe(true);

    component.currentUrl = '/dashboard/explorar';
    expect(component.isActive(feed!)).toBe(true);
  });

  it('mantém Conexões ativa em rotas canônicas e aliases antigos sem acender Chat', async () => {
    await TestBed.configureTestingModule({
      imports: [MobileBottomNavComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(MobileBottomNavComponent);
    const component = fixture.componentInstance;
    const connections = component.items.find((item) => item.id === 'connections');
    const chat = component.items.find((item) => item.id === 'chat');

    expect(connections).toBeTruthy();
    expect(chat).toBeTruthy();

    component.currentUrl = '/friends/requests';
    expect(component.isActive(connections!)).toBe(true);
    expect(component.isActive(chat!)).toBe(false);

    component.currentUrl = '/dashboard/friends/list';
    expect(component.isActive(connections!)).toBe(true);
    expect(component.isActive(chat!)).toBe(false);

    component.currentUrl = '/chat';
    expect(component.isActive(connections!)).toBe(false);
    expect(component.isActive(chat!)).toBe(true);
  });

  it('mantém Perfil ativo na central de segurança sem acender Feed', async () => {
    await TestBed.configureTestingModule({
      imports: [MobileBottomNavComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(MobileBottomNavComponent);
    const component = fixture.componentInstance;
    const profile = component.items.find((item) => item.id === 'profile');
    const feed = component.items.find((item) => item.id === 'feed');

    expect(profile).toBeTruthy();
    expect(feed).toBeTruthy();

    component.currentUrl = '/dashboard/seguranca';
    expect(component.isActive(profile!)).toBe(true);
    expect(component.isActive(feed!)).toBe(false);
  });

  it('sinaliza solicitações recebidas somente em Conexões', async () => {
    await TestBed.configureTestingModule({
      imports: [MobileBottomNavComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(MobileBottomNavComponent);
    const component = fixture.componentInstance;
    const connections = component.items.find((item) => item.id === 'connections');
    const chat = component.items.find((item) => item.id === 'chat');

    expect(connections).toBeTruthy();
    expect(chat).toBeTruthy();

    component.friendRequestsCount = 3;

    expect(component.itemBadgeCount(connections!)).toBe(3);
    expect(component.itemAriaLabel(connections!)).toContain(
      '3 solicitações de conexão recebidas'
    );
    expect(component.itemBadgeCount(chat!)).toBe(0);
    expect(component.itemAriaLabel(chat!)).toBe(chat!.ariaLabel);

    component.friendRequestsCount = 0;

    expect(component.itemBadgeCount(connections!)).toBe(0);
    expect(component.itemAriaLabel(connections!)).toBe(connections!.ariaLabel);
  });
});