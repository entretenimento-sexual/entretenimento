// src/app/dashboard/discovery/profiles-discovery-page/profiles-discovery-page.component.spec.ts
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProfilesDiscoveryPageComponent } from './profiles-discovery-page.component';
import { OnlineUsersComponent } from '../../online/online-users/online-users.component';

/**
 * Mock isolado do OnlineUsersComponent.
 *
 * Motivo:
 * o componente real injeta Store, geolocalização, AccessControlService
 * e outros providers. Aqui testamos apenas a página pai de discovery.
 */
@Component({
  selector: 'app-online-users',
  standalone: true,
  template: '<div data-testid="mock-online-users"></div>',
})
class MockOnlineUsersComponent {}

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
          imports: [OnlineUsersComponent],
        },
        add: {
          imports: [MockOnlineUsersComponent],
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

  it('deve iniciar no modo online', () => {
    expect(component.mode()).toBe('online');
  });

  it('deve alternar para o modo todos quando a aba estiver habilitada', () => {
    const allTab = component.tabs.find((tab) => tab.mode === 'all');

    expect(allTab).toBeTruthy();
    expect(allTab!.enabled).toBe(true);

    component.setMode(allTab!.mode);
    fixture.detectChanges();

    expect(component.mode()).toBe('all');
  });

  it('não deve alternar para modo desabilitado', () => {
    const nearbyTab = component.tabs.find((tab) => tab.mode === 'nearby');

    expect(nearbyTab).toBeTruthy();
    expect(nearbyTab!.enabled).toBe(false);

    component.setMode(nearbyTab!.mode);
    fixture.detectChanges();

    expect(component.mode()).toBe('online');
  });
});