// src/app/dashboard/online/online-users-full/online-users-full.component.spec.ts
// -----------------------------------------------------------------------------
// OnlineUsersFullComponent Spec
// -----------------------------------------------------------------------------
//
// Teste leve do wrapper de perfis online.
//
// Ajustes:
// - usa Vitest explicitamente;
// - mocka OnlineUsersComponent para não acionar Store/geolocalização;
// - testa criação, embedded e normalização do mode;
// - remove provideStore desnecessário neste teste.

import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { OnlineUsersFullComponent } from './online-users-full.component';
import { OnlineUsersComponent } from '../online-users/online-users.component';

import type { DiscoveryMode } from '../../discovery/models/discovery-mode.model';

@Component({
  selector: 'app-online-users',
  standalone: true,
  template: '<div data-testid="mock-online-users"></div>',
})
class MockOnlineUsersComponent {
  @Input() mode: DiscoveryMode | null | undefined = null;
}

describe('OnlineUsersFullComponent', () => {
  let component: OnlineUsersFullComponent;
  let fixture: ComponentFixture<OnlineUsersFullComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnlineUsersFullComponent],
      providers: [provideRouter([])],
    })
      .overrideComponent(OnlineUsersFullComponent, {
        remove: {
          imports: [OnlineUsersComponent],
        },
        add: {
          imports: [MockOnlineUsersComponent],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(OnlineUsersFullComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('deve iniciar com embedded false', () => {
    expect(component.embedded).toBe(false);
  });

  it('deve iniciar no modo padrão', () => {
    expect(component.mode).toBe('all');
  });

  it('deve aceitar modo online', () => {
    component.mode = 'online';
    fixture.detectChanges();

    expect(component.mode).toBe('online');
  });

  it('deve normalizar modo inválido para o padrão', () => {
    component.mode = 'modo-invalido' as any;
    fixture.detectChanges();

    expect(component.mode).toBe('all');
  });
});