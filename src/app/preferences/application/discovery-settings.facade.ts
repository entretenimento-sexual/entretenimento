// src/app/preferences/application/discovery-settings.facade.ts
// Fachada de leitura/escrita das configurações de descoberta.
//
// Objetivo:
// - centralizar leitura do bloco de visibilidade
// - aplicar gating por capability antes de salvar
// - preparar uma trilha clara para produto/monetização

import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, switchMap, take } from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

import {
  PreferenceProfile,
  PreferenceVisibilitySettings,
} from '../models/preference-profile.model';
import { ProfilePreferencesService } from '../services/profile-preferences.service';
import {
  PreferencesCapabilityService,
  PreferencesCapabilitySnapshot,
} from '../services/preferences-capability.service';

export interface DiscoverySettingsVm {
  uid: string;
  user: IUserDados | null;
  profile: PreferenceProfile;
  visibility: PreferenceVisibilitySettings;
  capabilities: PreferencesCapabilitySnapshot;
}

@Injectable({ providedIn: 'root' })
export class DiscoverySettingsFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notifier = inject(ErrorNotificationService);

  private readonly profilePreferences = inject(ProfilePreferencesService);
  private readonly capabilities = inject(PreferencesCapabilityService);

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUid$ = this.currentUser$.pipe(
    map((user) => user?.uid?.trim() || null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentDiscoverySettingsVm$ = this.currentUid$.pipe(
    switchMap((uid) => {
      if (!uid) return of(null);
      return this.getDiscoverySettingsVmByUid$(uid);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  getDiscoverySettingsVmByUid$(uid: string): Observable<DiscoverySettingsVm> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(() => new Error('[DiscoverySettingsFacade] UID inválido.'));
    }

    return this.currentUser$.pipe(
      switchMap((currentUser) =>
        this.profilePreferences.getProfile$(safeUid).pipe(
          map((profile) => {
            const user = currentUser?.uid === safeUid ? currentUser : null;
            return {
              uid: safeUid,
              user,
              profile,
              visibility: profile.visibility,
              capabilities: this.capabilities.getCapabilities(user),
            };
          })
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  saveVisibilitySettings$(
    uid: string,
    visibility: PreferenceVisibilitySettings
  ): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(() => new Error('[DiscoverySettingsFacade] UID inválido.'));
    }

    return this.currentUser$.pipe(
      take(1),
      map((user) => {
        const effectiveUser = user?.uid === safeUid ? user : null;
        const caps = this.capabilities.getCapabilities(effectiveUser);

        if (!caps.canEditAdvancedPreferences) {
          throw new Error('[DiscoverySettingsFacade] Usuário sem permissão para editar configurações de descoberta.');
        }

        return {
          caps,
          sanitized: this.sanitizeVisibilitySettings(visibility, caps),
        };
      }),
      switchMap(({ sanitized }) =>
        this.profilePreferences.updateProfile$(safeUid, {
          visibility: sanitized,
        })
      ),
      catchError((err) => {
        this.handleError(
          err,
          'saveVisibilitySettings$',
          'Não foi possível salvar as configurações de descoberta.'
        );
        return throwError(() => err);
      })
    );
  }

  private sanitizeVisibilitySettings(
    visibility: PreferenceVisibilitySettings,
    capabilities: PreferencesCapabilitySnapshot
  ): PreferenceVisibilitySettings {
    const safeMode =
      visibility.discoveryMode === 'priority' && !capabilities.canUsePriorityVisibility
        ? 'standard'
        : visibility.discoveryMode === 'discreet' && !capabilities.canUseDiscreetMode
          ? 'standard'
          : visibility.discoveryMode;

    return {
      showPreferenceBadges: !!visibility.showPreferenceBadges,
      showIntentPublicly: !!visibility.showIntentPublicly,
      discoveryMode: safeMode,
    };
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }

  private handleError(err: unknown, context: string, userMessage: string): void {
    const e = err instanceof Error ? err : new Error(`[DiscoverySettingsFacade] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;
    (e as any).feature = 'discovery_settings';

    this.globalError.handleError(e);
    this.notifier.showError(userMessage);
  }
}