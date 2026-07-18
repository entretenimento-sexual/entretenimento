// src/app/subscriber-experiences/exclusive-connections/exclusive-connections-page.component.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS PAGE
// -----------------------------------------------------------------------------
// Primeira superfície preparada para conteúdo de assinantes.
// O conteúdo protegido só é instanciado quando a política permite acesso.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';

import { ContentAccessPolicyService } from 'src/app/core/access/content-access-policy.service';
import { ContentAccessNoticeComponent } from 'src/app/shared/components/content-access-notice/content-access-notice.component';
import { EXCLUSIVE_CONNECTIONS_ACCESS_POLICY } from './exclusive-connections-access.policy';

@Component({
  selector: 'app-exclusive-connections-page',
  standalone: true,
  imports: [AsyncPipe, ContentAccessNoticeComponent],
  templateUrl: './exclusive-connections-page.component.html',
  styleUrl: './exclusive-connections-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExclusiveConnectionsPageComponent {
  private readonly accessPolicy = inject(ContentAccessPolicyService);

  readonly accessDecision$ = this.accessPolicy.evaluate$(
    EXCLUSIVE_CONNECTIONS_ACCESS_POLICY
  );
}
