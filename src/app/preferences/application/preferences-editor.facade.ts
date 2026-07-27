// src/app/preferences/application/preferences-editor.facade.ts
// -----------------------------------------------------------------------------
// FACHADA DO EDITOR DE PREFERÊNCIAS
// -----------------------------------------------------------------------------
// - deriva o editor principal diretamente da sessão autenticada;
// - espera a sessão do proprietário antes de ler documentos privados;
// - mantém as streams de perfil/intenção estáveis enquanto o UID não muda;
// - mantém validação estrita para chamadas explícitas com UID;
// - aplica capacidades derivadas da projeção canônica da assinatura;
// - sanitiza benefícios pagos antes da persistência;
// - persiste perfil + projeção de discovery de forma atômica;
// - mantém tratamento de erros centralizado.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Observable,
  combineLatest,
  throwError,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import type { IUserDados } from '@core/interfaces/iuser-dados';

import type { IntentState } from '../models/intent-state.model';
import type { PreferenceProfile } from '../models/preference-profile.model';
import {
  createEmptyIntentState,
  normalizePreferenceProfile,
} from '../utils/preference-normalizers';

import { IntentStateService } from '../services/intent-state.service';
import {
  PreferencesCapabilityService,
  type PreferencesCapabilitySnapshot,
} from '../services/preferences-capability.service';
import { PreferenceProfilePersistenceService } from '../services/preference-profile-persistence.service';
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
  private readonly profilePersistence = inject(PreferenceProfilePersistenceService);
  private readonly intentState = inject(IntentStateService);
  private readonly capabilities = inject(PreferencesCapabilityService);

  private readonly authenticatedUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    filter((user): user is IUserDados => Boolean(user?.uid?.trim())),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * O UID controla a vida das leituras privadas. Atualizações normais no usuário
   * atual (plano, projeção de discovery, presença) não recriam profile$/intent$ e
   * não sobrescrevem outro formulário que ainda esteja dirty.
   */
  private readonly authenticatedUid$ = this.authenticatedUser$.pipe(
    map((user) => this.normalizeUid(user.uid)),
    filter(Boolean),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Estado canônico do editor da própria conta.
   * Não recebe UID da URL e, portanto, não pode divergir da sessão ativa.
   */
  readonly currentEditorState$: Observable<PreferencesEditorState> =
    this.authenticatedUid$.pipe(
      switchMap((uid) => this.buildEditorState$(uid)),
      catchError((err) => {
        this.handleError(
          err,
          'currentEditorState$',
          'Não foi possível carregar o editor de preferências.'
        );
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * API estrita mantida para consumidores que realmente precisem informar UID.
   * Divergências são rejeitadas antes de qualquer leitura privada.
   */
  getEditorState$(uid: string): Observable<PreferencesEditorState> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(
        () => new Error('[PreferencesEditorFacade] UID inválido.')
      );
    }

    return this.authenticatedUser$.pipe(
      take(1),
      switchMap((user) => {
        if (user.uid !== safeUid) {
          return throwError(() => this.createOwnershipError(safeUid, user.uid));
        }

        return this.buildEditorState$(safeUid);
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
        this.profilePersistence
          .saveAllWithProjection$(safeUid, safeProfile, safeIntent)
          .pipe(take(1))
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
        this.profilePersistence
          .saveProfileWithProjection$(safeUid, safeProfile)
          .pipe(take(1))
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

  private buildEditorState$(uid: string): Observable<PreferencesEditorState> {
    // As leituras são criadas uma vez por UID. O usuário segue reativo para que
    // mudança de plano/capacidade seja refletida sem recriar os documentos.
    return combineLatest([
      this.authenticatedUser$.pipe(
        filter((user) => this.normalizeUid(user.uid) === uid)
      ),
      this.profilePreferences.getProfile$(uid),
      this.intentState.getIntentState$(uid),
    ]).pipe(
      map(([user, profile, intent]) => ({
        uid,
        user,
        profile: normalizePreferenceProfile(profile, uid),
        intent: intent ?? createEmptyIntentState(uid),
        capabilities: this.capabilities.getCapabilities(user),
      }))
    );
  }

  private requireOwner$(safeUid: string): Observable<{
    user: IUserDados;
    capabilities: PreferencesCapabilitySnapshot;
  }> {
    return this.authenticatedUser$.pipe(
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
    const safeCurrent = normalizePreferenceProfile(current, uid);
    const safeRequested = normalizePreferenceProfile(requested, uid);
    const requestedMode = safeRequested.visibility.discoveryMode;
    const safeMode =
      requestedMode === 'priority' &&
      !capabilities.canUsePriorityVisibility
        ? 'standard'
        : requestedMode === 'discreet' &&
            !capabilities.canUseDiscreetMode
          ? 'standard'
          : requestedMode;

    const canEditAdvanced = capabilities.canEditAdvancedPreferences;
    const canRequireAdvanced = capabilities.canRequireAdvancedPreferences;

    return normalizePreferenceProfile(
      {
        ...safeRequested,
        userId: uid,
        softRules: {
          ...safeRequested.softRules,
          bodyPreferences: canEditAdvanced
            ? safeRequested.softRules.bodyPreferences ?? []
            : safeCurrent.softRules.bodyPreferences ?? [],
          sexualPractices: canEditAdvanced
            ? safeRequested.softRules.sexualPractices ?? []
            : safeCurrent.softRules.sexualPractices ?? [],
        },
        matchingModes: {
          relationshipIntents:
            safeRequested.matchingModes.relationshipIntents,
          sexualPractices: canEditAdvanced
            ? safeRequested.matchingModes.sexualPractices === 'require' &&
              canRequireAdvanced
              ? 'require'
              : 'prefer'
            : safeCurrent.matchingModes.sexualPractices,
          bodyPreferences: canEditAdvanced
            ? safeRequested.matchingModes.bodyPreferences === 'require' &&
              canRequireAdvanced
              ? 'require'
              : 'prefer'
            : safeCurrent.matchingModes.bodyPreferences,
        },
        visibility: {
          ...safeRequested.visibility,
          discoveryMode: safeMode,
        },
        updatedAt: Date.now(),
      },
      uid
    );
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
