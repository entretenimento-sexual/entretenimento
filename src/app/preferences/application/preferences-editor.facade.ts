// src/app/preferences/application/preferences-editor.facade.ts
// -----------------------------------------------------------------------------
// FACHADA DO EDITOR DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// - espera a sessão do proprietário antes de ler documentos privados;
// - impede leitura de UID diferente do usuário autenticado;
// - aplica capacidades derivadas da projeção canônica da assinatura;
// - sanitiza benefícios pagos antes da persistência;
// - mantém tratamento de erros centralizado.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Observable,
  combineLatest,
  forkJoin,
  throwError,
} from 'rxjs';
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

import { IntentState } from '../models/intent-state.model';
import { PreferenceProfile } from '../models/preference-profile.model';
import {
  createEmptyIntentState,
  createEmptyPreferenceProfile,
} from '../utils/preference-normalizers';

import { IntentStateService } from '../services/intent-state.service';
import {
  PreferencesCapabilityService,
  PreferencesCapabilitySnapshot,
} from '../services/preferences-capability.service';
import { ProfilePreferencesService } from '../services/profile-preferences.service';

export interface PreferencesEditorState {
  uid: string;
  user: IUserDados | null;
  profile: PreferenceProfile;
  intent: IntentState;
  capabilities: PreferencesCapabilitySnapshot;
}

