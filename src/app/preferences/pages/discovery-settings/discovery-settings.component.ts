// src/app/preferences/pages/discovery-settings/discovery-settings.component.ts
// Página nova focada em discovery settings.
//
// Ajuste desta versão:
// - passa a usar header reutilizável do domínio
// - passa a usar navegação interna do domínio
// - continua respeitando o shell global já existente
// Visual clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PreferenceVisibilitySettings } from '../../models/preference-profile.model';

import { DiscoverySettingsFacade } from '../../application/discovery-settings.facade';
import { DiscoveryVisibilityPanelComponent } from '../../components/discovery-visibility-panel/discovery-visibility-panel.component';
import { DiscoveryVisibilityFormComponent } from '../../components/discovery-visibility-form/discovery-visibility-form.component';
import { DiscoveryUpgradeHintsComponent } from '../../components/discovery-upgrade-hints/discovery-upgrade-hints.component';
import { PreferencesPageHeaderComponent } from '../../components/preferences-page-header/preferences-page-header.component';
import { PreferencesDomainNavComponent } from '../../components/preferences-domain-nav/preferences-domain-nav.component';
import { PreferencesUiService } from '../../state/preferences-ui.service';

@Component({
  selector: 'app-discovery-settings',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    DiscoveryVisibilityPanelComponent,
    DiscoveryVisibilityFormComponent,
    DiscoveryUpgradeHintsComponent,
    PreferencesPageHeaderComponent,
    PreferencesDomainNavComponent,
  ],
  templateUrl: './discovery-settings.component.html',
  styleUrl: './discovery-settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoverySettingsComponent {
  private readonly discoverySettingsFacade = inject(DiscoverySettingsFacade);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly preferencesUi = inject(PreferencesUiService);  

  readonly isSaving = signal(false);
  readonly vm$ = this.discoverySettingsFacade.currentDiscoverySettingsVm$;

constructor() {
  this.preferencesUi.setActiveView('discovery_settings');
}

  onSave(uid: string, visibility: PreferenceVisibilitySettings): void {
    if (!uid) return;

    this.isSaving.set(true);

    this.discoverySettingsFacade.saveVisibilitySettings$(uid, visibility).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.notifier.showSuccess('Configurações de descoberta salvas com sucesso.');
      },
      error: () => {
        this.isSaving.set(false);
      },
    });
  }
}