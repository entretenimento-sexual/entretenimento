// src/app/preferences/pages/preferences-home/preferences-home.component.ts
// Página inicial do domínio novo de preferências.
//
// Objetivo:
// - ser a entrada canônica do domínio preferences
// - consumir a facade nova
// - expor estado/capacidades sem tocar em componentes legados
//
// Observação:
// - nesta primeira versão, a página é somente leitura
// - edição nova entra em etapa posterior
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { PreferencesFacade } from '../../application/preferences.facade';
import { PreferenceSummaryCardComponent } from '../../components/preference-summary-card/preference-summary-card.component';
import { PreferencesPageHeaderComponent } from '../../components/preferences-page-header/preferences-page-header.component';
import { PreferencesDomainNavComponent } from '../../components/preferences-domain-nav/preferences-domain-nav.component';
import { PreferencesUiService } from '../../state/preferences-ui.service';

@Component({
  selector: 'app-preferences-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PreferenceSummaryCardComponent,
    PreferencesPageHeaderComponent,
    PreferencesDomainNavComponent,
  ],
  templateUrl: './preferences-home.component.html',
  styleUrl: './preferences-home.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesHomeComponent {
  readonly preferencesFacade = inject(PreferencesFacade);
  private readonly preferencesUi = inject(PreferencesUiService);

  readonly vm$ = this.preferencesFacade.currentPreferencesVm$;

  constructor() {
    this.preferencesUi.setActiveView('overview');
  }
}