@Injectable({ providedIn: 'root' })
export class PreferencesEditorFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notifier = inject(ErrorNotificationService);

  private readonly profilePreferences = inject(ProfilePreferencesService);
  private readonly intentState = inject(IntentStateService);
  private readonly capabilities = inject(PreferencesCapabilityService);

  getEditorState$(uid: string): Observable<PreferencesEditorState> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[PreferencesEditorFacade] UID inválido.')
      );
    }

    return this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      filter((user): user is IUserDados => Boolean(user?.uid)),
      switchMap((user) => {
        if (user.uid !== safeUid) {
          return throwError(() => this.createOwnershipError(safeUid, user.uid));
        }

        // As leituras só começam depois que a sessão confirma o proprietário.
        // Isso evita listeners antecipados que as Rules recusariam durante o boot.
        return combineLatest([
          this.profilePreferences.getProfile$(safeUid),
          this.intentState.getIntentState$(safeUid),
        ]).pipe(
          map(([profile, intent]) => ({
            uid: safeUid,
            user,
            profile: profile ?? createEmptyPreferenceProfile(safeUid),
            intent: intent ?? createEmptyIntentState(safeUid),
            capabilities: this.capabilities.getCapabilities(user),
          }))
        );
      }),
      catchError((err) => {
        this.handleError(
          err,
          'getEditorState$',
          'Não foi possível carregar o editor de preferências.'
        );
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  saveAll$(
    uid: string,
    profile: PreferenceProfile,
    intent: IntentState
  ): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[PreferencesEditorFacade] UID inválido.')
      );
    }

    return this.requireOwner$(safeUid).pipe(
      switchMap(({ capabilities }) =>
        this.profilePreferences.getProfile$(safeUid).pipe(
          take(1),
          map((currentProfile) => ({
            profile: this.sanitizeProfile(
              profile,
              currentProfile,
              capabilities,
              safeUid
            ),
            intent: this.sanitizeIntent(intent, capabilities, safeUid),
          }))
        )
      ),
      switchMap(({ profile: safeProfile, intent: safeIntent }) =>
        forkJoin([
          this.profilePreferences
            .saveProfile$(safeUid, safeProfile)
            .pipe(take(1)),
          this.intentState
            .saveIntentState$(safeUid, safeIntent)
            .pipe(take(1)),
        ]).pipe(map(() => void 0))
      ),
      catchError((err) => {
        this.handleError(
          err,
          'saveAll$',
          'Não foi possível salvar suas preferências agora.'
        );
        return throwError(() => err);
      })
    );
  }

  saveProfileOnly$(
    uid: string,
    profile: PreferenceProfile
  ): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[PreferencesEditorFacade] UID inválido.')
      );
    }

    return this.requireOwner$(safeUid).pipe(
      switchMap(({ capabilities }) =>
        this.profilePreferences.getProfile$(safeUid).pipe(
          take(1),
          map((currentProfile) =>
            this.sanitizeProfile(
              profile,
              currentProfile,
              capabilities,
              safeUid
            )
          )
        )
      ),
      switchMap((safeProfile) =>
        this.profilePreferences.saveProfile$(safeUid, safeProfile).pipe(
          take(1),
          map(() => void 0)
        )
      ),
      catchError((err) => {
        this.handleError(
          err,
          'saveProfileOnly$',
          'Não foi possível salvar suas preferências.'
        );
        return throwError(() => err);
      })
    );
  }

  saveIntentOnly$(uid: string, intent: IntentState): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[PreferencesEditorFacade] UID inválido.')
      );
    }

    return this.requireOwner$(safeUid).pipe(
      map(({ capabilities }) =>
        this.sanitizeIntent(intent, capabilities, safeUid)
      ),
      switchMap((safeIntent) =>
        this.intentState.saveIntentState$(safeUid, safeIntent).pipe(
          take(1),
          map(() => void 0)
        )
      ),
      catchError((err) => {
        this.handleError(
          err,
          'saveIntentOnly$',
          'Não foi possível salvar sua disponibilidade.'
        );
        return throwError(() => err);
      })
    );
  }

  private requireOwner$(safeUid: string): Observable<{
    user: IUserDados;
    capabilities: PreferencesCapabilitySnapshot;
  }> {
    return this.currentUserStore.user$.pipe(
      map((user) => user ?? null),
      filter((user): user is IUserDados => Boolean(user?.uid)),
      take(1),
      map((user) => {
        if (user.uid !== safeUid) {
          throw this.createOwnershipError(safeUid, user.uid);
        }

        const capabilities = this.capabilities.getCapabilities(user);

        if (
          !capabilities.canEditCorePreferences ||
          !capabilities.canEditIntentState
        ) {
          throw new Error(
            '[PreferencesEditorFacade] Conta sem permissão para editar preferências.'
          );
        }

        return { user, capabilities };
      })
    );
  }

  private sanitizeProfile(
    requested: PreferenceProfile,
    current: PreferenceProfile,
    capabilities: PreferencesCapabilitySnapshot,
    uid: string
  ): PreferenceProfile {
    const requestedMode = requested.visibility?.discoveryMode ?? 'standard';
    const safeMode =
      requestedMode === 'priority' &&
      !capabilities.canUsePriorityVisibility
        ? 'standard'
        : requestedMode === 'discreet' &&
            !capabilities.canUseDiscreetMode
          ? 'standard'
          : requestedMode;

    return {
      ...requested,
      userId: uid,
      softRules: {
        ...requested.softRules,
        bodyPreferences: capabilities.canEditAdvancedPreferences
          ? requested.softRules.bodyPreferences ?? []
          : current.softRules.bodyPreferences ?? [],
        sexualPractices: capabilities.canEditAdvancedPreferences
          ? requested.softRules.sexualPractices ?? []
          : current.softRules.sexualPractices ?? [],
      },
      visibility: {
        ...requested.visibility,
        discoveryMode: safeMode,
      },
      updatedAt: Date.now(),
    };
  }

  private sanitizeIntent(
    requested: IntentState,
    capabilities: PreferencesCapabilitySnapshot,
    uid: string
  ): IntentState {
    return {
      ...requested,
      userId: uid,
      cityOverride: capabilities.canUseContextualIntent
        ? requested.cityOverride ?? null
        : null,
      expiresAt: capabilities.canUseContextualIntent
        ? requested.expiresAt ?? null
        : null,
      tags: capabilities.canUseContextualIntent
        ? requested.tags ?? []
        : [],
      updatedAt: Date.now(),
    };
  }

  private createOwnershipError(
    requestedUid: string,
    authenticatedUid: string
  ): Error {
    const error = new Error(
      '[PreferencesEditorFacade] O editor só pode acessar preferências do próprio usuário.'
    );

    (error as Error & { context?: unknown }).context = {
      requestedUidPresent: Boolean(requestedUid),
      authenticatedUidPresent: Boolean(authenticatedUid),
      sameOwner: requestedUid === authenticatedUid,
    };

    return error;
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
        : new Error(`[PreferencesEditorFacade] ${context}`);

    (error as Error & {
      silent?: boolean;
      original?: unknown;
      context?: unknown;
      feature?: string;
    }).silent = true;
    (error as Error & { original?: unknown }).original = err;
    (error as Error & { context?: unknown }).context = {
      existing: (error as Error & { context?: unknown }).context ?? null,
      operation: context,
    };
    (error as Error & { feature?: string }).feature = 'preferences';

    this.globalError.handleError(error);
    this.notifier.showError(userMessage);
  }
}
