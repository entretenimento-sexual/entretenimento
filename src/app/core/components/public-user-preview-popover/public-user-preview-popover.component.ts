// src/app/core/components/public-user-preview-popover/public-user-preview-popover.component.ts
import { DecimalPipe, TitleCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { PublicUserIdentityComponent } from '../public-user-identity/public-user-identity.component';
import type { PublicUserPreview } from '../../domain/public-user-preview/public-user-preview.model';

@Component({
  selector: 'app-public-user-preview-popover',
  standalone: true,
  imports: [
    DecimalPipe,
    PublicUserIdentityComponent,
    RouterLink,
    TitleCasePipe,
  ],
  templateUrl: './public-user-preview-popover.component.html',
  styleUrl: './public-user-preview-popover.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicUserPreviewPopoverComponent {
  readonly preview = input<PublicUserPreview | null>(null);
  readonly relationshipLabel = input<string | null>(null);

  /**
   * A superfície pode declarar explicitamente uma rota pública navegável sem
   * promover identificadores internos para PublicUserIdentity.
   */
  readonly profileRoute = input<readonly string[] | null>(null);

  readonly resolvedProfileRoute = computed<readonly string[] | null>(() => {
    const explicitRoute = (this.profileRoute() ?? [])
      .map((segment) => String(segment ?? '').trim())
      .filter(Boolean);

    if (explicitRoute.length > 0) {
      return explicitRoute;
    }

    const profileId = String(
      this.preview()?.identity.profileId ?? ''
    ).trim();

    return profileId ? ['/perfil', profileId] : null;
  });
}
