// src/app/admin-dashboard/operational-overview/operational-overview.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import { catchError, finalize, map, shareReplay, startWith } from 'rxjs/operators';

import { AdminMaterialModule } from '../admin-material.module';
import { isAgedOpenModerationReport, moderationReportDateValue } from '../moderation-reports/moderation-report-age.util';
import { type AdminUserOverview } from 'src/app/core/services/account-moderation/admin-user-overview.model';
import { AdminUserOverviewService } from 'src/app/core/services/account-moderation/admin-user-overview.service';
import {
  AdminModerationReportService,
  AdminModerationReportVm,
} from 'src/app/core/services/moderation/admin-moderation-report.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';

 type OperationalSeverity = 'danger' | 'warning' | 'info' | 'success';
 type OperationalReportFilter = 'priority' | 'open' | 'reviewing' | 'all';
 type OperationalReportSort = 'priority' | 'newest' | 'oldest';
 type OperationalReportActionStatus = 'reviewing' | 'resolved' | 'rejected';

interface LoadState<T> {
  value: T;
  loading: boolean;
  failed: boolean;
}

interface OperationalMetric {
  label: string;
  value: number | null;
  hint: string;
  icon: string;
  severity: OperationalSeverity;
}

interface OperationalAlert {
  title: string;
  description: string;
  severity: OperationalSeverity;
  icon: string;
  routerLink?: string;
}

interface OperationalQuickAction {
  title: string;
  description: string;
  cta: string;
  count: number | null;
  severity: OperationalSeverity;
  icon: string;
  routerLink: string;
}

interface OperationalReportFilterOption {
  value: OperationalReportFilter;
  label: string;
  count: number;
}

interface OperationalReportSortOption {
  value: OperationalReportSort;
  label: string;
}

interface OperationalReportItem extends AdminModerationReportVm {
  actionPending: boolean;
  targetUserUid: string;
  canReview: boolean;
  canResolve: boolean;
  canReject: boolean;
}

interface OperationalOverviewVm {
  metrics: OperationalMetric[];
  alerts: OperationalAlert[];
  quickActions: OperationalQuickAction[];
  reportFilter: OperationalReportFilter;
  reportSort: OperationalReportSort;
  reportFilterOptions: OperationalReportFilterOption[];
  reportSortOptions: OperationalReportSortOption[];
  filteredReports: OperationalReportItem[];
  recentReports: AdminModerationReportVm[];
  loading: boolean;
  failed: boolean;
  totalUsers: number | null;
  totalReports: number;
}

