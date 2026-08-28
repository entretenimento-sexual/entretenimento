import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import {
  PLATFORM_LEGAL_MANIFEST,
} from '@core/services/compliance/platform-legal.constants';
import { isCurrentTermsRecordAccepted } from '@core/services/compliance/terms-acceptance.service';

interface LegalAcceptanceVm {
  readonly accepted: boolean;
  readonly acceptedAt: number | null;
  readonly acceptedVersion: string | null;
}

@Component({
  selector: 'app-legal-documents',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './legal-documents.component.html',
  styleUrl: './legal-documents.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalDocumentsComponent {
  private readonly currentUserStore = inject(CurrentUserStoreService);

  readonly legalManifest = PLATFORM_LEGAL_MANIFEST;

  readonly acceptance$ = this.currentUserStore.user$.pipe(
    map((user): LegalAcceptanceVm => {
      const record = user?.acceptedTerms ?? null;

      return {
        accepted: isCurrentTermsRecordAccepted(record),
        acceptedAt: record?.acceptedAt ?? record?.date ?? null,
        acceptedVersion: record?.version ?? null,
      };
    }),
    distinctUntilChanged(
      (previous, current) =>
        previous.accepted === current.accepted &&
        previous.acceptedAt === current.acceptedAt &&
        previous.acceptedVersion === current.acceptedVersion
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
