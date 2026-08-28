import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { LegalUpdateNoticeService } from 'src/app/core/services/compliance/legal-update-notice.service';

/**
 * Bridge sem interface visual.
 *
 * Mantém o efeito reativo de notificação jurídica fora do LayoutShell e não
 * decide navegação, aceite ou regra de acesso. A callable é idempotente.
 */
@Component({
  selector: 'app-legal-update-notice-bridge',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalUpdateNoticeBridgeComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly legalNotice = inject(LegalUpdateNoticeService);

  ngOnInit(): void {
    this.legalNotice.watchAndEnsure$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }
}
