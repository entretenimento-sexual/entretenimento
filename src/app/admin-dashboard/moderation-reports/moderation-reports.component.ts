// src/app/admin-dashboard/moderation-reports/moderation-reports.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';

import { AdminMaterialModule } from '../admin-material.module';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  AdminModerationReportService,
  AdminModerationReportVm,
  ModerationReportReviewPatch,
} from 'src/app/core/services/moderation/admin-moderation-report.service';
import {
  ModerationReportReason,
  ModerationReportStatus,
  ModerationReportTargetType,
} from 'src/app/core/interfaces/moderation/moderation-report.interface';

type AdminReportFilter = ModerationReportStatus | 'all';

interface AdminModerationReportsVm {
  reports: AdminModerationReportVm[];
  filteredReports: AdminModerationReportVm[];
  total: number;
  open: number;
  reviewing: number;
  resolved: number;
  rejected: number;
  loading: boolean;
  error: boolean;
}

@Component({
  selector: 'app-moderation-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminMaterialModule],
  templateUrl: './moderation-reports.component.html',
  styleUrls: ['./moderation-reports.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModerationReportsComponent {
  private readonly reportsService = inject(AdminModerationReportService);
  private readonly notification = inject(ErrorNotificationService);

  readonly selectedFilter = signal<AdminReportFilter>('open');
  readonly busyReportId = signal<string | null>(null);

  private readonly loadingReports$: Observable<AdminModerationReportVm[]> =
    this.reportsService.listReports$().pipe(
      catchError(() => {
        this.notification.showError('Não foi possível carregar denúncias.');
        return of([] as AdminModerationReportVm[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly vm$: Observable<AdminModerationReportsVm> = combineLatest([
    this.loadingReports$,
  ]).pipe(
    map(([reports]) => this.buildVm(reports)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setFilter(filter: AdminReportFilter): void {
    this.selectedFilter.set(filter);
  }

  markReviewing(report: AdminModerationReportVm): void {
    this.reviewReport(report, {
      status: 'reviewing',
      resolution: 'Denúncia colocada em análise pela moderação.',
    });
  }

  resolveReport(report: AdminModerationReportVm): void {
    this.reviewReport(report, {
      status: 'resolved',
      resolution: 'Denúncia revisada e marcada como resolvida.',
    });
  }

  rejectReport(report: AdminModerationReportVm): void {
    this.reviewReport(report, {
      status: 'rejected',
      resolution: 'Denúncia revisada e rejeitada pela moderação.',
    });
  }

  trackByReportId(_: number, report: AdminModerationReportVm): string {
    return report.id;
  }

  statusLabel(status: ModerationReportStatus): string {
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
        return 'Status desconhecido';
    }
  }

  reasonLabel(reason: ModerationReportReason): string {
    switch (reason) {
      case 'spam':
        return 'Spam ou golpe';
      case 'fake_profile':
        return 'Perfil falso';
      case 'harassment':
        return 'Assédio ou ameaça';
      case 'hate_or_abuse':
        return 'Ódio ou abuso';
      case 'sexual_boundary':
        return 'Limite sexual violado';
      case 'illegal_content':
        return 'Conteúdo ilegal';
      case 'privacy':
        return 'Privacidade';
      case 'minor_safety':
        return 'Segurança de menores';
      case 'other':
      default:
        return 'Outro motivo';
    }
  }

  targetTypeLabel(type: ModerationReportTargetType): string {
    switch (type) {
      case 'profile':
        return 'Perfil';
      case 'photo':
        return 'Foto';
      case 'message':
        return 'Mensagem';
      case 'room':
        return 'Sala';
      case 'status':
        return 'Status';
      case 'venue':
        return 'Local';
      case 'other':
      default:
        return 'Conteúdo';
    }
  }

  dateValue(value: unknown): Date | null {
    if (!value) return null;

    if (value instanceof Date) return value;

    const withToDate = value as { toDate?: () => Date };
    if (typeof withToDate.toDate === 'function') {
      return withToDate.toDate();
    }

    const withSeconds = value as { seconds?: number };
    if (typeof withSeconds.seconds === 'number') {
      return new Date(withSeconds.seconds * 1000);
    }

    return null;
  }

  isBusy(report: AdminModerationReportVm): boolean {
    return this.busyReportId() === report.id;
  }

  private buildVm(reports: AdminModerationReportVm[]): AdminModerationReportsVm {
    const safeReports = [...reports];
    const selected = this.selectedFilter();

    const filteredReports = selected === 'all'
      ? safeReports
      : safeReports.filter((report) => report.status === selected);

    return {
      reports: safeReports,
      filteredReports,
      total: safeReports.length,
      open: safeReports.filter((report) => report.status === 'open').length,
      reviewing: safeReports.filter((report) => report.status === 'reviewing').length,
      resolved: safeReports.filter((report) => report.status === 'resolved').length,
      rejected: safeReports.filter((report) => report.status === 'rejected').length,
      loading: false,
      error: false,
    };
  }

  private reviewReport(
    report: AdminModerationReportVm,
    patch: ModerationReportReviewPatch
  ): void {
    if (!report.id || this.isBusy(report)) {
      return;
    }

    this.busyReportId.set(report.id);

    this.reportsService.reviewReport$(report.id, patch).subscribe({
      next: () => {
        this.notification.showSuccess('Denúncia atualizada.');
      },
      error: () => {
        this.notification.showError('Não foi possível atualizar a denúncia.');
      },
      complete: () => {
        this.busyReportId.set(null);
      },
    });
  }
}
