// src/app/dashboard/discovery/profiles-discovery-page/profiles-discovery-page.component.ts
// -----------------------------------------------------------------------------
// ProfilesDiscoveryPageComponent
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - manter o modo técnico "all" como entrada padrão do ranking;
// - apresentar essa seleção ao usuário como "Para você";
// - controlar o modo ativo da barra de descoberta;
// - renderizar apenas modos realmente disponíveis;
// - bloquear defensivamente ativação de modos desabilitados/planned;
// - manter a barra visual desacoplada da regra de busca;
// - oferecer gesto explícito para consentimento de localização quando necessário;
// - respeitar a dispensa do aviso por usuário/dispositivo sem insistência.
//
// Observação:
// - modos futuros ficam no model, mas não entram na navegação principal enquanto
//   não tiverem entrega real.

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { GeoPermissionState } from 'src/app/core/interfaces/geolocation.interface';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';

import { DiscoveryPublicProfilesFacade } from '../application/discovery-public-profiles.facade';
import { OnlineUsersFullComponent } from '../../online/online-users-full/online-users-full.component';
import { PublicProfilesListComponent } from '../public-profiles-list/public-profiles-list.component';
import { DiscoveryModeTabsComponent } from '../discovery-mode-tabs/discovery-mode-tabs.component';
import { UserIntentStatusComposerComponent } from '../../user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { UserIntentStatusRadarComponent } from '../../user-intent-status/user-intent-status-radar/user-intent-status-radar.component';

import {
  DEFAULT_DISCOVERY_MODE,
  DISCOVERY_MODE_TABS,
  DiscoveryMode,
  DiscoveryModeTab,
  isDiscoveryModeEnabled,
  normalizeDiscoveryExperienceMode,
} from '../models/discovery-mode.model';

type DiscoveryLocationPermissionState = GeoPermissionState | 'checking';

@Component({
  selector: 'app-profiles-discovery-page',
  standalone: true,
  imports: [
    CommonModule,
    DiscoveryModeTabsComponent,
    OnlineUsersFullComponent,
    PublicProfilesListComponent,
    UserIntentStatusComposerComponent,
    UserIntentStatusRadarComponent,
  ],
  templateUrl: './profiles-discovery-page.component.html',
  styleUrl: './profiles-discovery-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilesDiscoveryPageComponent implements OnInit {
  private static readonly LOCATION_NOTICE_DISMISS_PREFIX =
    'discovery:location-notice:dismissed:v1:';

  readonly publicProfilesFacade = inject(DiscoveryPublicProfilesFacade);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly geolocationTracking = inject(GeolocationTrackingService);

  readonly locationPermission = signal<DiscoveryLocationPermissionState>('checking');
  readonly requestingLocation = signal(false);
  readonly locationNoticeDismissed = signal(false);
  readonly showLocationNotice = computed(() => {
    const permission = this.locationPermission();
    return (
      !this.locationNoticeDismissed() &&
      (permission === 'prompt' || permission === 'denied')
    );
  });

  readonly currentUser$: Observable<IUserDados | null> =
    this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly tabs: readonly DiscoveryModeTab[] = DISCOVERY_MODE_TABS
    .filter((tab) => !tab.disabled)
    .map((tab) =>
      tab.id === 'all'
        ? {
            ...tab,
            shortLabel: 'Para você',
            ariaLabel: 'Ver perfis selecionados para você',
          }
        : tab
    );

  /**
   * "all" continua sendo o identificador técnico do modo padrão.
   *
   * Regras:
   * - não exige localização;
   * - usa public_profiles como base;
   * - score, presença, distância e compatibilidade entram como enriquecimento;
   * - não deve virar lista bruta da plataforma.
   */
  readonly activeMode = signal<DiscoveryMode>(DEFAULT_DISCOVERY_MODE);

  ngOnInit(): void {
    this.restoreLocationNoticePreference();
    void this.refreshLocationPermission();
  }

  async activateLocation(): Promise<void> {
    if (this.requestingLocation()) return;

    const uid = this.getCurrentUid();
    if (!uid) return;

    this.requestingLocation.set(true);

    try {
      const permission = await this.geolocationTracking.requestPermissionOnce();
      this.locationPermission.set(permission);

      if (permission === 'granted') {
        this.clearLocationNoticePreference(uid);
        await this.geolocationTracking.autoStartTracking(uid);
      }
    } finally {
      this.requestingLocation.set(false);
    }
  }

  dismissLocationNotice(): void {
    const uid = this.getCurrentUid();
    this.locationNoticeDismissed.set(true);

    if (!uid || typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(this.locationNoticeKey(uid), '1');
    } catch {
      // preferência local best-effort; não bloqueia discovery
    }
  }

  onDiscoveryModeChange(mode: DiscoveryMode): void {
    const normalizedMode = normalizeDiscoveryExperienceMode(mode);

    if (!isDiscoveryModeEnabled(normalizedMode)) {
      return;
    }

    this.activeMode.set(normalizedMode);
  }

  private async refreshLocationPermission(): Promise<void> {
    const permission = await this.geolocationTracking.queryPermission();
    this.locationPermission.set(permission);

    if (permission === 'granted') {
      const uid = this.getCurrentUid();
      if (uid) this.clearLocationNoticePreference(uid);
    }
  }

  private restoreLocationNoticePreference(): void {
    const uid = this.getCurrentUid();
    if (!uid || typeof localStorage === 'undefined') {
      this.locationNoticeDismissed.set(false);
      return;
    }

    try {
      this.locationNoticeDismissed.set(
        localStorage.getItem(this.locationNoticeKey(uid)) === '1'
      );
    } catch {
      this.locationNoticeDismissed.set(false);
    }
  }

  private clearLocationNoticePreference(uid: string): void {
    this.locationNoticeDismissed.set(false);

    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.removeItem(this.locationNoticeKey(uid));
    } catch {
      // best-effort
    }
  }

  private locationNoticeKey(uid: string): string {
    return `${ProfilesDiscoveryPageComponent.LOCATION_NOTICE_DISMISS_PREFIX}${encodeURIComponent(uid)}`;
  }

  private getCurrentUid(): string | null {
    const uid = String(
      this.currentUserStore.getLoggedUserUIDSnapshot() ?? ''
    ).trim();

    return uid || null;
  }
}
