// src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.ts
// Painel de visibilidade e descoberta do domínio novo.
//
// Objetivo:
// - exibir o estado atual de descoberta/privacidade
// - refletir capabilities do usuário por role/assinatura
// - servir como bloco de produto para futuras regras de monetização
//
// Observação:
// - componente somente de leitura
// - não salva nada
// - não toca no legado
// Visual clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { PreferenceProfile } from '../../models/preference-profile.model';
import { PreferencesCapabilitySnapshot } from '../../services/preferences-capability.service';

@Component({
  selector: 'app-discovery-visibility-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './discovery-visibility-panel.component.html',
  styleUrl: './discovery-visibility-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryVisibilityPanelComponent {
  readonly profile = input<PreferenceProfile | null>(null);
  readonly capabilities = input<PreferencesCapabilitySnapshot | null>(null);

  readonly discoveryModeLabel = computed(() => {
    const mode = this.profile()?.visibility?.discoveryMode ?? 'standard';

    switch (mode) {
      case 'discreet':
        return 'Discreto';
      case 'priority':
        return 'Prioritário';
      case 'standard':
      default:
        return 'Padrão';
    }
  });

  readonly showBadgesLabel = computed(() =>
    this.profile()?.visibility?.showPreferenceBadges ? 'Ativo' : 'Oculto'
  );

  readonly showIntentPubliclyLabel = computed(() =>
    this.profile()?.visibility?.showIntentPublicly ? 'Público' : 'Privado'
  );

  readonly availabilityItems = computed(() => {
    const caps = this.capabilities();

    return [
      {
        label: 'Discovery avançado',
        enabled: caps?.canUseAdvancedDiscovery ?? false,
        hint: 'Mais controle sobre filtros e descoberta.',
      },
      {
        label: 'Modo discreto',
        enabled: caps?.canUseDiscreetMode ?? false,
        hint: 'Reduz exposição e melhora privacidade.',
      },
      {
        label: 'Visibilidade prioritária',
        enabled: caps?.canUsePriorityVisibility ?? false,
        hint: 'Elegível para destaque em discovery.',
      },
      {
        label: 'Boost de intenção',
        enabled: caps?.canUseIntentBoost ?? false,
        hint: 'Favorece exposição contextual temporária.',
      },
      {
        label: 'Insights de compatibilidade',
        enabled: caps?.canSeeCompatibilityInsights ?? false,
        hint: 'Explica melhor os cruzamentos de interesse.',
      },
    ];
  });

  readonly monetizationHint = computed(() => {
    const caps = this.capabilities();
    if (!caps) return 'As capacidades serão liberadas conforme o grau de role e assinatura.';

    if (
      caps.canUseAdvancedDiscovery &&
      caps.canUseDiscreetMode &&
      caps.canUsePriorityVisibility &&
      caps.canSeeCompatibilityInsights
    ) {
      return 'Seu perfil já possui um conjunto forte de recursos para descoberta e privacidade.';
    }

    return 'Há espaço para liberar recursos mais avançados de descoberta, privacidade e visibilidade.';
  });
}