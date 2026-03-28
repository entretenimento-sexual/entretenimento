// src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.ts
// Card visual do MatchProfile.
//
// Objetivo:
// - mostrar rapidamente o documento derivado construído/materializado
// - ajudar debug funcional e evolução do ranking/discovery
// - não persiste nada

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { MatchProfile } from '../../models/match-profile.model';

@Component({
  selector: 'app-match-profile-preview-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './match-profile-preview-card.component.html',
  styleUrl: './match-profile-preview-card.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchProfilePreviewCardComponent {
  readonly title = input<string>('Match profile');
  readonly matchProfile = input<MatchProfile | null>(null);

  readonly relationshipIntentsCount = computed(
    () => this.matchProfile()?.search?.relationshipIntents?.length ?? 0
  );

  readonly sexualPracticesCount = computed(
    () => this.matchProfile()?.search?.sexualPractices?.length ?? 0
  );

  readonly boostsCount = computed(
    () => this.matchProfile()?.ranking?.compatibilityBoosts?.length ?? 0
  );

  readonly availabilityLabel = computed(() =>
    this.matchProfile()?.search?.availableNow ? 'Disponível agora' : 'Sem disponibilidade imediata'
  );
}