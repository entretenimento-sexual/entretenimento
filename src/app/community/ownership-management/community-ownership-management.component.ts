// src/app/community/ownership-management/community-ownership-management.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ActionStateDirective } from 'src/app/shared/action-state/action-state.directive';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import {
  CommunityOwnershipCandidate,
  CommunityOwnershipCandidateRole,
} from '../data-access/community-ownership.model';
import { CommunityOwnershipRepository } from '../data-access/community-ownership.repository';
import {
  COMMUNITY_OWNERSHIP_ACTION_CODE_MESSAGES,
  COMMUNITY_OWNERSHIP_LOAD_CODE_MESSAGES,
  COMMUNITY_OWNERSHIP_REASON_MESSAGES,
} from '../presentation/community-error.messages';

type OwnershipCandidatesState =
  | { status: 'loading'; items: readonly CommunityOwnershipCandidate[] }
  | { status: 'ready'; items: readonly CommunityOwnershipCandidate[] }
  | { status: 'error'; items: readonly CommunityOwnershipCandidate[] };

type OwnershipActionState =
  | { status: 'idle'; kind: null; targetUid: null }
  | {
      status: 'loading' | 'error';
      kind: 'transfer' | 'archive';
      targetUid: string | null;
    };

interface OwnershipCommand {
  kind: 'transfer' | 'archive';
  candidate: CommunityOwnershipCandidate | null;
}

