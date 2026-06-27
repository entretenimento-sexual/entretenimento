// src/app/admin-dashboard/moderation-reports/aged-open-moderation-report.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

import { AdminModerationReportVm } from 'src/app/core/services/moderation/admin-moderation-report.service';
import { agedOpenModerationReportLabel } from './moderation-report-age.util';

@Pipe({
  name: 'agedOpenModerationReport',
  standalone: true,
  pure: true,
})
export class AgedOpenModerationReportPipe implements PipeTransform {
  transform(report: AdminModerationReportVm): string | null {
    return agedOpenModerationReportLabel(report);
  }
}
