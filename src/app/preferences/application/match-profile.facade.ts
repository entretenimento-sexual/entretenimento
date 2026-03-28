// src/app/preferences/application/match-profile.facade.ts
// Fachada do fluxo de materialização e leitura do MatchProfile.
//
// Objetivo:
// - combinar usuário canônico + profile + intent
// - construir o MatchProfile via builder
// - persistir via store service
// - expor leitura do materializado e do preview construído em memória

import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, forkJoin, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, switchMap, take } from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

import { MatchProfile } from '../models/match-profile.model';
import { PreferenceProfile } from '../models/preference-profile.model';
import { IntentState } from '../models/intent-state.model';

import { ProfilePreferencesService } from '../services/profile-preferences.service';
import { IntentStateService } from '../services/intent-state.service';
import { MatchProfileBuilderService } from '../services/match-profile-builder.service';
import { MatchProfileStoreService } from '../services/match-profile-store.service';

export interface MatchProfileVm {
  uid: string;
  user: IUserDados | null;
  profile: PreferenceProfile;
  intent: IntentState;
  built: MatchProfile | null;
  stored: MatchProfile | null;
}

@Injectable({ providedIn: 'root' })
export class MatchProfileFacade {
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly notifier = inject(ErrorNotificationService);

  private readonly profilePreferences = inject(ProfilePreferencesService);
  private readonly intentState = inject(IntentStateService);
  private readonly builder = inject(MatchProfileBuilderService);
  private readonly store = inject(MatchProfileStoreService);

  readonly currentUser$ = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentUid$ = this.currentUser$.pipe(
    map((user) => user?.uid?.trim() || null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly currentMatchProfileVm$ = this.currentUid$.pipe(
    switchMap((uid) => {
      if (!uid) return of(null);
      return this.getMatchProfileVmByUid$(uid);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  getMatchProfileVmByUid$(uid: string): Observable<MatchProfileVm> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(() => new Error('[MatchProfileFacade] UID inválido.'));
    }

    return combineLatest([
      this.currentUser$,
      this.profilePreferences.getProfile$(safeUid),
      this.intentState.getIntentState$(safeUid),
      this.store.getMatchProfile$(safeUid),
    ]).pipe(
      map(([currentUser, profile, intent, stored]) => {
        const user = currentUser?.uid === safeUid ? currentUser : null;
        const built = user ? this.builder.build(user, profile, intent) : null;

        return {
          uid: safeUid,
          user,
          profile,
          intent,
          built,
          stored: stored?.userId ? stored : null,
        };
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  rebuildAndPersistForCurrentUser$(): Observable<void> {
    return this.currentUser$.pipe(
      take(1),
      switchMap((user) => {
        if (!user?.uid) {
          return throwError(() => new Error('[MatchProfileFacade] Usuário atual ausente.'));
        }

        return this.rebuildAndPersistByUser$(user);
      }),
      catchError((err) => {
        this.handleError(err, 'rebuildAndPersistForCurrentUser$', 'Não foi possível atualizar o perfil de descoberta.');
        return throwError(() => err);
      })
    );
  }

  rebuildAndPersistByUid$(uid: string): Observable<void> {
    const safeUid = this.normalizeUid(uid);
    if (!safeUid) {
      return throwError(() => new Error('[MatchProfileFacade] UID inválido.'));
    }

    return this.currentUser$.pipe(
      take(1),
      switchMap((currentUser) => {
        if (!currentUser || currentUser.uid !== safeUid) {
          return throwError(() => new Error('[MatchProfileFacade] Usuário atual não corresponde ao UID informado.'));
        }

        return this.rebuildAndPersistByUser$(currentUser);
      }),
      catchError((err) => {
        this.handleError(err, 'rebuildAndPersistByUid$', 'Não foi possível atualizar o perfil materializado.');
        return throwError(() => err);
      })
    );
  }

  private rebuildAndPersistByUser$(user: IUserDados): Observable<void> {
    return forkJoin({
      profile: this.profilePreferences.getProfile$(user.uid).pipe(take(1)),
      intent: this.intentState.getIntentState$(user.uid).pipe(take(1)),
    }).pipe(
      map(({ profile, intent }) => this.builder.build(user, profile, intent)),
      switchMap((matchProfile) =>
        this.store.saveMatchProfile$(user.uid, matchProfile).pipe(take(1))
      )
    );
  }

  private normalizeUid(uid: string): string {
    return (uid ?? '').trim();
  }

  private handleError(err: unknown, context: string, userMessage: string): void {
    const e = err instanceof Error ? err : new Error(`[MatchProfileFacade] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;
    (e as any).feature = 'match_profile';

    this.globalError.handleError(e);
    this.notifier.showError(userMessage);
  }
}