@Component({
  selector: 'app-operational-overview',
  standalone: true,
  imports: [CommonModule, RouterModule, AdminMaterialModule],
  templateUrl: './operational-overview.component.html',
  styleUrls: ['./operational-overview.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperationalOverviewComponent {
  private readonly adminUserOverview = inject(AdminUserOverviewService);
  private readonly reportsService = inject(AdminModerationReportService);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly reportFilterSubject = new BehaviorSubject<OperationalReportFilter>('priority');
  private readonly reportSortSubject = new BehaviorSubject<OperationalReportSort>('priority');
  private readonly reportActionIdsSubject = new BehaviorSubject<ReadonlySet<string>>(new Set<string>());

  private readonly usersState$: Observable<
    LoadState<AdminUserOverview | null>
  > = this.adminUserOverview.getAdminUserOverview$().pipe(
    map(value => this.loadedState<AdminUserOverview | null>(value)),
    catchError(() => {
      this.notifications.showError(
        'Nao foi possivel carregar indicadores administrativos.'
      );

      return of({
        value: null,
        loading: false,
        failed: true,
      } as LoadState<AdminUserOverview | null>);
    }),
    startWith(this.loadingState<AdminUserOverview | null>(null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly reportsState$: Observable<LoadState<AdminModerationReportVm[]>> = this.reportsService.listReports$().pipe(
    map((reports) => this.loadedState(reports)),
    catchError((error) => this.handleLoadError<AdminModerationReportVm[]>(
      error,
      'Não foi possível carregar as denúncias do painel operacional.',
      []
    )),
    startWith(this.loadingState<AdminModerationReportVm[]>([])),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$: Observable<OperationalOverviewVm> = combineLatest([
    this.usersState$,
    this.reportsState$,
    this.reportFilterSubject,
    this.reportSortSubject,
    this.reportActionIdsSubject,
  ]).pipe(
    map(([usersState, reportsState, reportFilter, reportSort, reportActionIds]) => this.buildVm(
      usersState,
      reportsState,
      reportFilter,
      reportSort,
      reportActionIds
    )),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setReportFilter(filter: OperationalReportFilter): void {
    this.reportFilterSubject.next(filter);
  }

  setReportSort(sort: OperationalReportSort): void {
    this.reportSortSubject.next(sort);
  }

  markReportReviewing(report: AdminModerationReportVm): void {
    this.reviewReport(
      report,
      'reviewing',
      'Denúncia colocada em análise.',
      'Não foi possível colocar a denúncia em análise.'
    );
  }

  resolveReport(report: AdminModerationReportVm): void {
    this.reviewReport(
      report,
      'resolved',
      'Denúncia resolvida.',
      'Não foi possível resolver a denúncia.'
    );
  }

  rejectReport(report: AdminModerationReportVm): void {
    this.reviewReport(
      report,
      'rejected',
      'Denúncia rejeitada.',
      'Não foi possível rejeitar a denúncia.'
    );
  }

  trackByMetricLabel(_: number, metric: OperationalMetric): string {
    return metric.label;
  }

  trackByAlertTitle(_: number, alert: OperationalAlert): string {
    return alert.title;
  }

  trackByQuickActionTitle(_: number, action: OperationalQuickAction): string {
    return action.title;
  }

  trackByReportFilterValue(_: number, option: OperationalReportFilterOption): string {
    return option.value;
  }

  trackByReportSortValue(_: number, option: OperationalReportSortOption): string {
    return option.value;
  }

  trackByReportId(_: number, report: AdminModerationReportVm): string {
    return report.id;
  }

  statusLabel(status: AdminModerationReportVm['status']): string {
    switch (status) {
      case 'open':
        return 'Aberta';
      case 'reviewing':
        return 'Em análise';
      case 'resolved':
        return 'Resolvida';
      case 'rejected':
        return 'Rejeitada';
      default:
        return 'Não informado';
    }
  }

  dateValue(value: unknown): Date | null {
    return moderationReportDateValue(value);
  }

  private buildVm(
    usersState: LoadState<AdminUserOverview | null>,
    reportsState: LoadState<AdminModerationReportVm[]>,
    reportFilter: OperationalReportFilter,
    reportSort: OperationalReportSort,
    reportActionIds: ReadonlySet<string>
  ): OperationalOverviewVm {
    const overview = usersState.value;
    const reports = reportsState.value;

    const totalUsers = overview?.totalUsers ?? null;
    const completedProfiles = overview?.completedProfiles ?? null;
    const incompleteProfiles = overview?.incompleteProfiles ?? null;
    const suspendedUsers = overview?.restrictedUsers ?? null;
    const onlineUsers = overview?.onlineUsers ?? null;
    const subscribers = overview?.subscribers ?? null;

    const unavailable = usersState.loading
      ? 'Carregando indicador'
      : 'Indicador indisponivel';

    const openReports = reports.filter((report) => report.status === 'open');
    const agedOpenReports = openReports.filter((report) => isAgedOpenModerationReport(report));
    const reviewingReports = reports.filter((report) => report.status === 'reviewing');
    const filteredReports = this.sortReports(
      this.applyReportFilter(reports, reportFilter),
      reportSort
    )
      .slice(0, 8)
      .map((report) => this.withReportActionState(report, reportActionIds));

    return {
      metrics: [
        {
          label: 'Usuários',
          value: totalUsers,
          hint: overview ? `${completedProfiles} com perfil completo` : unavailable,
          icon: 'groups',
          severity: 'info',
        },
        {
          label: 'Cadastros pendentes',
          value: incompleteProfiles,
          hint: overview ? 'Precisam finalizar o perfil' : unavailable,
          icon: 'assignment_late',
          severity: incompleteProfiles === null ? 'info' : incompleteProfiles > 0 ? 'warning' : 'success',
        },
        {
          label: 'Denúncias abertas',
          value: openReports.length,
          hint: `${agedOpenReports.length} com prioridade 48h+`,
          icon: 'report',
          severity: agedOpenReports.length > 0 ? 'danger' : openReports.length > 0 ? 'warning' : 'success',
        },
        {
          label: 'Em análise',
          value: reviewingReports.length,
          hint: 'Fila ativa da moderação',
          icon: 'manage_search',
          severity: reviewingReports.length > 0 ? 'info' : 'success',
        },
        {
          label: 'Sinal online',
          value: onlineUsers,
          hint: overview
            ? 'Sinal persistido, nao presenca em tempo real'
            : unavailable,
          icon: 'radio_button_checked',
          severity: 'info',
        },
        {
          label: 'Assinantes (provisorio)',
          value: subscribers,
          hint: overview
            ? 'Aguardando validacao do entitlement canonico'
            : unavailable,
          icon: 'workspace_premium',
          severity: 'info',
        },
      ],
      alerts: this.buildAlerts({
        failed: usersState.failed || reportsState.failed,
        ready:
          !usersState.loading &&
          !reportsState.loading &&
          !usersState.failed &&
          !reportsState.failed &&
          overview !== null,
        agedOpenReports: agedOpenReports.length,
        openReports: openReports.length,
        incompleteProfiles,
        suspendedUsers,
      }),
      quickActions: this.buildQuickActions({
        agedOpenReports: agedOpenReports.length,
        openReports: openReports.length,
        reviewingReports: reviewingReports.length,
        incompleteProfiles,
        suspendedUsers,
      }),
      reportFilter,
      reportSort,
      reportFilterOptions: this.buildReportFilterOptions({
        agedOpenReports: agedOpenReports.length,
        openReports: openReports.length,
        reviewingReports: reviewingReports.length,
        totalReports: reports.length,
      }),
      reportSortOptions: this.buildReportSortOptions(),
      filteredReports,
      recentReports: this.sortReportsByCreatedAt(openReports.length ? openReports : reports).slice(0, 5),
      loading: usersState.loading || reportsState.loading,
      failed: usersState.failed || reportsState.failed,
      totalUsers,
      totalReports: reports.length,
    };
  }

  private buildAlerts(input: {
    failed: boolean;
    ready: boolean;
    agedOpenReports: number;
    openReports: number;
    incompleteProfiles: number | null;
    suspendedUsers: number | null;
  }): OperationalAlert[] {
    const alerts: OperationalAlert[] = [];

    if (input.failed) {
      alerts.push({
        title: 'Leitura parcial do painel',
        description: 'Algum recurso operacional não carregou. O erro foi enviado ao handler global.',
        severity: 'danger',
        icon: 'sync_problem',
      });
    }

    if (input.agedOpenReports > 0) {
      alerts.push({
        title: 'Denúncias críticas em aberto',
        description: `${input.agedOpenReports} denúncia(s) estão abertas há mais de 48h.`,
        severity: 'danger',
        icon: 'priority_high',
        routerLink: '/admin-dashboard/denuncias',
      });
    } else if (input.openReports > 0) {
      alerts.push({
        title: 'Denúncias aguardando triagem',
        description: `${input.openReports} denúncia(s) ainda precisam de primeira análise.`,
        severity: 'warning',
        icon: 'flag',
        routerLink: '/admin-dashboard/denuncias',
      });
    }

    if ((input.incompleteProfiles ?? 0) > 0) {
      alerts.push({
        title: 'Cadastros incompletos',
        description: `${input.incompleteProfiles} usuário(s) ainda não concluíram o perfil.`,
        severity: 'info',
        icon: 'person_add_disabled',
        routerLink: '/admin-dashboard/users',
      });
    }

    if ((input.suspendedUsers ?? 0) > 0) {
      alerts.push({
        title: 'Contas com restrição',
        description: `${input.suspendedUsers} conta(s) possuem suspensão, bloqueio ou restrição operacional.`,
        severity: 'warning',
        icon: 'block',
        routerLink: '/admin-dashboard/users',
      });
    }

    if (!alerts.length && input.ready) {
      alerts.push({
        title: 'Operação estável',
        description: 'Nenhum bloqueio crítico foi identificado nos indicadores principais.',
        severity: 'success',
        icon: 'verified',
      });
    }

    return alerts;
  }

  private buildQuickActions(input: {
    agedOpenReports: number;
    openReports: number;
    reviewingReports: number;
    incompleteProfiles: number | null;
    suspendedUsers: number | null;
  }): OperationalQuickAction[] {
    const moderationCount = input.agedOpenReports || input.openReports;

    return [
      {
        title: input.agedOpenReports > 0 ? 'Priorizar denúncias 48h+' : 'Triar denúncias abertas',
        description: input.agedOpenReports > 0
          ? 'Comece pelas denúncias mais antigas para reduzir risco operacional.'
          : 'Abra a fila e dê a primeira classificação das denúncias pendentes.',
        cta: 'Abrir moderação',
        count: moderationCount,
        severity: input.agedOpenReports > 0 ? 'danger' : input.openReports > 0 ? 'warning' : 'success',
        icon: input.agedOpenReports > 0 ? 'priority_high' : 'flag',
        routerLink: '/admin-dashboard/denuncias',
      },
      {
        title: 'Acompanhar análises',
        description: 'Revise o que já está em análise e finalize decisões pendentes.',
        cta: 'Ver em análise',
        count: input.reviewingReports,
        severity: input.reviewingReports > 0 ? 'info' : 'success',
        icon: 'fact_check',
        routerLink: '/admin-dashboard/denuncias',
      },
      {
        title: 'Checar cadastros',
        description: 'Identifique usuários que ainda não concluíram o perfil.',
        cta: 'Abrir usuários',
        count: input.incompleteProfiles,
        severity: input.incompleteProfiles === null ? 'info' : input.incompleteProfiles > 0 ? 'warning' : 'success',
        icon: 'person_search',
        routerLink: '/admin-dashboard/users',
      },
      {
        title: 'Revisar restrições',
        description: 'Acompanhe contas suspensas, bloqueadas ou com restrição de interação.',
        cta: 'Ver contas',
        count: input.suspendedUsers,
        severity: input.suspendedUsers === null ? 'info' : input.suspendedUsers > 0 ? 'warning' : 'success',
        icon: 'shield',
        routerLink: '/admin-dashboard/users',
      },
    ];
  }

  private buildReportFilterOptions(input: {
    agedOpenReports: number;
    openReports: number;
    reviewingReports: number;
    totalReports: number;
  }): OperationalReportFilterOption[] {
    return [
      { value: 'priority', label: 'Prioridade 48h+', count: input.agedOpenReports },
      { value: 'open', label: 'Abertas', count: input.openReports },
      { value: 'reviewing', label: 'Em análise', count: input.reviewingReports },
      { value: 'all', label: 'Todas', count: input.totalReports },
    ];
  }

  private buildReportSortOptions(): OperationalReportSortOption[] {
    return [
      { value: 'priority', label: 'Prioridade' },
      { value: 'newest', label: 'Mais recentes' },
      { value: 'oldest', label: 'Mais antigas' },
    ];
  }

  private applyReportFilter(
    reports: AdminModerationReportVm[],
    filter: OperationalReportFilter
  ): AdminModerationReportVm[] {
    switch (filter) {
      case 'priority':
        return reports.filter((report) => report.status === 'open' && isAgedOpenModerationReport(report));
      case 'open':
        return reports.filter((report) => report.status === 'open');
      case 'reviewing':
        return reports.filter((report) => report.status === 'reviewing');
      case 'all':
      default:
        return reports;
    }
  }

  private sortReports(
    reports: AdminModerationReportVm[],
    sort: OperationalReportSort
  ): AdminModerationReportVm[] {
    const sorted = [...reports];

    switch (sort) {
      case 'oldest':
        return sorted.sort((a, b) => this.reportTime(a) - this.reportTime(b));
      case 'newest':
        return sorted.sort((a, b) => this.reportTime(b) - this.reportTime(a));
      case 'priority':
      default:
        return sorted.sort((a, b) => {
          const priorityDiff = this.reportPriority(b) - this.reportPriority(a);
          return priorityDiff || this.reportTime(b) - this.reportTime(a);
        });
    }
  }

  private withReportActionState(
    report: AdminModerationReportVm,
    reportActionIds: ReadonlySet<string>
  ): OperationalReportItem {
    const actionPending = reportActionIds.has(report.id);
    const targetUserUid = this.reportTargetUserUid(report);
    const canAct = !!targetUserUid && !actionPending;

    return {
      ...report,
      actionPending,
      targetUserUid,
      canReview: report.status === 'open' && canAct,
      canResolve: (report.status === 'open' || report.status === 'reviewing') && canAct,
      canReject: (report.status === 'open' || report.status === 'reviewing') && canAct,
    };
  }

  private reviewReport(
    report: AdminModerationReportVm,
    status: OperationalReportActionStatus,
    successMessage: string,
    errorMessage: string
  ): void {
    const reportId = String(report.id ?? '').trim();
    const targetUserUid = this.reportTargetUserUid(report);

    if (!reportId) {
      this.notifications.showWarning('Denúncia sem identificador válido. Abra a tela completa de moderação.');
      return;
    }

    if (!targetUserUid) {
      this.notifications.showWarning('Denúncia sem usuário alvo identificado. Abra a tela completa de moderação.');
      return;
    }

    if (this.reportActionIdsSubject.value.has(reportId)) {
      return;
    }

    this.setReportActionPending(reportId, true);

    this.reportsService.reviewReport$(reportId, {
      status,
      previousStatus: report.status,
      targetUserUid,
      reportReason: report.reason ?? null,
      reportTargetType: report.targetType ?? null,
      resolution: this.reportResolution(status),
    }).pipe(
      finalize(() => this.setReportActionPending(reportId, false))
    ).subscribe({
      next: () => this.notifications.showSuccess(successMessage),
      error: (error) => this.notifications.showError(
        errorMessage,
        error instanceof Error ? error.message : undefined
      ),
    });
  }

  private reportTargetUserUid(report: AdminModerationReportVm): string {
    const ownerUid = String(report.targetOwnerUid ?? '').trim();

    if (ownerUid) {
      return ownerUid;
    }

    if (report.targetType === 'profile') {
      return String(report.targetId ?? '').trim();
    }

    return '';
  }

  private reportResolution(status: OperationalReportActionStatus): string | null {
    switch (status) {
      case 'reviewing':
        return null;
      case 'resolved':
        return 'Resolvida pelo painel operacional.';
      case 'rejected':
        return 'Rejeitada pelo painel operacional.';
    }
  }

  private setReportActionPending(reportId: string, pending: boolean): void {
    const safeReportId = String(reportId ?? '').trim();

    if (!safeReportId) {
      return;
    }

    const next = new Set(this.reportActionIdsSubject.value);

    if (pending) {
      next.add(safeReportId);
    } else {
      next.delete(safeReportId);
    }

    this.reportActionIdsSubject.next(next);
  }

  private reportPriority(report: AdminModerationReportVm): number {
    if (report.status === 'open' && isAgedOpenModerationReport(report)) {
      return 4;
    }

    if (report.status === 'open') {
      return 3;
    }

    if (report.status === 'reviewing') {
      return 2;
    }

    if (report.status === 'resolved') {
      return 1;
    }

    return 0;
  }

  private sortReportsByCreatedAt(reports: AdminModerationReportVm[]): AdminModerationReportVm[] {
    return [...reports].sort((a, b) => this.reportTime(b) - this.reportTime(a));
  }

  private reportTime(report: AdminModerationReportVm): number {
    return moderationReportDateValue(report.createdAt)?.getTime() ?? 0;
  }

  private loadedState<T>(value: T): LoadState<T> {
    return { value, loading: false, failed: false };
  }

  private loadingState<T>(value: T): LoadState<T> {
    return { value, loading: true, failed: false };
  }

  private handleLoadError<T>(error: unknown, userMessage: string, fallback: T): Observable<LoadState<T>> {
    this.notifications.showError(userMessage);
    this.reportError(error);
    return of({ value: fallback, loading: false, failed: true });
  }

  private reportError(error: unknown): void {
    try {
      this.applicationError.report(error, {
        feature: 'admin-operational-overview',
        operation: 'loadOverview',
        fallbackMessage: 'Falha ao carregar visão operacional.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: { scope: 'OperationalOverviewComponent' },
      });
    } catch {
      // Não interrompe a UI de operação por falha de diagnóstico.
    }
  }
}
