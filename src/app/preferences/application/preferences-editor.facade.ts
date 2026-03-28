// src/app/preferences/application/preferences-editor.facade.ts
// Fachada de edição do domínio de preferências.
//
// Objetivo:
// - concentrar leitura/escrita do editor novo
// - isolar a UI de detalhes dos services internos
// - aplicar gating por capabilities/role de forma centralizada
//
// Observação:
// - não toca no legado
// - não faz bridge
// - serve de base para páginas/components inéditos

import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, forkJoin, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, take } from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

import { PreferenceProfile } from '../models/preference-profile.model';
import { IntentState } from '../models/intent-state.model';
import { createEmptyIntentState, createEmptyPreferenceProfile } from '../utils/preference-normalizers';

import { ProfilePreferencesService } from '../services/profile-preferences.service';
import { IntentStateService } from '../services/intent-state.service';
import {
  PreferencesCapabilityService,
  PreferencesCapabilitySnapshot,
} from '../services/preferences-capability.service';

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
      return throwError(() => new Error('[PreferencesEditorFacade] UID inválido.'));
    }

    return combineLatest([
      this.currentUserStore.user$.pipe(map((user) => user ?? null)),
      this.profilePreferences.getProfile$(safeUid),
      this.intentState.getIntentState$(safeUid),
    ]).pipe(
      map(([user, profile, intent]) => ({
        uid: safeUid,
        user: user?.uid === safeUid ? user : null,
        profile: profile ?? createEmptyPreferenceProfile(safeUid),
        intent: intent ?? createEmptyIntentState(safeUid),
        capabilities: this.capabilities.getCapabilities(user?.uid === safeUid ? user : null),
      })),
      catchError((err) => {
        this.handleError(err, 'getEditorState$', 'Não foi possível carregar o editor de preferências.');
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
      return throwError(() => new Error('[PreferencesEditorFacade] UID inválido.'));
    }

    return this.currentUserStore.user$.pipe(
      take(1),
      map((user) => user ?? null),
      map((user) => {
        const caps = this.capabilities.getCapabilities(user?.uid === safeUid ? user : null);

        if (!caps.canEditAdvancedPreferences) {
          throw new Error('[PreferencesEditorFacade] Usuário sem permissão para editar preferências avançadas.');
        }

        return caps;
      }),
      map(() => ({
        profile: {
          ...profile,
          userId: safeUid,
          updatedAt: Date.now(),
        },
        intent: {
          ...intent,
          userId: safeUid,
          updatedAt: Date.now(),
        },
      })),
      switchMapSafe(({ profile: safeProfile, intent: safeIntent }) =>
        forkJoin([
          this.profilePreferences.saveProfile$(safeUid, safeProfile).pipe(take(1)),
          this.intentState.saveIntentState$(safeUid, safeIntent).pipe(take(1)),
        ]).pipe(map(() => void 0))
      ),
      catchError((err) => {
        this.handleError(err, 'saveAll$', 'Não foi possível salvar suas preferências agora.');
        return throwError(() => err);
      })
    );
  }

  saveProfileOnly$(uid: string, profile: PreferenceProfile): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(() => new Error('[PreferencesEditorFacade] UID inválido.'));
    }

    return this.currentUserStore.user$.pipe(
      take(1),
      map((user) => user ?? null),
      map((user) => {
        const caps = this.capabilities.getCapabilities(user?.uid === safeUid ? user : null);

        if (!caps.canEditAdvancedPreferences) {
          throw new Error('[PreferencesEditorFacade] Usuário sem permissão para editar preferências.');
        }

        return {
          ...profile,
          userId: safeUid,
          updatedAt: Date.now(),
        };
      }),
      switchMapSafe((safeProfile) =>
        this.profilePreferences.saveProfile$(safeUid, safeProfile).pipe(
          take(1),
          map(() => void 0)
        )
      ),
      catchError((err) => {
        this.handleError(err, 'saveProfileOnly$', 'Não foi possível salvar o perfil de preferências.');
        return throwError(() => err);
      })
    );
  }

  saveIntentOnly$(uid: string, intent: IntentState): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(() => new Error('[PreferencesEditorFacade] UID inválido.'));
    }

    return this.currentUserStore.user$.pipe(
      take(1),
      map((user) => user ?? null),
      map((user) => {
        const caps = this.capabilities.getCapabilities(user?.uid === safeUid ? user : null);

        if (!caps.canEditAdvancedPreferences) {
          throw new Error('[PreferencesEditorFacade] Usuário sem permissão para editar intenção.');
        }

        return {
          ...intent,
          userId: safeUid,
          updatedAt: Date.now(),
        };
      }),
      switchMapSafe((safeIntent) =>
        this.intentState.saveIntentState$(safeUid, safeIntent).pipe(
          take(1),
          map(() => void 0)
        )
      ),
      catchError((err) => {
        this.handleError(err, 'saveIntentOnly$', 'Não foi possível salvar sua intenção atual.');
        return throwError(() => err);
      })
    );
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }

  private handleError(err: unknown, context: string, userMessage: string): void {
    const e = err instanceof Error ? err : new Error(`[PreferencesEditorFacade] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;
    (e as any).feature = 'preferences';

    this.globalError.handleError(e);
    this.notifier.showError(userMessage);
  }
}

function switchMapSafe<T, R>(project: (value: T) => Observable<R>) {
  return (source: Observable<T>): Observable<R> =>
    new Observable<R>((subscriber) => {
      let innerSub: { unsubscribe(): void } | null = null;

      const outerSub = source.subscribe({
        next(value) {
          innerSub?.unsubscribe();
          innerSub = project(value).subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
          });
        },
        error: (e) => subscriber.error(e),
        complete: () => subscriber.complete(),
      });

      return () => {
        innerSub?.unsubscribe();
        outerSub.unsubscribe();
      };
    });
}