// src/app/admin-dashboard/account-deletion-operations/account-deletion-operations.component.ts
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import {
  catchError,
  map,
  shareReplay,
  startWith,
  switchMap,
  tap,
} from 'rxjs/operators';

import { AdminMaterialModule } from '../admin-material.module';
import {
  AccountDeletionOperationFilter,
  AccountDeletionOperationItem,
  AccountDeletionOperationsCursor,
  AccountDeletionOperationsQueryState,
  AccountDeletionOperationsResponse,
} from './account-deletion-operations.model';
import { AccountDeletionOperationsRepository } from './account-deletion-operations.repository';

interface AccountDeletionOperationsLoadState {
  response: AccountDeletionOperationsResponse | null;
  loading: boolean;
  failed: boolean;
  page: number;
  filter: AccountDeletionOperationFilter;
}

interface AccountDeletionOperationFilterOption {
  value: AccountDeletionOperationFilter;
  label: string;
  count: number;
}

interface AccountDeletionOperationsMetricVm {
  label: string;
  value: number;
  hint: string;
  tone: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
}

interface AccountDeletionOperationsVm
extends AccountDeletionOperationsLoadState
{
  items: AccountDeletionOperationItem[];
  metrics: AccountDeletionOperationsMetricVm[];
  filters: AccountDeletionOperationFilterOption[];
  hasPrevious: boolean;
  hasNext: boolean;
  generatedAt: number | null;
}

const PAGE_SIZE = 20;