@Component({
  selector: 'app-community-ownership-management',
  standalone: true,
  imports: [AsyncPipe, ActionStateDirective],
  templateUrl: './community-ownership-management.component.html',
  styleUrl: './community-ownership-management.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityOwnershipManagementComponent {
  private readonly repository = inject(CommunityOwnershipRepository);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly refreshCandidates$ = new Subject<void>();
  private readonly commands$ = new Subject<OwnershipCommand>();

  readonly communityId = input.required<string>();
  readonly ownershipChanged = output<void>();
  readonly communityArchived = output<void>();

  private readonly communityId$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter((communityId) => communityId.length > 0),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$ = combineLatest([
    this.communityId$,
    this.refreshCandidates$.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([communityId]) =>
      this.repository.getCandidates$(communityId).pipe(
        map(
          (response): OwnershipCandidatesState => ({
            status: 'ready',
            items: response.items,
          })
        ),
        startWith<OwnershipCandidatesState>({ status: 'loading', items: [] }),
        catchError((error: unknown) => {
          this.reportLoadError(error);
          return of<OwnershipCandidatesState>({ status: 'error', items: [] });
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly action$ = this.commands$.pipe(
    exhaustMap((command) => {
      const operation$: Observable<unknown> =
        command.kind === 'transfer' && command.candidate
          ? this.repository.transferOwnership$(
              this.communityId().trim(),
              command.candidate.uid
            )
          : this.repository.archiveCommunity$(
              this.communityId().trim(),
              'Arquivamento solicitado pelo proprietário.'
            );

      return operation$.pipe(
        tap(() => {
          if (command.kind === 'transfer' && command.candidate) {
            this.errorNotifier.showSuccess(
              `A propriedade foi transferida para ${command.candidate.label}.`
            );
            this.ownershipChanged.emit();
            return;
          }

          this.errorNotifier.showSuccess('Comunidade arquivada com segurança.');
          this.communityArchived.emit();
          void this.router.navigateByUrl('/dashboard/comunidades').catch(
            (error: unknown) => this.reportNavigationError(error)
          );
        }),
        map(
          (): OwnershipActionState => ({
            status: 'idle',
            kind: null,
            targetUid: null,
          })
        ),
        startWith<OwnershipActionState>({
          status: 'loading',
          kind: command.kind,
          targetUid: command.candidate?.uid ?? null,
        }),
        catchError((error: unknown) => {
          this.reportActionError(error, command);

          return of<OwnershipActionState>({
            status: 'error',
            kind: command.kind,
            targetUid: command.candidate?.uid ?? null,
          });
        })
      );
    }),
    startWith<OwnershipActionState>({
      status: 'idle',
      kind: null,
      targetUid: null,
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  refresh(): void {
    this.refreshCandidates$.next();
  }

  requestTransfer(candidate: CommunityOwnershipCandidate): void {
    const data: ConfirmationDialogData = {
      eyebrow: 'Ação de proprietário',
      title: `Transferir propriedade para ${candidate.label}?`,
      message: 'Você deixará de ser o proprietário desta Comunidade.',
      detail:
        `${candidate.label} passará a controlar a Comunidade e você continuará `
        + 'como Membro. A capacidade passará a seguir o plano do novo '
        + 'proprietário; se o teto diminuir, ninguém será removido, mas novas '
        + 'entradas poderão ser pausadas. Esta ação exige autenticação recente.',
      confirmLabel: 'Transferir propriedade',
      cancelLabel: 'Cancelar',
      icon: 'swap_horiz',
      tone: 'warning',
    };

    this.openConfirmation(data, {
      kind: 'transfer',
      candidate,
    });
  }

  requestArchive(): void {
    const data: ConfirmationDialogData = {
      eyebrow: 'Zona de risco',
      title: 'Arquivar esta Comunidade?',
      message:
        'A Comunidade sairá da descoberta e novas interações serão bloqueadas.',
      detail:
        'O histórico e a auditoria serão preservados. A restauração não está '
        + 'disponível pela plataforma neste momento.',
      confirmLabel: 'Arquivar Comunidade',
      cancelLabel: 'Cancelar',
      icon: 'archive',
      tone: 'danger',
    };

    this.openConfirmation(data, { kind: 'archive', candidate: null });
  }

  roleLabel(role: CommunityOwnershipCandidateRole): string {
    if (role === 'admin') return 'Administração';
    if (role === 'moderator') return 'Moderação';
    return 'Membro';
  }

  private openConfirmation(
    data: ConfirmationDialogData,
    command: OwnershipCommand
  ): void {
    const ref = this.dialog.open<
      ConfirmationDialogComponent,
      ConfirmationDialogData,
      boolean
    >(ConfirmationDialogComponent, {
      panelClass: 'confirmation-dialog-panel',
      width: 'min(94vw, 480px)',
      maxWidth: '94vw',
      autoFocus: false,
      restoreFocus: true,
      data,
    });

    ref.afterClosed()
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.commands$.next(command);
      });
  }

  private reportLoadError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadOwnershipCandidates',
      fallbackMessage:
        'Não foi possível carregar os membros elegíveis à transferência.',
      notification: 'none',
      reasonMessages: COMMUNITY_OWNERSHIP_REASON_MESSAGES,
      codeMessages: COMMUNITY_OWNERSHIP_LOAD_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityOwnershipManagementComponent',
        communityId: this.communityId().trim(),
      },
    });
  }

  private reportActionError(error: unknown, command: OwnershipCommand): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: command.kind === 'transfer'
        ? 'transferCommunityOwnership'
        : 'archiveCommunity',
      fallbackMessage: command.kind === 'transfer'
        ? 'Não foi possível transferir a propriedade agora.'
        : 'Não foi possível arquivar a Comunidade agora.',
      reasonMessages: COMMUNITY_OWNERSHIP_REASON_MESSAGES,
      codeMessages: COMMUNITY_OWNERSHIP_ACTION_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityOwnershipManagementComponent',
        communityId: this.communityId().trim(),
        kind: command.kind,
        targetUid: command.candidate?.uid ?? null,
      },
    });
  }

  private reportNavigationError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'navigateAfterArchive',
      fallbackMessage:
        'A Comunidade foi arquivada, mas não foi possível abrir a lista agora.',
      metadata: {
        scope: 'CommunityOwnershipManagementComponent',
        communityId: this.communityId().trim(),
      },
    });
  }
}
