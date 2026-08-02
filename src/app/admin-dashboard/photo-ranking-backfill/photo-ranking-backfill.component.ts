import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Observable, merge, of, timer } from 'rxjs';
import {
  catchError,
  finalize,
  map,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';

import {
  ICallableCooldownState,
} from 'src/app/core/services/error-handler/callable-cooldown.policy';
import {
  CallableCooldownService,
} from 'src/app/core/services/error-handler/callable-cooldown.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  AdminPhotoRankingBackfillAction,
  AdminPhotoRankingBackfillStatus,
  AdminPhotoRankingBackfillService,
  IAdminPhotoRankingBackfillControlResult,
  IAdminPhotoRankingBackfillStatusResponse,
} from 'src/app/core/services/media/admin-photo-ranking-backfill.service';

type PanelLoadStatus = 'loading' | 'ready' | 'error';

interface PhotoRankingBackfillPanelState {
  status: PanelLoadStatus;
  data: IAdminPhotoRankingBackfillStatusResponse | null;
}

const STATUS_REFRESH_INTERVAL_MS = 30_000;
const DEFAULT_PAGE_SIZE = 120;
const MIN_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 180;
const COOLDOWN_SCOPE = {
  status: 'admin-photo-ranking-backfill-status',
  action: 'admin-photo-ranking-backfill-action',
} as const;

function inactiveCooldown(scope: string): ICallableCooldownState {
  return {
    scope,
    active: false,
    expiresAt: 0,
    remainingMs: 0,
    remainingSeconds: 0,
  };
}

