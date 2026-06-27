// src/app/admin-dashboard/moderation-reports/moderation-reports.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, finalize, map, shareReplay } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';

import { AdminMaterialModule } from '../admin-material.module';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AdminLogService, IAdminLogRecord } from 'src/app/core/services/account-moderation/admin-log.service';
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
type ResolutionDrafts = Record<string, string>;

interface ModerationReviewHistoryItem {
  id: string;
  adminUid: string;
  targetUserUid: string;
  reportId: string;
  previousStatus: ModerationReportStatus | null;
  nextStatus: ModerationReportStatus | null;
  reason: ModerationReportReason | null;
  targetType: ModerationReportTargetType | null;
  resolution: string | null;
  timestamp: unknown;
}

interface AdminModerationReportsVm {
  reports: AdminModerationReportVm[];
  statusFilteredTotal: number;
  filteredReports: AdminModerationReportVm[];
  historyItems: ModerationReviewHistoryItem[];
  total: number;
  open: number;
  reviewing: number;
  resolved: number;
  rejected: number;
  loading: boolean;
  error: boolean;
  searchTerm: string;
}

@Component({
  selector: 'app-moderation-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, AdminMaterialModule],
  templateUrl: './moderation-reports.component.html',
  styleUrls: ['./moderation-reports.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModerationReportsComponent {
  private readonly reportsService = inject(AdminModerationReportService);
  private readonly adminLog = inject(AdminLogService);
  private readonly notification = inject(ErrorNotificationService);

  readonly selectedFilter = signal<AdminReportFilter>('open');
  readonly searchTerm = signal<string>('');
  readonly busyReportId = signal<string | null>(null);
  readonly resolutionDrafts = signal<ResolutionDrafts>({});

  private readonly selectedFilter$ = toObservable(this.selectedFilter);
  private readonly searchTerm$ = toObservable(this.searchTerm);

  private readonly loadingReports$: Observable<AdminModerationReportVm[]> =
    this.reportsService.listReports$().pipe(
      catchError(() => {
        this.notification.showError('Não foi possível carregar denúncias.');
        return of([] as AdminModerationReportVm[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly reviewHistory$: Observable<ModerationReviewHistoryItem[]> =
    this.adminLog.listAdminActions$(120).pipe(
      map((logs) => logs
        .filter((log) => String(log.action ?? '').trim() === 'moderationReportReview')
        .map((log) => this.normalizeHistoryItem(log))
        .filter((item): item is ModerationReviewHistoryItem => !!item)
      ),
      catchError(() => {
        this.notification.showError('Não foi possível carregar o histórico de moderação.');
        return of([] as ModerationReviewHistoryItem[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly vm$: Observable<AdminModerationReportsVm> = combineLatest([
    this.loadingReports$,
    this.selectedFilter$,
    this.searchTerm$,
    this.reviewHistory$,
  ]).pipe(
    map(([reports, selected, searchTerm, historyItems]) => this.buildVm(
      reports,
      selected,
      searchTerm,
      historyItems
    )),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  setFilter(filter: AdminReportFilter): void {
    this.selectedFilter.set(filter);
  }

  setSearchTerm(value: string): void {
    this.searchTerm.set(String(value ?? '').slice(0, 120));
  }

  clearSearchTerm(): void {
    this.searchTerm.set('');
  }

  setResolutionDraft(report: AdminModerationReportVm, value: string): void {
    const reportId = this.safeReportId(report);

    if (!reportId) {
      return;
    }

    this.resolutionDrafts.update((drafts) => ({
      ...drafts,
      [reportId]: String(value ?? '').slice(0, 900),
    }));
  }

  resolutionDraft(report: AdminModerationReportVm): string {
    const reportId = this.safeReportId(report);

    if (!reportId) {
      return '';
    }

    return this.resolutionDrafts()[reportId] ?? report.resolution ?? '';
  }

  resolutionDraftLength(report: AdminModerationReportVm): number {
    return this.resolutionDraft(report).length;
  }

  targetRoute(report: AdminModerationReportVm): string[] | null {
    if (report.targetType !== 'profile') {
      return null;
    }

    const profileUid = String(report.targetOwnerUid || report.targetId || '').trim();

    if (!profileUid) {
      return null;
    }

    return ['/outro-perfil', profileUid];
  }

  sourceRoute(report: AdminModerationReportVm): string | null {
    const route = String(report.route ?? '').trim();

    if (!route || !route.startsWith('/') || route.startsWith('//')) {
      return null;
    }

    return route;
  }

  markReviewing(report: AdminModerationReportVm): void {
    this.reviewReport(
      report,
      this.buildReviewPatch(report, 'reviewing', 'Denúncia colocada em análise pela moderação.')
    );
  }

  resolveReport(report: AdminModerationReportVm): void {
    this.reviewReport(
      report,
      this.buildReviewPatch(report, 'resolved', 'Denúncia revisada e marcada como resolvida.')
    );
  }

  rejectReport(report: AdminModerationReportVm): void {
    this.reviewReport(
      report,
      this.buildReviewPatch(report, 'rejected', 'Denúncia revisada e rejeitada pela moderação.')
    );
  }

  trackByReportId(_: number, report: AdminModerationReportVm): string {
    return report.id;
  }

  trackByHistoryId(_: number, item: ModerationReviewHistoryItem): string {
    return item.id || `${item.reportId}-${item.adminUid}`;
  }

  statusLabel(status: ModerationReportStatus | null): string {
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

  reasonLabel(reason: ModerationReportReason | null): string {
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
        return 'Outro motivo';
      default:
        return 'Não informado';
    }
  }

  targetTypeLabel(type: ModerationReportTargetType | null): string {
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
        return 'Conteúdo';
      default:
        return 'Não informado';
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

  private buildVm(
    reports: AdminModerationReportVm[],
    selected: AdminReportFilter,
    searchTerm: string,
    historyItems: ModerationReviewHistoryItem[]
  ): AdminModerationReportsVm {
    const safeReports = [...reports];
    const normalizedSearch = this.normalizeSearchTerm(searchTerm);

    const statusFilteredReports = selected === 'all'
      ? safeReports
      : safeReports.filter((report) => report.status === selected);

    const filteredReports = normalizedSearch
      ? statusFilteredReports.filter((report) => this.reportMatchesSearch(report, normalizedSearch))
      : statusFilteredReports;

    return {
      reports: safeReports,
      statusFilteredTotal: statusFilteredReports.length,
      filteredReports,
      historyItems,
      total: safeReports.length,
      open: safeReports.filter((report) => report.status === 'open').length,
      reviewing: safeReports.filter((report) => report.status === 'reviewing').length,
      resolved: safeReports.filter((report) => report.status === 'resolved').length,
      rejected: safeReports.filter((report) => report.status === 'rejected').length,
      loading: false,
      error: false,
      searchTerm: normalizedSearch,
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

    this.reportsService.reviewReport$(report.id, patch)
      .pipe(finalize(() => this.busyReportId.set(null)))
      .subscribe({
        next: () => {
          this.clearResolutionDraft(report);
          this.notification.showSuccess('Denúncia atualizada e registrada.');
        },
        error: () => {
          this.notification.showError('Não foi possível atualizar a denúncia.');
        },
      });
  }

  private buildReviewPatch(
    report: AdminModerationReportVm,
    status: ModerationReportReviewPatch['status'],
    fallback: string
  ): ModerationReportReviewPatch {
    return {
      status,
      previousStatus: report.status,
      targetUserUid: this.reviewTargetUserUid(report),
      reportReason: report.reason,
      reportTargetType: report.targetType,
      resolution: this.resolveModerationNote(report, fallback),
    };
  }

  private reviewTargetUserUid(report: AdminModerationReportVm): string {
    return String(report.targetOwnerUid || report.targetId || report.reporterUid || '').trim();
  }

  private resolveModerationNote(
    report: AdminModerationReportVm,
    fallback: string
  ): string {
    return this.resolutionDraft(report).trim().slice(0, 900) || fallback;
  }

  private clearResolutionDraft(report: AdminModerationReportVm): void {
    const reportId = this.safeReportId(report);

    if (!reportId) {
      return;
    }

    this.resolutionDrafts.update((drafts) => {
      const next = { ...drafts };
      delete next[reportId];
      return next;
    });
  }

  private normalizeHistoryItem(log: IAdminLogRecord): ModerationReviewHistoryItem | null {
    const details = this.objectDetails(log.details);
    const reportId = String(details['reportId'] ?? '').trim();
    const adminUid = String(log.adminUid ?? '').trim();
    const targetUserUid = String(log.targetUserUid ?? '').trim();

    if (!reportId || !adminUid || !targetUserUid) {
      return null;
    }

    return {
      id: String(log.id ?? '').trim(),
      adminUid,
      targetUserUid,
      reportId,
      previousStatus: this.safeStatus(details['previousStatus']),
      nextStatus: this.safeStatus(details['nextStatus']),
      reason: this.safeReason(details['reason']),
      targetType: this.safeTargetType(details['targetType']),
      resolution: String(details['resolution'] ?? '').trim() || null,
      timestamp: log.timestamp ?? null,
    };
  }

  private reportMatchesSearch(
    report: AdminModerationReportVm,
    normalizedSearch: string
  ): boolean {
    const searchable = [
      report.id,
      report.reporterUid,
      report.targetId,
      report.targetOwnerUid,
      report.route,
      report.details,
      report.resolution,
      report.status,
      report.reason,
      this.reasonLabel(report.reason),
      report.targetType,
      this.targetTypeLabel(report.targetType),
    ]
      .map((value) => String(value ?? ''))
      .join(' ');

    return this.normalizeSearchTerm(searchable).includes(normalizedSearch);
  }

  private objectDetails(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private safeStatus(value: unknown): ModerationReportStatus | null {
    const status = String(value ?? '').trim() as ModerationReportStatus;
    return ['open', 'reviewing', 'resolved', 'rejected'].includes(status) ? status : null;
  }

  private safeReason(value: unknown): ModerationReportReason | null {
    const reason = String(value ?? '').trim() as ModerationReportReason;
    return [
      'spam',
      'fake_profile',
      'harassment',
      'hate_or_abuse',
      'sexual_boundary',
      'illegal_content',
      'privacy',
      'minor_safety',
      'other',
    ].includes(reason) ? reason : null;
  }

  private safeTargetType(value: unknown): ModerationReportTargetType | null {
    const type = String(value ?? '').trim() as ModerationReportTargetType;
    return ['profile', 'photo', 'message', 'room', 'status', 'venue', 'other'].includes(type) ? type : null;
  }

  private normalizeSearchTerm(value: string): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  private safeReportId(report: AdminModerationReportVm): string {
    return String(report?.id ?? '').trim();
  }
}
