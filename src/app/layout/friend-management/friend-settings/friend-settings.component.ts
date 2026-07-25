// src/app/layout/friend-management/friend-settings/friend-settings.component.ts
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  catchError,
  finalize,
  of,
  switchMap,
  take,
  tap,
  throwError,
} from 'rxjs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AppState } from 'src/app/store/states/app.state';
import { updateFriendSettings } from 'src/app/store/actions/actions.interactions/actions.friends';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';

interface FriendSettings {
  receiveRequests: boolean;
  showOnlineStatus: boolean;
  allowSearchByNickname: boolean;
}

@Component({
  selector: 'app-friend-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './friend-settings.component.html',
  styleUrl: './friend-settings.component.css',
})
export class FriendSettingsComponent implements OnInit {
  settingsForm: FormGroup;
  readonly isLoading$: Observable<boolean>;

  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);
  private readonly cacheTtlMs = 10 * 60 * 1000;

  constructor(
    private readonly fb: FormBuilder,
    private readonly store: Store<AppState>,
    private readonly authSession: AuthSessionService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly cacheService: CacheService,
    private readonly destroyRef: DestroyRef
  ) {
    this.settingsForm = this.fb.nonNullable.group({
      receiveRequests: true,
      showOnlineStatus: true,
      allowSearchByNickname: true,
    });

    this.isLoading$ = this.isLoadingSubject.asObservable();
  }

  ngOnInit(): void {
    this.loadSettings();
  }

  /**
   * Carrega as configurações do usuário autenticado.
   *
   * A chave inclui o UID canônico para impedir que uma conta reutilize as
   * configurações locais deixadas por outra conta no mesmo navegador.
   */
  private loadSettings(): void {
    this.authSession.readyUid$
      .pipe(
        take(1),
        switchMap((uid) => {
          const safeUid = this.normalizeUid(uid);
          if (!safeUid) return of<FriendSettings | null>(null);

          return this.cacheService
            .get<FriendSettings>(this.cacheKey(safeUid))
            .pipe(take(1));
        }),
        catchError((error: unknown) => {
          this.reportError(error, 'loadSettings', false);
          return of<FriendSettings | null>(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((settings) => {
        if (settings) {
          this.settingsForm.patchValue(settings);
        }
      });
  }

  /**
   * Atualiza Store e cache local do usuário autenticado.
   *
   * O loading é estado reativo de UI em memória. Ele não é mais persistido no
   * cache, pois estados transitórios não devem sobreviver a navegação ou reload.
   */
  saveSettings(): void {
    if (this.isLoadingSubject.value) return;

    const settings = this.settingsForm.getRawValue() as FriendSettings;
    this.updateLoadingState(true);

    this.authSession.readyUid$
      .pipe(
        take(1),
        switchMap((uid) => {
          const safeUid = this.normalizeUid(uid);
          if (!safeUid) {
            return throwError(
              () => new Error('Sessão autenticada indisponível para salvar configurações.')
            );
          }

          this.store.dispatch(updateFriendSettings({ settings }));
          this.cacheService.set(
            this.cacheKey(safeUid),
            settings,
            this.cacheTtlMs,
            { persist: true }
          );

          return of(void 0);
        }),
        tap(() => {
          this.errorNotifier.showSuccess(
            'Configurações de amizade atualizadas com sucesso!'
          );
        }),
        catchError((error: unknown) => {
          this.reportError(error, 'saveSettings', true);
          return EMPTY;
        }),
        finalize(() => this.updateLoadingState(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private cacheKey(uid: string): string {
    return `friendSettings:${uid}`;
  }

  private normalizeUid(uid: string | null | undefined): string {
    return String(uid ?? '').trim();
  }

  private updateLoadingState(state: boolean): void {
    this.isLoadingSubject.next(state);
  }

  private reportError(
    error: unknown,
    operation: 'loadSettings' | 'saveSettings',
    notifyUser: boolean
  ): void {
    const normalizedError =
      error instanceof Error
        ? error
        : new Error('Erro inesperado nas configurações de amizade.');

    (normalizedError as Error & { context?: Record<string, unknown> }).context = {
      scope: 'FriendSettingsComponent',
      operation,
    };

    this.globalErrorHandler.handleError(normalizedError);

    if (notifyUser) {
      this.errorNotifier.showError(
        'Não foi possível salvar as configurações de amizade.'
      );
    }
  }
}