@Component({
  selector: 'app-photo-ranking-backfill',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './photo-ranking-backfill.component.html',
  styleUrls: ['./photo-ranking-backfill.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoRankingBackfillComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly backfill = inject(AdminPhotoRankingBackfillService);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly cooldowns = inject(CallableCooldownService);
  private readonly refreshSubject = new BehaviorSubject<number>(0);

  readonly busyAction = signal<AdminPhotoRankingBackfillAction | null>(null);
  readonly resetConfirmation = signal(false);
  readonly pageSize = signal(DEFAULT_PAGE_SIZE);
  private readonly pageSizeTouched = signal(false);

  readonly statusCooldown = toSignal(
    this.cooldowns.state$(COOLDOWN_SCOPE.status),
    { initialValue: inactiveCooldown(COOLDOWN_SCOPE.status) }
  );
  readonly actionCooldown = toSignal(
    this.cooldowns.state$(COOLDOWN_SCOPE.action),
    { initialValue: inactiveCooldown(COOLDOWN_SCOPE.action) }
  );

  readonly cooldownMessage = computed(() => {
    const active = [this.statusCooldown(), this.actionCooldown()]
      .filter((state) => state.active);

    if (!active.length) {
      return '';
    }

    const remainingSeconds = Math.max(
      ...active.map((state) => state.remainingSeconds)
    );

    return `Proteção contra excesso de chamadas ativa. Tente novamente em ${remainingSeconds} segundo(s).`;
  });

  readonly panelState$: Observable<PhotoRankingBackfillPanelState> = merge(
    this.refreshSubject,
    timer(STATUS_REFRESH_INTERVAL_MS, STATUS_REFRESH_INTERVAL_MS)
  ).pipe(
    switchMap(() =>
      this.backfill.getStatus$().pipe(
        tap((data) => {
          if (!this.pageSizeTouched()) {
            this.pageSize.set(data.state.pageSize);
          }
        }),
        map((data) => ({
          status: 'ready',
          data,
        } as PhotoRankingBackfillPanelState)),
        startWith({
          status: 'loading',
          data: null,
        } as PhotoRankingBackfillPanelState),
        catchError((error) => {
          this.cooldowns.captureResourceExhausted(
            error,
            COOLDOWN_SCOPE.status,
            3_000
          );

          return of({
            status: 'error',
            data: null,
          } as PhotoRankingBackfillPanelState);
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly panelState = toSignal(this.panelState$, {
    initialValue: {
      status: 'loading',
      data: null,
    } as PhotoRankingBackfillPanelState,
  });

  readonly isBusy = computed(() => this.busyAction() !== null);

  refresh(): void {
    if (this.cooldowns.notifyIfActive(COOLDOWN_SCOPE.status)) {
      return;
    }

    this.refreshSubject.next(this.refreshSubject.value + 1);
  }

  onPageSizeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const numeric = Number(input.value);
    const normalized = Number.isFinite(numeric)
      ? Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, Math.trunc(numeric)))
      : DEFAULT_PAGE_SIZE;

    this.pageSize.set(normalized);
    this.pageSizeTouched.set(true);
  }

  startOrResume(): void {
    this.executeAction('START_OR_RESUME');
  }

  pause(): void {
    this.executeAction('PAUSE');
  }

  runPage(): void {
    this.executeAction('RUN_PAGE');
  }

  beginReset(): void {
    if (this.isBusy() || this.actionCooldown().active) {
      this.cooldowns.notifyIfActive(COOLDOWN_SCOPE.action);
      return;
    }

    this.resetConfirmation.set(true);
  }

  cancelReset(): void {
    this.resetConfirmation.set(false);
  }

  confirmReset(): void {
    if (!this.resetConfirmation()) {
      return;
    }

    this.executeAction('RESET');
  }

  canStartOrResume(status: AdminPhotoRankingBackfillStatus): boolean {
    return status === 'IDLE' || status === 'PAUSED' || status === 'FAILED';
  }

  canPause(status: AdminPhotoRankingBackfillStatus): boolean {
    return status === 'RUNNING';
  }

  canRunPage(status: AdminPhotoRankingBackfillStatus): boolean {
    return status === 'IDLE' || status === 'RUNNING' || status === 'PAUSED';
  }

  statusLabel(status: AdminPhotoRankingBackfillStatus): string {
    switch (status) {
      case 'IDLE':
        return 'Não iniciado';
      case 'RUNNING':
        return 'Em execução';
      case 'PAUSED':
        return 'Pausado';
      case 'COMPLETED':
        return 'Concluído';
      case 'FAILED':
        return 'Interrompido por falhas';
    }
  }

  statusDescription(status: AdminPhotoRankingBackfillStatus): string {
    switch (status) {
      case 'IDLE':
        return 'A migração ainda não processou nenhum lote.';
      case 'RUNNING':
        return 'O scheduler continuará processando páginas automaticamente.';
      case 'PAUSED':
        return 'O cursor foi preservado e a execução automática está suspensa.';
      case 'COMPLETED':
        return 'Todas as fotos alcançadas pelo cursor foram verificadas.';
      case 'FAILED':
        return 'Cinco falhas consecutivas bloquearam a retomada automática.';
    }
  }

  statusTone(status: AdminPhotoRankingBackfillStatus): string {
    switch (status) {
      case 'RUNNING':
        return 'info';
      case 'COMPLETED':
        return 'success';
      case 'PAUSED':
      case 'IDLE':
        return 'warning';
      case 'FAILED':
        return 'danger';
    }
  }

  updateRate(data: IAdminPhotoRankingBackfillStatusResponse): number {
    const processed = data.state.processedCount;
    return processed > 0
      ? Math.round((data.state.updatedCount / processed) * 100)
      : 0;
  }

  lastActivityAt(data: IAdminPhotoRankingBackfillStatusResponse): number {
    return data.state.lastBatchAt ?? data.state.updatedAt ?? data.checkedAt;
  }

  private executeAction(action: AdminPhotoRankingBackfillAction): void {
    if (
      this.isBusy() ||
      this.cooldowns.notifyIfActive(COOLDOWN_SCOPE.action)
    ) {
      return;
    }

    this.busyAction.set(action);

    this.backfill.control$({
      action,
      operationId: this.createOperationId(action),
      pageSize: this.pageSize(),
    }).pipe(
      finalize(() => this.busyAction.set(null)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (result) => {
        this.resetConfirmation.set(false);
        this.pageSize.set(result.state.pageSize);
        this.pageSizeTouched.set(false);
        this.notifications.showSuccess(this.successMessage(result));
        this.refreshSubject.next(this.refreshSubject.value + 1);
      },
      error: (error) => {
        if (
          !this.cooldowns.captureResourceExhausted(
            error,
            COOLDOWN_SCOPE.action,
            5_000
          ) &&
          !this.cooldowns.wasHandled(error)
        ) {
          this.notifications.showError(
            'Não foi possível concluir a ação no backfill de ranking.'
          );
        } else if (!this.cooldowns.wasHandled(error)) {
          this.notifications.showError(
            'Não foi possível concluir a ação no backfill de ranking.'
          );
        }
      },
    });
  }

  private successMessage(
    result: IAdminPhotoRankingBackfillControlResult
  ): string {
    if (result.alreadyApplied) {
      return 'Esta operação já havia sido aplicada anteriormente.';
    }

    switch (result.action) {
      case 'START_OR_RESUME':
        return 'Migração retomada. O scheduler continuará pelos próximos lotes.';
      case 'PAUSE':
        return 'Pausa registrada. O lote ativo terminará antes da interrupção.';
      case 'RESET':
        return 'Nova geração criada. A migração recomeçará do primeiro documento.';
      case 'RUN_PAGE': {
        if (!result.batch?.acquired) {
          return 'Já existe um lote ativo. Nenhum processamento paralelo foi iniciado.';
        }

        const summary = `Lote concluído: ${result.batch.processed} foto(s) examinada(s), ${result.batch.updated} atualizada(s) e ${result.batch.skipped} ignorada(s).`;

        return result.state.status === 'PAUSED'
          ? `${summary} A migração permanece pausada.`
          : summary;
      }
    }
  }

  private createOperationId(action: AdminPhotoRankingBackfillAction): string {
    const randomId = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return `photo_rank_${action.toLowerCase()}_${randomId}`
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 128);
  }
}