@Component({
  selector: 'app-account-deletion-operations',
  standalone: true,
  imports: [CommonModule, AdminMaterialModule],
  templateUrl: './account-deletion-operations.component.html',
  styleUrls: ['./account-deletion-operations.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountDeletionOperationsComponent {
  private readonly repository = inject(AccountDeletionOperationsRepository);
  private readonly querySubject =
    new BehaviorSubject<AccountDeletionOperationsQueryState>({
      filter: 'attention',
      limit: PAGE_SIZE,
      cursor: null,
      page: 1,
      refreshToken: 0,
    });
  private cursorHistory: Array<AccountDeletionOperationsCursor | null> = [null];
  private latestResponse: AccountDeletionOperationsResponse | null = null;

  private readonly state$: Observable<AccountDeletionOperationsLoadState> =
    this.querySubject.pipe(
      switchMap((query) =>
        this.repository
          .listOperations$({
            filter: query.filter,
            limit: query.limit,
            cursor: query.cursor,
          })
          .pipe(
            tap((response) => {
              this.latestResponse = response;
            }),
            map((response) => ({
              response,
              loading: false,
              failed: false,
              page: query.page,
              filter: query.filter,
            })),
            catchError(() =>
              of({
                response: this.latestResponse,
                loading: false,
                failed: true,
                page: query.page,
                filter: query.filter,
              })
            ),
            startWith({
              response: this.latestResponse,
              loading: true,
              failed: false,
              page: query.page,
              filter: query.filter,
            })
          )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly vm$: Observable<AccountDeletionOperationsVm> = this.state$.pipe(
    map((state) => this.buildVm(state)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setFilter(filter: AccountDeletionOperationFilter): void {
    const current = this.querySubject.value;
    if (current.filter === filter && current.page === 1) return;

    this.cursorHistory = [null];
    this.latestResponse = null;
    this.querySubject.next({
      filter,
      limit: PAGE_SIZE,
      cursor: null,
      page: 1,
      refreshToken: current.refreshToken + 1,
    });
  }

  refresh(): void {
    const current = this.querySubject.value;
    this.cursorHistory = [null];
    this.latestResponse = null;
    this.querySubject.next({
      ...current,
      cursor: null,
      page: 1,
      refreshToken: current.refreshToken + 1,
    });
  }

  nextPage(): void {
    const current = this.querySubject.value;
    const cursor = this.latestResponse?.nextCursor ?? null;

    if (!this.latestResponse?.hasMore || !cursor) return;

    this.cursorHistory = [
      ...this.cursorHistory.slice(0, current.page),
      cursor,
    ];
    this.querySubject.next({
      ...current,
      cursor,
      page: current.page + 1,
      refreshToken: current.refreshToken + 1,
    });
  }

  previousPage(): void {
    const current = this.querySubject.value;
    if (current.page <= 1) return;

    const targetPage = current.page - 1;
    const cursor = this.cursorHistory[targetPage - 1] ?? null;
    this.querySubject.next({
      ...current,
      cursor,
      page: targetPage,
      refreshToken: current.refreshToken + 1,
    });
  }

  trackByReference(
    _index: number,
    item: AccountDeletionOperationItem
  ): string {
    return item.reference;
  }

  statusLabel(status: AccountDeletionOperationItem['status']): string {
    switch (status) {
      case 'in_progress':
        return 'Em processamento';
      case 'blocked':
        return 'Bloqueada';
      case 'retry_scheduled':
        return 'Nova tentativa';
      case 'completed':
        return 'Concluída';
      default:
        return 'Pendente';
    }
  }

  phaseLabel(phase: string): string {
    const labels: Record<string, string> = {
      claimed: 'Reivindicada',
      auth_deletion: 'Removendo credencial',
      data_cleanup: 'Limpando dados',
      finalization: 'Finalizando',
      blocked: 'Aguardando dependência',
      retry_scheduled: 'Retry agendado',
      completed: 'Concluída',
      pending: 'Pendente',
    };
    return labels[phase] ?? this.humanizeToken(phase);
  }

  sourceLabel(source: AccountDeletionOperationItem['source']): string {
    switch (source) {
      case 'self':
        return 'Solicitada pelo usuário';
      case 'moderator':
        return 'Aplicada pela moderação';
      case 'system':
        return 'Iniciada pelo sistema';
      default:
        return 'Origem não informada';
    }
  }

  domainLabel(domain: string): string {
    const labels: Record<string, string> = {
      public_profile: 'Perfil público',
      nickname_index: 'Índice de apelido',
      auth_identity: 'Credencial',
      notifications: 'Notificações',
      preferences: 'Preferências',
      presence_and_location: 'Presença e localização',
      relationship_edges: 'Relacionamentos e bloqueios',
      friend_requests: 'Solicitações de amizade',
      community_memberships: 'Comunidades',
      room_participation: 'Salas',
      owned_media_and_storage: 'Mídias e Storage',
      shared_messages: 'Mensagens compartilhadas',
      shared_publications: 'Publicações compartilhadas',
      moderation_reports_and_evidence: 'Denúncias e evidências',
      financial_records_and_entitlements: 'Financeiro e benefícios',
      private_user_document: 'Documento privado',
      lifecycle_and_security_audit: 'Auditoria do lifecycle',
    };
    return labels[domain] ?? this.humanizeToken(domain);
  }

  technicalStatusLabel(value: string): string {
    const labels: Record<string, string> = {
      success: 'Concluído',
      pending: 'Pendente',
      failed: 'Falhou',
      blocked: 'Bloqueado',
      ready: 'Pronto',
      unknown: 'Não informado',
    };
    return labels[value] ?? this.humanizeToken(value);
  }

  durationLabel(value: number | null): string {
    if (!value || value <= 0) return 'Não informado';
    const hours = Math.round(value / 3_600_000);
    if (hours < 1) return 'Menos de 1 hora';
    if (hours === 1) return '1 hora';
    return `${hours} horas`;
  }

  private buildVm(
    state: AccountDeletionOperationsLoadState
  ): AccountDeletionOperationsVm {
    const response = state.response;
    const metrics = response?.metrics ?? {
      total: 0,
      attention: 0,
      inProgress: 0,
      blocked: 0,
      retryScheduled: 0,
      completed: 0,
    };

    return {
      ...state,
      items: response?.items ?? [],
      metrics: [
        {
          label: 'Precisam de atenção',
          value: metrics.attention,
          hint: 'Bloqueadas ou aguardando retry',
          tone: metrics.attention > 0 ? 'danger' : 'success',
        },
        {
          label: 'Em processamento',
          value: metrics.inProgress,
          hint: 'Lease ativa ou fase em execução',
          tone: metrics.inProgress > 0 ? 'info' : 'neutral',
        },
        {
          label: 'Bloqueadas',
          value: metrics.blocked,
          hint: 'Dependência ainda não concluída',
          tone: metrics.blocked > 0 ? 'warning' : 'success',
        },
        {
          label: 'Retries',
          value: metrics.retryScheduled,
          hint: 'Nova tentativa já programada',
          tone: metrics.retryScheduled > 0 ? 'warning' : 'success',
        },
        {
          label: 'Concluídas',
          value: metrics.completed,
          hint: `${metrics.total} operação(ões) registradas`,
          tone: 'success',
        },
      ],
      filters: [
        {
          value: 'attention',
          label: 'Atenção',
          count: metrics.attention,
        },
        {
          value: 'in_progress',
          label: 'Em processamento',
          count: metrics.inProgress,
        },
        { value: 'blocked', label: 'Bloqueadas', count: metrics.blocked },
        {
          value: 'retry_scheduled',
          label: 'Retries',
          count: metrics.retryScheduled,
        },
        {
          value: 'completed',
          label: 'Concluídas',
          count: metrics.completed,
        },
        { value: 'all', label: 'Todas', count: metrics.total },
      ],
      hasPrevious: state.page > 1,
      hasNext: response?.hasMore === true && response.nextCursor !== null,
      generatedAt: response?.generatedAt ?? null,
    };
  }

  private humanizeToken(value: string): string {
    const normalized = String(value ?? '')
      .trim()
      .replace(/[_-]+/g, ' ');
    return normalized
      ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
      : 'Não informado';
  }
}
