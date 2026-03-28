// src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.ts
// Card visual da prévia de compatibilidade.
// Não persiste nada.
// Não toca no legado.
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CompatibilityPreview } from '../../models/compatibility-preview.model';

@Component({
  selector: 'app-compatibility-preview-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './compatibility-preview-card.component.html',
  styleUrl: './compatibility-preview-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompatibilityPreviewCardComponent {
  readonly preview = input<CompatibilityPreview | null>(null);

  readonly overallLabel = computed(() => {
    const score = this.preview()?.overallScore ?? 0;

    if (score >= 80) return 'Alta compatibilidade';
    if (score >= 60) return 'Compatibilidade promissora';
    if (score >= 40) return 'Compatibilidade moderada';
    return 'Compatibilidade baixa';
  });
}