// src/app/account/pages/account-privilege-history/account-privilege-history.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, merge, of, Subject } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  skip,
  switchMap,
} from 'rxjs/operators';

import { AccountPrivilegeHistoryRepository } from '../../application/account-privilege-history.repository';
import { AccountPrivilegeHistoryItem } from '../../models/account-privilege-history.model';
import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

interface PrivilegeHistoryState {
  status: 'loading' | 'ready' | 'error';
  items: AccountPrivilegeHistoryItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  loadMoreError: boolean;
  generation: number;
}

const INITIAL_STATE: PrivilegeHistoryState = {
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
  loadMoreError: false,
  generation: 0,
};

@Component({
  selector: 'app-account-privilege-history',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './account-privilege-history.component.html',
  styleUrl: '../subscription-history/subscription-history.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountPrivilegeHistoryComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly repository = inject(AccountPrivilegeHistoryRepository);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly reload$ = new Subject<void>();
  private readonly loadMore$ = new Subject<void>();
  private readonly stateSubject = new BehaviorSubject<PrivilegeHistoryState>(
    INITIAL_STATE
  );

  readonly state$ = this.stateSubject.asObservable();

  constructor() {
    const privilegeChanges$ = this.currentUserStore.user$.pipe(
      map((user) => String(user?.role ?? '').toLowerCase() === 'admin'),
      distinctUntilChanged(),
      skip(1),
      map(() => void 0)
    );

    merge(of(void 0), this.reload$, privilegeChanges$)
      .pipe(
        map(() => {
          const generation = this.stateSubject.value.generation + 1;
          this.stateSubject.next({
            ...INITIAL_STATE,
            generation,
          });
          return generation;
        }),
        switchMap((generation) =>
          this.repository.getMyHistory$(null, 25).pipe(
            map((page) => ({ ok: true as const, page, generation })),
            catchError((error: unknown) =>
              of({ ok: false as const, error, generation })
            )
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (result.generation !== this.stateSubject.value.generation) return;

        if (!result.ok) {
          this.reportError(result.error, 'loadPrivilegeHistory', false);
          this.stateSubject.next({
            ...INITIAL_STATE,
            status: 'error',
            generation: result.generation,
          });
          return;
        }

        this.stateSubject.next({
          status: 'ready',
          items: result.page.items,
          nextCursor: result.page.nextCursor,
          loadingMore: false,
          loadMoreError: false,
          generation: result.generation,
        });
      });

    this.loadMore$
      .pipe(
        map(() => this.stateSubject.value),
        filter((state) =>
          state.status === 'ready'
          && !!state.nextCursor
          && !state.loadingMore
        ),
        map((state) => {
          this.stateSubject.next({
            ...state,
            loadingMore: true,
            loadMoreError: false,
          });
          return state;
        }),
        exhaustMap((state) =>
          this.repository.getMyHistory$(state.nextCursor, 25).pipe(
            map((page) => ({ ok: true as const, page, state })),
            catchError((error: unknown) =>
              of({ ok: false as const, error, state })
            )
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        const current = this.stateSubject.value;
        if (result.state.generation !== current.generation) return;

        if (!result.ok) {
          this.reportError(result.error, 'loadMorePrivilegeHistory', true);
          this.stateSubject.next({
            ...current,
            loadingMore: false,
            loadMoreError: true,
          });
          return;
        }

        const items = new Map<string, AccountPrivilegeHistoryItem>();
        for (const item of [...current.items, ...result.page.items]) {
          items.set(item.id, item);
        }

        this.stateSubject.next({
          ...current,
          items: Array.from(items.values()),
          nextCursor: result.page.nextCursor,
          loadingMore: false,
          loadMoreError: false,
        });
      });
  }

  retry(): void {
    this.reload$.next();
  }

  loadMore(): void {
    this.loadMore$.next();
  }

  eventTitle(item: AccountPrivilegeHistoryItem): string {
    return item.eventType === 'admin_granted'
      ? 'Privilégio administrativo concedido'
      : 'Privilégio administrativo revogado';
  }

  eventDescription(item: AccountPrivilegeHistoryItem): string {
    return item.eventType === 'admin_granted'
      ? 'A conta passou a ter acesso administrativo à plataforma.'
      : 'A conta deixou de ter acesso administrativo à plataforma.';
  }

  private reportError(
    error: unknown,
    operation: string,
    notifyUser: boolean
  ): void {
    if (notifyUser) {
      try {
        this.notifier.showError(
          'Não foi possível carregar registros mais antigos.'
        );
      } catch {
        // O diagnóstico central permanece ativo.
      }
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        feature: 'account-privilege-history',
        operation,
        scope: 'AccountPrivilegeHistoryComponent',
        op: operation,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Observabilidade não pode quebrar o estado visual da página.
    }
  }
}
