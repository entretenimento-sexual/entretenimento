// src/app/community/ownership-transfers/community-ownership-transfers-page.component.ts
import { AsyncPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  catchError,
  exhaustMap,
  map,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
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
  CommunityOwnershipInboxItem,
  CommunityOwnershipInboxResponse,
} from '../data-access/community-ownership.model';
import { CommunityOwnershipRepository } from '../data-access/community-ownership.repository';
import { COMMUNITY_ERROR_PRESENTATION_CONTEXTS } from '../presentation/community-error.catalog';
import {
  COMMUNITY_OWNERSHIP_ACTION_CODE_MESSAGES,
  COMMUNITY_OWNERSHIP_LOAD_CODE_MESSAGES,
  COMMUNITY_OWNERSHIP_REASON_MESSAGES,
} from '../presentation/community-error.messages';

type OwnershipInboxState =
  | {
      status: 'loading' | 'error';
      incoming: readonly CommunityOwnershipInboxItem[];
      outgoing: readonly CommunityOwnershipInboxItem[];
    }
  | {
      status: 'ready';
      incoming: readonly CommunityOwnershipInboxItem[];
      outgoing: readonly CommunityOwnershipInboxItem[];
    };

type OwnershipInboxCommand = {
  kind: 'accept' | 'decline' | 'cancel';
  item: CommunityOwnershipInboxItem;
};

type OwnershipInboxActionState = {
  status: 'idle' | 'loading' | 'error';
  kind: OwnershipInboxCommand['kind'] | null;
  requestId: string | null;
};

