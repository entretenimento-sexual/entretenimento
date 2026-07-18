// src/app/dashboard/discovery/profiles-discovery-page/profiles-discovery-page.component.spec.ts
import {
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilesDiscoveryPageComponent } from './profiles-discovery-page.component';
import { DiscoveryPublicProfilesFacade } from '../application/discovery-public-profiles.facade';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import { OnlineUsersFullComponent } from '../../online/online-users-full/online-users-full.component';
import { PublicProfilesListComponent } from '../public-profiles-list/public-profiles-list.component';
import { UserIntentStatusComposerComponent } from '../../user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { UserIntentStatusRadarComponent } from '../../user-intent-status/user-intent-status-radar/user-intent-status-radar.component';

@Component({
  selector: 'app-online-users-full',
  standalone: true,
  template: '<div data-testid="mock-online-users-full"></div>',
})
class MockOnlineUsersFullComponent {
  @Input() embedded: unknown;
  @Input() mode: unknown;
}

@Component({
  selector: 'app-public-profiles-list',
  standalone: true,
  template: '<div data-testid="mock-public-profiles-list"></div>',
})
class MockPublicProfilesListComponent {
  @Input() profiles: unknown;
  @Input() loading: unknown;
  @Input() loadingMore: unknown;
  @Input() refreshing: unknown;
  @Input() hasMore: unknown;
  @Input() errorMessage: unknown;

  @Output() loadMore = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();
}

@Component({
  selector: 'app-user-intent-status-composer',
  standalone: true,
  template: '<div data-testid="mock-user-intent-composer"></div>',
})
class MockUserIntentStatusComposerComponent {
  @Input() user: unknown;
}

@Component({
  selector: 'app-user-intent-status-radar',
  standalone: true,
  template: '<div data-testid="mock-user-intent-radar"></div>',
})
class MockUserIntentStatusRadarComponent {
  @Input() user: unknown;
}

describe('ProfilesDiscoveryPageComponent', () => {
  let component: ProfilesDiscoveryPageComponent;
  let fixture: ComponentFixture<ProfilesDiscoveryPageComponent>;

  const facadeMock = {
    profiles$: of([]),
    loading$: of(false),
    loadingMore$: of(false),
    refreshing$: of(false),
    hasMore$: of(false),
    errorMessage$: of(null),
    loadMore: vi.fn(),
    retry: vi.fn(),
  };

  const currentUserStoreMock = {
    user$: of({
      uid: 'u1',
      nickname: 'Pessoa',
      estado: 'RJ',
      municipio: 'rio de janeiro',
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ProfilesDiscoveryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoveryPublicProfilesFacade,
          useValue: facadeMock,
        },
        {
          provide: CurrentUserStoreService,
          useValue: currentUserStoreMock,
        },
      ],
    })
      .overrideComponent(ProfilesDiscoveryPageComponent, {
        remove: {
          imports: [
            OnlineUsersFullComponent,
            PublicProfilesListComponent,
            UserIntentStatusComposerComponent,
            UserIntentStatusRadarComponent,
          ],
        },
        add: {
          imports: [
            MockOnlineUsersFullComponent,
            MockPublicProfilesListComponent,
            MockUserIntentStatusComposerComponent,
            MockUserIntentStatusRadarComponent,
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

  it('deve alternar para hoje e renderizar composer e radar', () => {
    component.onDiscoveryModeChange('today');
    fixture.detectChanges();

    expect(component.activeMode()).toBe('today');
    expect(
      fixture.nativeElement.querySelector('[data-testid="mock-user-intent-composer"]')
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="mock-user-intent-radar"]')
    ).toBeTruthy();
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

  it('deve conter aba hoje habilitada', () => {
    const todayTab = component.tabs.find((tab) => tab.id === 'today');

    expect(todayTab).toBeTruthy();
    expect(todayTab?.disabled).not.toBe(true);
  });

  it('deve manter aba perto fora da navegação enquanto estiver desabilitada', () => {
    const nearbyTab = component.tabs.find((tab) => tab.id === 'nearby');

    expect(nearbyTab).toBeUndefined();
  });
});
