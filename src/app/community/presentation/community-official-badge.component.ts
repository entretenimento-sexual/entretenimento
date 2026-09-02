// src/app/community/presentation/community-official-badge.component.ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { resolveCommunityOfficialPresentation } from './community-official.presentation';

@Component({
  selector: 'app-community-official-badge',
  standalone: true,
  template: `
    @if (presentation(); as official) {
      <span
        class="community-official-badge"
        [attr.aria-label]="official.ariaLabel"
      >
        <i class="fas fa-circle-check" aria-hidden="true"></i>
        <span>{{ official.label }}</span>
      </span>
    }
  `,
  styleUrl: './community-official-badge.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityOfficialBadgeComponent {
  readonly community = input<CommunityPreviewCard | null | undefined>(null);

  readonly presentation = computed(() =>
    resolveCommunityOfficialPresentation(this.community())
  );
}
