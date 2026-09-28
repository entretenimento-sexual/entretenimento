import {
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export type PublicMediaBadgeKind =
  | 'official'
  | 'sponsored'
  | 'cover'
  | 'context'
  | 'muted';

@Component({
  selector: 'app-public-media-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-media-badge.component.html',
  styleUrl: './public-media-badge.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicMediaBadgeComponent {
  readonly kind = input<PublicMediaBadgeKind>('muted');
  readonly label = input.required<string>();
  readonly ariaLabel = input<string | null>(null);
  readonly iconClass = input<string | null>(null);
}
