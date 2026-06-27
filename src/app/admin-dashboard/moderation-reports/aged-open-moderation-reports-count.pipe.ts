// src/app/admin-dashboard/moderation-reports/aged-open-moderation-reports-count.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

import { AdminModerationReportVm } from 'src/app/core/services/moderation/admin-moderation-report.service';
import { isAgedOpenModerationReport } from './moderation-report-age.util';

@Pipe({
  name: 'agedOpenModerationReportsCount',
  standalone: true,
  pure: true,
})
export class AgedOpenModerationReportsCountPipe implements PipeTransform {
  transform(reports: readonly AdminModerationReportVm[] | null | undefined): number {
    return (reports ?? []).filter((report) => isAgedOpenModerationReport(report)).length;
  }
}
