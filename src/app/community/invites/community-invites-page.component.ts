// src/app/community/invites/community-invites-page.component.ts
import { AsyncPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  catchError,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
} from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  CommunityInviteInboxItem,
} from '../data-access/community-invite.model';
import { CommunityInviteRepository } from '../data-access/community-invite.repository';

type CommunityInvitesStatus = 'loading' | 'ready' | 'empty' | 'error';
type CommunityInviteAction = 'accept' | 'decline';

interface CommunityInvitesState {
  status: CommunityInvitesStatus;
  items: readonly CommunityInviteInboxItem[];
}

@Component({
  selector: 'app-community-invites-page',
  standalone: true,
  imports: [AsyncPipe, DatePipe, RouterLink, ImageFallbackDirective],
  templateUrl: './community-invites-page.component.html',
  styleUrl: './community-invites-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityInvitesPageComponent {
  private readonly repository = inject(CommunityInviteRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly router = inject(Router);
  private readonly reloadRequests$ = new Subject<void>();
  private readonly busyInviteActions = signal<
    ReadonlyMap<string, CommunityInviteAction>
  >(new Map());

  readonly busyInviteIds = computed<ReadonlySet<string>>(
    () => new Set(this.busyInviteActions().keys())
  );

  readonly state$: Observable<CommunityInvitesState> = this.reloadRequests$.pipe(
    startWith(undefined),
    switchMap(() =>
      this.repository.getInvites$().pipe(
        map((response): CommunityInvitesState => ({
          status: response.items.length > 0 ? 'ready' : 'empty',
          items: response.items,
        })),
        startWith<CommunityInvitesState>({ status: 'loading', items: [] }),
        catchError((error: unknown) => {
          this.reportError(error, 'loadInvites');
          return of<CommunityInvitesState>({ status: 'error', items: [] });
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.reloadRequests$.next();
  }

  isBusy(inviteId: string): boolean {
    return this.busyInviteActions().has(inviteId);
  }

  busyAction(inviteId: string): CommunityInviteAction | null {
    return this.busyInviteActions().get(inviteId) ?? null;
  }

  accept(item: CommunityInviteInboxItem): void {
    if (this.isBusy(item.inviteId)) return;
    this.setBusy(item.inviteId, 'accept');

    this.repository.acceptInvite$(item.inviteId).pipe(
      take(1),
      finalize(() => this.setBusy(item.inviteId, null))
    ).subscribe({
      next: () => {
        this.notifications.showSuccess(
          `Você entrou em ${item.communityName}.`
        );
        void this.router.navigate([
          '/dashboard/comunidades',
          item.communityId,
        ]);
      },
      error: (error: unknown) => this.reportActionError(
        error,
        'acceptInvite',
        'Não foi possível aceitar este convite.'
      ),
    });
  }

  decline(item: CommunityInviteInboxItem): void {
    if (this.isBusy(item.inviteId)) return;
    this.setBusy(item.inviteId, 'decline');

    this.repository.declineInvite$(item.inviteId).pipe(
      take(1),
      finalize(() => this.setBusy(item.inviteId, null))
    ).subscribe({
      next: () => {
        this.notifications.showSuccess('Convite recusado.');
        this.reloadRequests$.next();
      },
      error: (error: unknown) => this.reportActionError(
        error,
        'declineInvite',
        'Não foi possível recusar este convite.'
      ),
    });
  }

  private setBusy(
    inviteId: string,
    action: CommunityInviteAction | null
  ): void {
    const next = new Map(this.busyInviteActions());

    if (action) {
      next.set(inviteId, action);
    } else {
      next.delete(inviteId);
    }

    this.busyInviteActions.set(next);
  }

  private reportActionError(
    error: unknown,
    op: string,
    message: string
  ): void {
    try {
      this.notifications.showError(message);
    } catch {
      // O erro técnico continua sendo encaminhado abaixo.
    }

    this.reportError(error, op, true);
  }

  private reportError(
    error: unknown,
    op: string,
    skipUserNotification = false
  ): void {
    if (!skipUserNotification) {
      try {
        this.notifications.showError(
          'Não foi possível carregar seus convites de Comunidades.'
        );
      } catch {
        // A observabilidade abaixo permanece ativa.
      }
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityInvitesPageComponent',
        op,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
