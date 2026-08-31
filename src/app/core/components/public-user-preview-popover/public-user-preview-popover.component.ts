// src/app/core/components/public-user-preview-popover/public-user-preview-popover.component.ts
import { DecimalPipe, TitleCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
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
}
