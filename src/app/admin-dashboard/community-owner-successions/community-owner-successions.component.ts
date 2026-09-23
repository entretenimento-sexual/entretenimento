// src/app/admin-dashboard/community-owner-successions/community-owner-successions.component.ts
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  exhaustMap,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
} from 'rxjs';

import {
  CommunityOwnerSuccessionAdminItem,
} from 'src/app/community/data-access/community-owner-succession-admin.model';
import {
  CommunityOwnerSuccessionAdminRepository,
} from 'src/app/community/data-access/community-owner-succession-admin.repository';
import {
  CommunityOwnershipCandidate,
  CommunityOwnershipCandidatesResponse,
} from 'src/app/community/data-access/community-ownership.model';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ActionStateDirective } from 'src/app/shared/action-state/action-state.directive';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';

interface CandidateState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: readonly CommunityOwnershipCandidate[];
  nextCursor: string | null;
  loadingMore: boolean;
}

type CandidatePageEvent =
  | { kind: 'loading-more' }
  | { kind: 'page'; response: CommunityOwnershipCandidatesResponse }
  | { kind: 'load-more-error' };

type SuccessionCommand =
  | {
      kind: 'nominate';
      succession: CommunityOwnerSuccessionAdminItem;
      candidate: CommunityOwnershipCandidate;
    }
  | {
      kind: 'cancel';
      succession: CommunityOwnerSuccessionAdminItem;
      candidate: null;
    };

interface SuccessionActionState {
  status: 'idle' | 'loading' | 'error';
  communityId: string | null;
  targetUid: string | null;
  kind: SuccessionCommand['kind'] | null;
}

