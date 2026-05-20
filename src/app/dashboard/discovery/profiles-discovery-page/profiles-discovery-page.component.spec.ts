// src/app/dashboard/discovery/profiles-discovery-page/profiles-discovery-page.component.spec.ts
// -----------------------------------------------------------------------------
// ProfilesDiscoveryPageComponent Spec
// -----------------------------------------------------------------------------
//
// Teste da página pai de descoberta.
//
// Ajustes desta versão:
// - alinha o spec com a API atual do componente:
//   activeMode(), onDiscoveryModeChange(), tab.id e tab.disabled;
// - remove expectativa antiga sobre mode(), setMode(), tab.mode e tab.enabled;
// - mocka blocos pesados para manter o teste focado na página pai;
// - usa Vitest.

import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProfilesDiscoveryPageComponent } from './profiles-discovery-page.component';

import { OnlineUsersFullComponent } from '../../online/online-users-full/online-users-full.component';
import { PublicProfilesListComponent } from '../public-profiles-list/public-profiles-list.component';

@Component({
  selector: 'app-online-users-full',
  standalone: true,
  template: '<div data-testid="mock-online-users-full"></div>',
})
class MockOnlineUsersFullComponent {}

@Component({
  selector: 'app-public-profiles-list',
  standalone: true,
  template: '<div data-testid="mock-public-profiles-list"></div>',
})
class MockPublicProfilesListComponent {
  @Input() profiles: unknown;
  @Input() loading: unknown;
  @Input() errorMessage: unknown;
}

describe('ProfilesDiscoveryPageComponent', () => {
  let component: ProfilesDiscoveryPageComponent;
  let fixture: ComponentFixture<ProfilesDiscoveryPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfilesDiscoveryPageComponent],
      providers: [provideRouter([])],
    })
      .overrideComponent(ProfilesDiscoveryPageComponent, {
        remove: {
          imports: [
            OnlineUsersFullComponent,
            PublicProfilesListComponent,
          ],
        },
        add: {
          imports: [
            MockOnlineUsersFullComponent,
            MockPublicProfilesListComponent,
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProfilesDiscoveryPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar a página de descoberta', () => {
    expect(component).toBeTruthy();
  });

  it('deve iniciar no modo padrão todos', () => {
    expect(component.activeMode()).toBe('all');
  });

  it('deve alternar para online', () => {
    component.onDiscoveryModeChange('online');
    fixture.detectChanges();

    expect(component.activeMode()).toBe('online');
  });

  it('deve normalizar modo inválido para todos', () => {
    component.onDiscoveryModeChange('modo-invalido' as any);
    fixture.detectChanges();

    expect(component.activeMode()).toBe('all');
  });

  it('deve conter aba todos habilitada', () => {
    const allTab = component.tabs.find((tab) => tab.id === 'all');

    expect(allTab).toBeTruthy();
    expect(allTab?.disabled).not.toBe(true);
  });

  it('deve conter aba perto desabilitada por enquanto', () => {
    const nearbyTab = component.tabs.find((tab) => tab.id === 'nearby');

    expect(nearbyTab).toBeTruthy();
    expect(nearbyTab?.disabled).toBe(true);
  });
});