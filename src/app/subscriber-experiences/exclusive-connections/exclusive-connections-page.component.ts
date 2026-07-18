// src/app/subscriber-experiences/exclusive-connections/exclusive-connections-page.component.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS PAGE
// -----------------------------------------------------------------------------
// Primeira superfície preparada para conteúdo de assinantes.
// O feed protegido só é instanciado quando perfil e entitlement são aprovados.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';

import { ContentAccessNoticeComponent } from 'src/app/shared/components/content-access-notice/content-access-notice.component';
import { ExclusiveConnectionsAccessService } from './exclusive-connections-access.service';
import { ExclusiveConnectionsFeedComponent } from './exclusive-connections-feed.component';

@Component({
  selector: 'app-exclusive-connections-page',
  standalone: true,
  imports: [
    AsyncPipe,
    ContentAccessNoticeComponent,
    ExclusiveConnectionsFeedComponent,
  ],
  templateUrl: './exclusive-connections-page.component.html',
  styleUrl: './exclusive-connections-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExclusiveConnectionsPageComponent {
  private readonly access = inject(ExclusiveConnectionsAccessService);

  readonly accessDecision$ = this.access.evaluate$();
}