@Component({
  selector: 'app-community-ownership-transfers-page',
  standalone: true,
  imports: [AsyncPipe, DatePipe, ActionStateDirective],
  templateUrl: './community-ownership-transfers-page.component.html',
  styleUrl: './community-ownership-transfers-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityOwnershipTransfersPageComponent {
  private readonly repository = inject(CommunityOwnershipRepository);
  private readonly dialog = inject(MatDialog);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly refresh$ = new Subject<void>();
  private readonly commands$ = new Subject<OwnershipInboxCommand>();

  readonly state$ = this.refresh$.pipe(
    startWith(undefined),
    switchMap(() =>
      this.repository.getOwnershipTransfers$().pipe(
        map((response): OwnershipInboxState => this.readyState(response)),
        startWith<OwnershipInboxState>({
          status: 'loading',
          incoming: [],
          outgoing: [],
        }),
        catchError((error: unknown) => {
          this.reportLoadError(error);
          return of<OwnershipInboxState>({
            status: 'error',
            incoming: [],
            outgoing: [],
          });
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly action$ = this.commands$.pipe(
    exhaustMap((command) => {
      const operation$ = command.kind === 'cancel'
        ? this.repository.cancelOwnershipTransfer$(command.item.requestId)
        : this.repository.respondOwnershipTransfer$(
            command.item.requestId,
            command.kind
          );

      return operation$.pipe(
        tap((result) => {
          if (result.status === 'completed') {
            this.notifier.showSuccess(
              'Você agora é o proprietário de '
              + command.item.communityName
              + '.'
            );
          } else if (result.status === 'declined') {
            this.notifier.showSuccess('A transferência foi recusada.');
          } else if (result.status === 'canceled') {
            this.notifier.showSuccess('A transferência foi cancelada.');
          } else {
            this.notifier.showWarning('Esta solicitação já havia expirado.');
          }

          this.refresh$.next();
        }),
        map(
          (): OwnershipInboxActionState => ({
            status: 'idle',
            kind: null,
            requestId: null,
          })
        ),
        startWith<OwnershipInboxActionState>({
          status: 'loading',
          kind: command.kind,
          requestId: command.item.requestId,
        }),
        catchError((error: unknown) => {
          this.reportActionError(error, command);
          return of<OwnershipInboxActionState>({
            status: 'error',
            kind: command.kind,
            requestId: command.item.requestId,
          });
        })
      );
    }),
    startWith<OwnershipInboxActionState>({
      status: 'idle',
      kind: null,
      requestId: null,
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  refresh(): void {
    this.refresh$.next();
  }

  isPending(item: CommunityOwnershipInboxItem): boolean {
    return item.status === 'pending' && item.expiresAt > Date.now();
  }

  modeLabel(item: CommunityOwnershipInboxItem): string {
    return item.mode === 'terminal_succession'
      ? 'Sucessão protegida'
      : 'Transferência voluntária';
  }

  statusLabel(item: CommunityOwnershipInboxItem): string {
    if (this.isPending(item)) return 'Aguardando resposta';
    if (item.status === 'completed') return 'Concluída';
    if (item.status === 'declined') return 'Recusada';
    if (item.status === 'canceled') return 'Cancelada';
    if (item.status === 'expired') return 'Expirada';
    return 'Encerrada';
  }

  requestAccept(item: CommunityOwnershipInboxItem): void {
    this.confirm(
      {
        eyebrow: 'Propriedade da Comunidade',
        title: 'Assumir ' + item.communityName + '?',
        message:
          'Ao aceitar, você passa a ser o proprietário e assume a administração da Comunidade.',
        detail:
          'O backend revalidará seu plano, quota, capacidade e elegibilidade antes de concluir. '
          + 'Nenhuma dívida ou campanha patrocinada do proprietário anterior será transferida.',
        confirmLabel: 'Aceitar propriedade',
        cancelLabel: 'Agora não',
        icon: 'key',
        tone: 'warning',
      },
      { kind: 'accept', item }
    );
  }

  requestDecline(item: CommunityOwnershipInboxItem): void {
    this.confirm(
      {
        eyebrow: 'Propriedade da Comunidade',
        title: 'Recusar ' + item.communityName + '?',
        message: 'A propriedade permanecerá inalterada.',
        detail:
          item.mode === 'terminal_succession'
            ? 'O caso de sucessão continuará aberto para que outro candidato possa ser indicado.'
            : 'O proprietário poderá indicar outro participante depois da recusa.',
        confirmLabel: 'Recusar',
        cancelLabel: 'Voltar',
        icon: 'close',
        tone: 'warning',
      },
      { kind: 'decline', item }
    );
  }

  requestCancel(item: CommunityOwnershipInboxItem): void {
    this.confirm(
      {
        eyebrow: 'Transferência pendente',
        title: 'Cancelar convite para ' + item.candidateLabel + '?',
        message: 'A propriedade continuará com você.',
        detail:
          'O participante será informado de que a oferta foi cancelada.',
        confirmLabel: 'Cancelar transferência',
        cancelLabel: 'Manter convite',
        icon: 'undo',
        tone: 'warning',
      },
      { kind: 'cancel', item }
    );
  }

  private readyState(
    response: CommunityOwnershipInboxResponse
  ): OwnershipInboxState {
    return {
      status: 'ready',
      incoming: response.incoming,
      outgoing: response.outgoing,
    };
  }

  private confirm(
    data: ConfirmationDialogData,
    command: OwnershipInboxCommand
  ): void {
    const ref = this.dialog.open<
      ConfirmationDialogComponent,
      ConfirmationDialogData,
      boolean
    >(ConfirmationDialogComponent, {
      panelClass: 'confirmation-dialog-panel',
      width: 'min(94vw, 500px)',
      maxWidth: '94vw',
      autoFocus: false,
      restoreFocus: true,
      data,
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed) this.commands$.next(command);
    });
  }

  private reportLoadError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadOwnershipTransfers',
      fallbackMessage:
        'Não foi possível carregar as transferências de propriedade.',
      communityPresentationContext:
        COMMUNITY_ERROR_PRESENTATION_CONTEXTS.SILENT_NON_BLOCKING,
      reasonMessages: COMMUNITY_OWNERSHIP_REASON_MESSAGES,
      codeMessages: COMMUNITY_OWNERSHIP_LOAD_CODE_MESSAGES,
      metadata: { scope: 'CommunityOwnershipTransfersPageComponent' },
    });
  }

  private reportActionError(
    error: unknown,
    command: OwnershipInboxCommand
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'respondOwnershipTransfer',
      fallbackMessage:
        'Não foi possível concluir esta ação de propriedade.',
      reasonMessages: COMMUNITY_OWNERSHIP_REASON_MESSAGES,
      codeMessages: COMMUNITY_OWNERSHIP_ACTION_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityOwnershipTransfersPageComponent',
        requestId: command.item.requestId,
        kind: command.kind,
      },
    });
  }
}
