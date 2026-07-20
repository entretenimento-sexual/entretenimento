// src/app/community/ownership-management/community-ownership-management.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
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
  tap,
} from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ActionStateDirective } from 'src/app/shared/action-state/action-state.directive';
import {
  CommunityOwnershipCandidate,
  CommunityOwnershipCandidateRole,
} from '../data-access/community-ownership.model';
import { CommunityOwnershipRepository } from '../data-access/community-ownership.repository';

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

type OwnershipConfirmation =
  | { kind: 'transfer'; candidate: CommunityOwnershipCandidate }
  | { kind: 'archive'; candidate: null };

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
  private readonly router = inject(Router);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly refreshCandidates$ = new Subject<void>();
  private readonly commands$ = new Subject<OwnershipCommand>();

  readonly communityId = input.required<string>();
  readonly ownershipChanged = output<void>();
  readonly communityArchived = output<void>();
  readonly confirmation = signal<OwnershipConfirmation | null>(null);

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
          this.reportError(
            error,
            'Não foi possível carregar os membros elegíveis à transferência.',
            'loadOwnershipCandidates'
          );
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
          this.confirmation.set(null);

          if (command.kind === 'transfer' && command.candidate) {
            this.errorNotifier.showSuccess(
              `A propriedade foi transferida para ${command.candidate.label}.`
            );
            this.ownershipChanged.emit();
            return;
          }

          this.errorNotifier.showSuccess('Comunidade arquivada com segurança.');
          this.communityArchived.emit();
          void this.router.navigateByUrl('/dashboard/comunidades');
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
          this.reportError(
            error,
            command.kind === 'transfer'
              ? 'Não foi possível transferir a propriedade agora.'
              : 'Não foi possível arquivar a Comunidade agora.',
            command.kind === 'transfer'
              ? 'transferCommunityOwnership'
              : 'archiveCommunity'
          );

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
    this.confirmation.set({ kind: 'transfer', candidate });
  }

  requestArchive(): void {
    this.confirmation.set({ kind: 'archive', candidate: null });
  }

  cancelConfirmation(): void {
    this.confirmation.set(null);
  }

  confirmAction(): void {
    const confirmation = this.confirmation();
    if (!confirmation) return;

    this.commands$.next({
      kind: confirmation.kind,
      candidate: confirmation.candidate,
    });
  }

  roleLabel(role: CommunityOwnershipCandidateRole): string {
    if (role === 'admin') return 'Administração';
    if (role === 'moderator') return 'Moderação';
    return 'Membro';
  }

  confirmationTitle(confirmation: OwnershipConfirmation): string {
    return confirmation.kind === 'transfer'
      ? 'Confirmar transferência'
      : 'Confirmar arquivamento';
  }

  confirmationDescription(confirmation: OwnershipConfirmation): string {
    if (confirmation.kind === 'transfer' && confirmation.candidate) {
      return `Você deixará de ser o proprietário. ${confirmation.candidate.label} passará a controlar a Comunidade.`;
    }

    return 'A Comunidade sairá da descoberta, ficará sem interação e será preservada apenas para histórico e auditoria.';
  }

  confirmationActionLabel(confirmation: OwnershipConfirmation): string {
    return confirmation.kind === 'transfer'
      ? 'Transferir propriedade'
      : 'Arquivar Comunidade';
  }

  confirmationBusyLabel(confirmation: OwnershipConfirmation): string {
    return confirmation.kind === 'transfer'
      ? 'Transferindo propriedade...'
      : 'Arquivando Comunidade...';
  }

  private reportError(error: unknown, fallback: string, op: string): void {
    const message = this.resolveUserMessage(error, fallback);

    try {
      this.errorNotifier.showError(message);
    } catch {
      // O diagnóstico técnico abaixo permanece ativo.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityOwnershipManagementComponent',
        op,
        communityId: this.communityId().trim(),
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o feedback visual.
    }
  }

  private resolveUserMessage(error: unknown, fallback: string): string {
    const source = (error ?? {}) as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
    };
    const details = (source.details ?? {}) as Record<string, unknown>;
    const reason = String(details['reason'] ?? '').toLowerCase();
    const code = String(source.code ?? '').toLowerCase();

    if (reason === 'recent-authentication-required') {
      return 'Por segurança, saia e entre novamente antes de confirmar esta ação.';
    }

    if (code.includes('data-loss')) {
      return 'A propriedade está inconsistente. A operação foi bloqueada para revisão.';
    }

    if (
      typeof source.message === 'string' &&
      source.message.trim() &&
      !source.message.toLowerCase().includes('internal')
    ) {
      return source.message;
    }

    return fallback;
  }
}
