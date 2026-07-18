import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

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
export class ProfilesDiscoveryPageComponent {
  readonly publicProfilesFacade = inject(DiscoveryPublicProfilesFacade);
  private readonly currentUserStore = inject(CurrentUserStoreService);

  readonly currentUser$: Observable<IUserDados | null> =
    this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly tabs: readonly DiscoveryModeTab[] = DISCOVERY_MODE_TABS.filter(
    (tab) => !tab.disabled
  );

  /**
   * "Todos" é o modo padrão.
   *
   * Regras:
   * - não exige localização;
   * - usa public_profiles como base;
   * - score, presença, distância e região entram como enriquecimento/ranking;
   * - não deve virar lista bruta da plataforma.
   */
  readonly activeMode = signal<DiscoveryMode>(DEFAULT_DISCOVERY_MODE);

  onDiscoveryModeChange(mode: DiscoveryMode): void {
    const normalizedMode = normalizeDiscoveryExperienceMode(mode);

    if (!isDiscoveryModeEnabled(normalizedMode)) {
      return;
    }

    this.activeMode.set(normalizedMode);
  }
}
