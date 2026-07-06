// src/app/admin-dashboard/operational-overview/operational-overview.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, shareReplay, startWith } from 'rxjs/operators';

import { AdminMaterialModule } from '../admin-material.module';
import { isAgedOpenModerationReport, moderationReportDateValue } from '../moderation-reports/moderation-report-age.util';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserManagementService } from 'src/app/core/services/account-moderation/user-management.service';
import {
  AdminModerationReportService,
  AdminModerationReportVm,
} from 'src/app/core/services/moderation/admin-moderation-report.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

type OperationalSeverity = 'danger' | 'warning' | 'info' | 'success';

interface LoadState<T> {
  value: T;
  loading: boolean;
  failed: boolean;
}

interface OperationalMetric {
  label: string;
  value: number;
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
  count: number;
  severity: OperationalSeverity;
  icon: string;
  routerLink: string;
}

interface RecentOperationalUser {
  uid: string;
  label: string;
  subtitle: string;
  timestamp: number;
}

interface OperationalOverviewVm {
  metrics: OperationalMetric[];
  alerts: OperationalAlert[];
  quickActions: OperationalQuickAction[];
  recentReports: AdminModerationReportVm[];
  recentUsers: RecentOperationalUser[];
  loading: boolean;
  failed: boolean;
  totalUsers: number;
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
  private readonly userManagement = inject(UserManagementService);
  private readonly reportsService = inject(AdminModerationReportService);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly usersState$: Observable<LoadState<IUserDados[]>> = this.userManagement.getAllUsers().pipe(
    map((users) => this.loadedState(users)),
    catchError((error) => this.handleLoadError<IUserDados[]>(
      error,
      'Não foi possível carregar os usuários do painel operacional.',
      []
    )),
    startWith(this.loadingState<IUserDados[]>([])),
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
  ]).pipe(
    map(([usersState, reportsState]) => this.buildVm(usersState, reportsState)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  trackByMetricLabel(_: number, metric: OperationalMetric): string {
    return metric.label;
  }

  trackByAlertTitle(_: number, alert: OperationalAlert): string {
    return alert.title;
  }

  trackByQuickActionTitle(_: number, action: OperationalQuickAction): string {
    return action.title;
  }

  trackByReportId(_: number, report: AdminModerationReportVm): string {
    return report.id;
  }

  trackByUserUid(_: number, user: RecentOperationalUser): string {
    return user.uid;
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
    usersState: LoadState<IUserDados[]>,
    reportsState: LoadState<AdminModerationReportVm[]>
  ): OperationalOverviewVm {
    const users = usersState.value;
    const reports = reportsState.value;

    const totalUsers = users.length;
    const completedProfiles = users.filter((user) => user.profileCompleted === true).length;
    const incompleteProfiles = users.filter((user) => user.profileCompleted !== true).length;
    const suspendedUsers = users.filter((user) => this.isSuspendedUser(user)).length;
    const onlineUsers = users.filter((user) => user.isOnline === true).length;
    const subscribers = users.filter((user) => this.isActiveSubscriber(user)).length;

    const openReports = reports.filter((report) => report.status === 'open');
    const agedOpenReports = openReports.filter((report) => isAgedOpenModerationReport(report));
    const reviewingReports = reports.filter((report) => report.status === 'reviewing');

    return {
      metrics: [
        {
          label: 'Usuários',
          value: totalUsers,
          hint: `${completedProfiles} com perfil completo`,
          icon: 'groups',
          severity: 'info',
        },
        {
          label: 'Cadastros pendentes',
          value: incompleteProfiles,
          hint: 'Precisam finalizar o perfil',
          icon: 'assignment_late',
          severity: incompleteProfiles > 0 ? 'warning' : 'success',
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
          label: 'Online agora',
          value: onlineUsers,
          hint: 'Sinal de presença ativo',
          icon: 'radio_button_checked',
          severity: 'success',
        },
        {
          label: 'Assinantes',
          value: subscribers,
          hint: 'Premium, VIP ou assinatura ativa',
          icon: 'workspace_premium',
          severity: 'info',
        },
      ],
      alerts: this.buildAlerts({
        failed: usersState.failed || reportsState.failed,
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
      recentReports: this.sortReportsByCreatedAt(openReports.length ? openReports : reports).slice(0, 5),
      recentUsers: this.recentUsers(users),
      loading: usersState.loading || reportsState.loading,
      failed: usersState.failed || reportsState.failed,
      totalUsers,
      totalReports: reports.length,
    };
  }

  private buildAlerts(input: {
    failed: boolean;
    agedOpenReports: number;
    openReports: number;
    incompleteProfiles: number;
    suspendedUsers: number;
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

    if (input.incompleteProfiles > 0) {
      alerts.push({
        title: 'Cadastros incompletos',
        description: `${input.incompleteProfiles} usuário(s) ainda não concluíram o perfil.`,
        severity: 'info',
        icon: 'person_add_disabled',
        routerLink: '/admin-dashboard/users',
      });
    }

    if (input.suspendedUsers > 0) {
      alerts.push({
        title: 'Contas com restrição',
        description: `${input.suspendedUsers} conta(s) possuem suspensão, bloqueio ou restrição operacional.`,
        severity: 'warning',
        icon: 'block',
        routerLink: '/admin-dashboard/users',
      });
    }

    if (!alerts.length) {
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
    incompleteProfiles: number;
    suspendedUsers: number;
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
        severity: input.incompleteProfiles > 0 ? 'warning' : 'success',
        icon: 'person_search',
        routerLink: '/admin-dashboard/users',
      },
      {
        title: 'Revisar restrições',
        description: 'Acompanhe contas suspensas, bloqueadas ou com restrição de interação.',
        cta: 'Ver contas',
        count: input.suspendedUsers,
        severity: input.suspendedUsers > 0 ? 'warning' : 'success',
        icon: 'shield',
        routerLink: '/admin-dashboard/users',
      },
    ];
  }

  private isSuspendedUser(user: IUserDados): boolean {
    return user.suspended === true
      || user.accountLocked === true
      || user.interactionBlocked === true
      || ['self_suspended', 'moderation_suspended', 'pending_deletion'].includes(String(user.accountStatus ?? ''));
  }

  private isActiveSubscriber(user: IUserDados): boolean {
    return user.isSubscriber === true
      || user.subscriptionStatus === 'active'
      || ['premium', 'vip'].includes(String(user.role ?? ''));
  }

  private sortReportsByCreatedAt(reports: AdminModerationReportVm[]): AdminModerationReportVm[] {
    return [...reports].sort((a, b) => this.reportTime(b) - this.reportTime(a));
  }

  private reportTime(report: AdminModerationReportVm): number {
    return moderationReportDateValue(report.createdAt)?.getTime() ?? 0;
  }

  private recentUsers(users: IUserDados[]): RecentOperationalUser[] {
    return [...users]
      .map((user) => ({
        uid: String(user.uid ?? '').trim(),
        label: String(user.nickname || user.nome || user.email || 'Usuário sem identificação'),
        subtitle: user.profileCompleted === true ? 'Perfil completo' : 'Perfil pendente',
        timestamp: this.userTime(user),
      }))
      .filter((user) => !!user.uid)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }

  private userTime(user: IUserDados): number {
    return Number(user.createdAt ?? user.registrationDate ?? user.firstLogin ?? user.lastLogin ?? 0) || 0;
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
      const normalized = error instanceof Error
        ? error
        : new Error('Falha ao carregar visão operacional.');

      (normalized as any).feature = 'admin_operational_overview';
      this.globalError.handleError(normalized);
    } catch {
      // Não interrompe a UI de operação por falha de logging.
    }
  }
}