@Component({
  selector: 'app-community-owner-successions',
  standalone: true,
  imports: [CommonModule, ActionStateDirective],
  templateUrl: './community-owner-successions.component.html',
  styleUrl: './community-owner-successions.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityOwnerSuccessionsComponent {
  private readonly repository = inject(CommunityOwnerSuccessionAdminRepository);
  private readonly dialog = inject(MatDialog);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly refresh$ = new BehaviorSubject<void>(undefined);
  private readonly selectedCase$ =
    new BehaviorSubject<CommunityOwnerSuccessionAdminItem | null>(null);
  private readonly loadMoreCandidates$ = new Subject<string>();
  private readonly commands$ = new Subject<SuccessionCommand>();

  readonly queue$ = this.refresh$.pipe(
    switchMap(() =>
      this.repository.getQueue$().pipe(
        catchError((error: unknown) => {
          this.reportError(
            error,
            'loadCommunityOwnerSuccessionQueue',
            'Não foi possível carregar a fila de sucessões.'
          );
          return of({ items: [], generatedAt: Date.now() });
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedCaseView$ = combineLatest([
    this.queue$,
    this.selectedCase$,
  ]).pipe(
    map(([queue, selected]) => {
      if (!selected) return null;
      return queue.items.find(
        (item) => item.communityId === selected.communityId
      ) ?? null;
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly candidates$ = this.selectedCaseView$.pipe(
    switchMap((succession) => {
      if (!succession) {
        return of<CandidateState>({
          status: 'idle',
          items: [],
          nextCursor: null,
          loadingMore: false,
        });
      }

      return this.repository.getCandidates$(succession.communityId).pipe(
        switchMap((initialResponse) => {
          const initialState: CandidateState = {
            status: 'ready',
            items: initialResponse.items,
            nextCursor: initialResponse.nextCursor,
            loadingMore: false,
          };

          return this.loadMoreCandidates$.pipe(
            exhaustMap((cursor) =>
              this.repository
                .getCandidates$(succession.communityId, cursor)
                .pipe(
                  map(
                    (response): CandidatePageEvent => ({
                      kind: 'page',
                      response,
                    })
                  ),
                  startWith<CandidatePageEvent>({
                    kind: 'loading-more',
                  }),
                  catchError((error: unknown) => {
                    this.reportError(
                      error,
                      'loadMoreCommunityOwnerSuccessionCandidates',
                      'Não foi possível carregar mais candidatos.'
                    );
                    return of<CandidatePageEvent>({
                      kind: 'load-more-error',
                    });
                  })
                )
            ),
            scan<CandidatePageEvent, CandidateState>(
              (state, event) => this.reduceCandidateState(state, event),
              initialState
            ),
            startWith(initialState)
          );
        }),
        startWith<CandidateState>({
          status: 'loading',
          items: [],
          nextCursor: null,
          loadingMore: false,
        }),
        catchError((error: unknown) => {
          this.reportError(
            error,
            'loadCommunityOwnerSuccessionCandidates',
            'Não foi possível carregar os candidatos à sucessão.'
          );
          return of<CandidateState>({
            status: 'error',
            items: [],
            nextCursor: null,
            loadingMore: false,
          });
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly action$ = this.commands$.pipe(
    exhaustMap((command) => {
      const operation$: Observable<unknown> =
        command.kind === 'nominate' && command.candidate
        ? this.repository.nominate$(
            command.succession.communityId,
            command.candidate.uid
          )
        : this.repository.cancelCase$(command.succession.communityId);

      return operation$.pipe(
        tap(() => {
          this.notifier.showSuccess(
            command.kind === 'nominate'
              ? 'Convite de sucessão enviado ao participante.'
              : 'Caso de sucessão cancelado.'
          );
          if (command.kind === 'cancel') {
            this.selectedCase$.next(null);
          }
          this.refresh$.next();
        }),
        map(
          (): SuccessionActionState => ({
            status: 'idle',
            communityId: null,
            targetUid: null,
            kind: null,
          })
        ),
        startWith<SuccessionActionState>({
          status: 'loading',
          communityId: command.succession.communityId,
          targetUid: command.candidate?.uid ?? null,
          kind: command.kind,
        }),
        catchError((error: unknown) => {
          this.reportError(
            error,
            command.kind === 'nominate'
              ? 'nominateCommunityOwnerTerminalSuccessor'
              : 'cancelCommunityOwnerTerminalSuccession',
            command.kind === 'nominate'
              ? 'Não foi possível indicar este sucessor.'
              : 'Não foi possível cancelar este caso.'
          );
          return of<SuccessionActionState>({
            status: 'error',
            communityId: command.succession.communityId,
            targetUid: command.candidate?.uid ?? null,
            kind: command.kind,
          });
        })
      );
    }),
    startWith<SuccessionActionState>({
      status: 'idle',
      communityId: null,
      targetUid: null,
      kind: null,
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  selectCase(item: CommunityOwnerSuccessionAdminItem): void {
    this.selectedCase$.next(item);
  }

  refresh(): void {
    this.refresh$.next();
  }

  loadMore(cursor: string | null): void {
    const normalized = String(cursor ?? '').trim();
    if (normalized) this.loadMoreCandidates$.next(normalized);
  }

  requestNomination(
    succession: CommunityOwnerSuccessionAdminItem,
    candidate: CommunityOwnershipCandidate
  ): void {
    if (succession.activeRequestId) {
      this.notifier.showWarning(
        'Já existe um convite de sucessão aguardando resposta.'
      );
      return;
    }

    this.confirm(
      {
        eyebrow: 'Sucessão de propriedade',
        title: 'Indicar ' + candidate.label + '?',
        message:
          'O participante receberá um convite e precisará aceitar explicitamente.',
        detail:
          'Plano, quota, capacidade e elegibilidade serão revalidados no aceite. '
          + 'Nenhuma dívida ou campanha do proprietário anterior será transferida.',
        confirmLabel: 'Enviar convite',
        cancelLabel: 'Voltar',
        icon: 'person_add',
        tone: 'warning',
      },
      {
        kind: 'nominate',
        succession,
        candidate,
      }
    );
  }

  requestCancel(succession: CommunityOwnerSuccessionAdminItem): void {
    this.confirm(
      {
        eyebrow: 'Sucessão terminal',
        title: 'Cancelar este caso?',
        message:
          'Use apenas se a premissa de perda definitiva ou abandono tiver sido revertida.',
        detail:
          'Qualquer convite pendente será cancelado e a Comunidade voltará ao estado anterior de ownership.',
        confirmLabel: 'Cancelar sucessão',
        cancelLabel: 'Manter caso',
        icon: 'undo',
        tone: 'warning',
      },
      {
        kind: 'cancel',
        succession,
        candidate: null,
      }
    );
  }

  triggerLabel(
    trigger: CommunityOwnerSuccessionAdminItem['trigger']
  ): string {
    return trigger === 'confirmed_abandonment'
      ? 'Abandono confirmado'
      : 'Conta definitivamente indisponível';
  }

  private reduceCandidateState(
    state: CandidateState,
    event: CandidatePageEvent
  ): CandidateState {
    if (event.kind === 'loading-more') {
      return { ...state, loadingMore: true };
    }
    if (event.kind === 'load-more-error') {
      return { ...state, loadingMore: false };
    }

    const byUid = new Map(
      state.items.map((candidate) => [candidate.uid, candidate] as const)
    );
    for (const candidate of event.response.items) {
      byUid.set(candidate.uid, candidate);
    }

    return {
      status: 'ready',
      items: Array.from(byUid.values()).sort((left, right) =>
        left.label.localeCompare(right.label, 'pt-BR')
      ),
      nextCursor: event.response.nextCursor,
      loadingMore: false,
    };
  }

  private confirm(
    data: ConfirmationDialogData,
    command: SuccessionCommand
  ): void {
    const ref = this.dialog.open<
      ConfirmationDialogComponent,
      ConfirmationDialogData,
      boolean
    >(ConfirmationDialogComponent, {
      panelClass: 'confirmation-dialog-panel',
      width: 'min(94vw, 520px)',
      maxWidth: '94vw',
      autoFocus: false,
      restoreFocus: true,
      data,
    });

    ref.afterClosed().pipe(take(1)).subscribe((confirmed) => {
      if (confirmed) this.commands$.next(command);
    });
  }

  private reportError(
    error: unknown,
    operation: string,
    fallbackMessage: string
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation,
      fallbackMessage,
      metadata: {
        scope: 'CommunityOwnerSuccessionsComponent',
      },
    });
  }
}
