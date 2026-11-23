// Gerenciamento de bloqueios do UID atual, em tempo real e sem NgRx legado.
// Escritas permanecem exclusivamente nas Cloud Functions do domínio social.
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, EMPTY, Observable, combineLatest, of } from 'rxjs';
import {
  catchError, distinctUntilChanged, filter, finalize, map,
  shareReplay, startWith, switchMap, take, takeUntil, tap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ConfirmationDialogComponent } from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';

interface BlockedProfilesState {
  readonly ownerUid: string | null;
  readonly status: 'loading' | 'ready' | 'error' | 'signed-out';
  readonly blockedUids: readonly string[];
}

@Component({
  selector: 'app-friend-blocked',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent, ContentStateComponent],
  templateUrl: './friend-blocked.component.html',
  styleUrls: ['./friend-blocked.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendBlockedComponent {
  private readonly authSession = inject(AuthSessionService);
  private readonly friendship = inject(FriendshipService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly notification = inject(ErrorNotificationService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshSubject = new BehaviorSubject(0);

  readonly pendingUid = signal<string | null>(null);

  /** Uma única coleção observada por UID; troca/logout desmontam a anterior. */
  readonly state$: Observable<BlockedProfilesState> = combineLatest([
    this.authSession.uid$.pipe(distinctUntilChanged()),
    this.refreshSubject,
  ]).pipe(
    switchMap(([uid]) => {
      const ownerUid = String(uid ?? '').trim();
      if (!ownerUid) {
        return of<BlockedProfilesState>({
          ownerUid: null, status: 'signed-out', blockedUids: [],
        });
      }
      return this.friendship.watchBlockedUids(ownerUid).pipe(
        map((blockedUids): BlockedProfilesState => ({
          ownerUid, status: 'ready', blockedUids,
        })),
        startWith({
          ownerUid, status: 'loading' as const, blockedUids: [],
        }),
        catchError((error): Observable<BlockedProfilesState> => {
          this.applicationError.report(error, {
            feature: 'friendship',
            operation: 'FriendBlockedComponent.watchBlockedUids',
            fallbackMessage: 'Não foi possível atualizar seus perfis bloqueados.',
            presentation: { surface: 'none', severity: 'error' },
          });
          return of({ ownerUid, status: 'error', blockedUids: [] });
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  retry(): void {
    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  unblockUser(targetUid: string): void {
    if (!targetUid || this.pendingUid()) return;

    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: 'min(92vw, 28rem)',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      data: {
        title: 'Desbloquear perfil?',
        message: 'Deseja permitir novamente o acesso entre vocês?',
        detail: 'Isso não restaura conexões anteriores. Se a outra pessoa ainda bloqueia você, o acesso continua indisponível.',
        confirmLabel: 'Desbloquear',
        cancelLabel: 'Manter bloqueado',
        tone: 'warning',
      },
    });

    dialogRef.afterClosed().pipe(
      take(1),
      filter((confirmed) => confirmed === true),
      switchMap(() => this.authSession.uid$.pipe(take(1))),
      filter((uid): uid is string => typeof uid === 'string' && uid.trim().length > 0),
      switchMap((uid) => {
        if (this.pendingUid()) return EMPTY;
        this.pendingUid.set(targetUid);
        return this.friendship.unblockUser(uid, targetUid).pipe(
          // Uma resposta de uma conta anterior nunca produz feedback na nova.
          takeUntil(this.authSession.uid$.pipe(
            filter((currentUid) => currentUid !== uid)
          )),
          tap(() => this.notification.showSuccess(
            'Perfil desbloqueado. A lista foi atualizada.'
          )),
          catchError((error) => {
            this.applicationError.report(error, {
              feature: 'friendship',
              operation: 'FriendBlockedComponent.unblockUser',
              fallbackMessage: 'Não foi possível desbloquear este perfil.',
            });
            return EMPTY;
          }),
          finalize(() => this.pendingUid.set(null))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }
}
