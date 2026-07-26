// src/app/preferences/application/discovery-settings.facade.ts
// -----------------------------------------------------------------------------
// FACHADA DE DESCOBERTA E VISIBILIDADE
// -----------------------------------------------------------------------------
// - privacidade básica permanece disponível para toda conta autenticada;
// - modos pagos são sanitizados pela projeção canônica da assinatura;
// - leituras privadas só começam após confirmação do proprietário.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import {
  catchError,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

import {
  PreferenceProfile,
  PreferenceVisibilitySettings,
} from '../models/preference-profile.model';
import {
  PreferencesCapabilityService,
  PreferencesCapabilitySnapshot,
} from '../services/preferences-capability.service';
import { ProfilePreferencesService } from '../services/profile-preferences.service';

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
      return throwError(
        () => new Error('[DiscoverySettingsFacade] UID inválido.')
      );
    }

    return this.currentUser$.pipe(
      filter((user): user is IUserDados => Boolean(user?.uid)),
      switchMap((user) => {
        if (user.uid !== safeUid) {
          return throwError(
            () =>
              new Error(
                '[DiscoverySettingsFacade] Configurações privadas disponíveis apenas ao proprietário.'
              )
          );
        }

        return this.profilePreferences.getProfile$(safeUid).pipe(
          map((profile) => ({
            uid: safeUid,
            user,
            profile,
            visibility: profile.visibility,
            capabilities: this.capabilities.getCapabilities(user),
          }))
        );
      }),
      catchError((err) => {
        this.handleError(
          err,
          'getDiscoverySettingsVmByUid$',
          'Não foi possível carregar as configurações de descoberta.'
        );
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  saveVisibilitySettings$(
    uid: string,
    visibility: PreferenceVisibilitySettings
  ): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[DiscoverySettingsFacade] UID inválido.')
      );
    }

    return this.currentUser$.pipe(
      filter((user): user is IUserDados => Boolean(user?.uid)),
      take(1),
      map((user) => {
        if (user.uid !== safeUid) {
          throw new Error(
            '[DiscoverySettingsFacade] Usuário sem permissão para editar este perfil.'
          );
        }

        const capabilities = this.capabilities.getCapabilities(user);

        if (!capabilities.canEditCorePreferences) {
          throw new Error(
            '[DiscoverySettingsFacade] Conta sem permissão para editar descoberta.'
          );
        }

        return this.sanitizeVisibilitySettings(visibility, capabilities);
      }),
      switchMap((sanitized) =>
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
      visibility.discoveryMode === 'priority' &&
      !capabilities.canUsePriorityVisibility
        ? 'standard'
        : visibility.discoveryMode === 'discreet' &&
            !capabilities.canUseDiscreetMode
          ? 'standard'
          : visibility.discoveryMode;

    return {
      showPreferenceBadges: Boolean(visibility.showPreferenceBadges),
      showIntentPublicly: Boolean(visibility.showIntentPublicly),
      discoveryMode: safeMode,
    };
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }

  private handleError(
    err: unknown,
    context: string,
    userMessage: string
  ): void {
    const error =
      err instanceof Error
        ? err
        : new Error(`[DiscoverySettingsFacade] ${context}`);

    (error as Error & {
      silent?: boolean;
      original?: unknown;
      context?: unknown;
      feature?: string;
    }).silent = true;
    (error as Error & { original?: unknown }).original = err;
    (error as Error & { context?: unknown }).context = context;
    (error as Error & { feature?: string }).feature = 'discovery_settings';

    this.globalError.handleError(error);
    this.notifier.showError(userMessage);
  }
}
