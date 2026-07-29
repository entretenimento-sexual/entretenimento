import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { MobileBottomNavComponent } from './mobile-bottom-nav.component';

describe('MobileBottomNavComponent', () => {
  it('usa Feed como segundo destino principal no mobile', async () => {
    await TestBed.configureTestingModule({
      imports: [MobileBottomNavComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(MobileBottomNavComponent);
    const component = fixture.componentInstance;

    expect(component.items.map((item) => item.label)).toEqual([
      'Hoje',
      'Feed',
      'Chat',
      'Perfil',
    ]);
    expect(component.items[1]).toMatchObject({
      id: 'feed',
      route: ['/descobrir'],
      ariaLabel: 'Abrir feed e áreas de descoberta',
    });
  });

  it('mantém o Feed ativo nas rotas de descoberta', async () => {
    await TestBed.configureTestingModule({
      imports: [MobileBottomNavComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(MobileBottomNavComponent);
    const component = fixture.componentInstance;
    const feed = component.items[1];

    component.currentUrl = '/descobrir';
    expect(component.isActive(feed)).toBe(true);

    component.currentUrl = '/dashboard/explorar';
    expect(component.isActive(feed)).toBe(true);
  });

  it('sinaliza no Chat somente solicitações recebidas', async () => {
    await TestBed.configureTestingModule({
      imports: [MobileBottomNavComponent, RouterTestingModule],
    }).compileComponents();

    const fixture = TestBed.createComponent(MobileBottomNavComponent);
    const component = fixture.componentInstance;
    const chat = component.items.find((item) => item.id === 'chat');

    expect(chat).toBeTruthy();

    component.friendRequestsCount = 3;

    expect(component.itemBadgeCount(chat!)).toBe(3);
    expect(component.itemAriaLabel(chat!)).toContain(
      '3 solicitações de conexão recebidas'
    );

    component.friendRequestsCount = 0;

    expect(component.itemBadgeCount(chat!)).toBe(0);
    expect(component.itemAriaLabel(chat!)).toBe(chat!.ariaLabel);
  });
});
