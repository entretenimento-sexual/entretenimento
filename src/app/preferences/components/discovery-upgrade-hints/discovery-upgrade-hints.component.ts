// src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.ts
// Bloco de hints de upgrade/monetização do domínio de descoberta.
//
// Objetivo:
// - tornar explícitas as capacidades bloqueadas
// - ajudar produto/UX a comunicar valor premium
// - continuar desacoplado de billing real
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';

type UpgradeHint = {
  title: string;
  description: string;
  locked: boolean;
};

@Component({
  selector: 'app-discovery-upgrade-hints',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './discovery-upgrade-hints.component.html',
  styleUrl: './discovery-upgrade-hints.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryUpgradeHintsComponent {
  readonly capabilities = input<PreferencesCapabilitySnapshot | null>(null);

  readonly hints = computed<UpgradeHint[]>(() => {
    const caps = this.capabilities();

    return [
      {
        title: 'Discovery avançado',
        description: 'Mais controle sobre filtros e cruzamentos desejados.',
        locked: !(caps?.canUseAdvancedDiscovery ?? false),
      },
      {
        title: 'Modo discreto',
        description: 'Reduz exposição e aumenta privacidade no discovery.',
        locked: !(caps?.canUseDiscreetMode ?? false),
      },
      {
        title: 'Visibilidade prioritária',
        description: 'Melhora a elegibilidade para destaque contextual.',
        locked: !(caps?.canUsePriorityVisibility ?? false),
      },
      {
        title: 'Insights de compatibilidade',
        description: 'Ajuda a entender melhor os cruzamentos do desejo.',
        locked: !(caps?.canSeeCompatibilityInsights ?? false),
      },
    ];
  });

  readonly hasLockedHints = computed(() => this.hints().some((item) => item.locked));
}