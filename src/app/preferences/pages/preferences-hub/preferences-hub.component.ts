// src/app/preferences/pages/preferences-hub/preferences-hub.component.ts
// Hub principal do domínio novo de preferências.
//
// Ajuste desta versão:
// - passa a usar header reutilizável do domínio
// - passa a usar navegação interna do domínio
// - continua respeitando o shell global já existente
// - não cria layout paralelo
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { PreferencesFacade } from '../../application/preferences.facade';
import { PreferenceSummaryCardComponent } from '../../components/preference-summary-card/preference-summary-card.component';
import { PreferencesHubCardComponent } from '../../components/preferences-hub-card/preferences-hub-card.component';
import { PreferencesPageHeaderComponent } from '../../components/preferences-page-header/preferences-page-header.component';
import { PreferencesDomainNavComponent } from '../../components/preferences-domain-nav/preferences-domain-nav.component';
import { PreferencesUiService } from '../../state/preferences-ui.service';

@Component({
  selector: 'app-preferences-hub',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PreferenceSummaryCardComponent,
    PreferencesHubCardComponent,
    PreferencesPageHeaderComponent,
    PreferencesDomainNavComponent,
  ],
  templateUrl: './preferences-hub.component.html',
  styleUrl: './preferences-hub.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesHubComponent {
  private readonly preferencesUi = inject(PreferencesUiService);
  readonly preferencesFacade = inject(PreferencesFacade);

  readonly vm$ = this.preferencesFacade.currentPreferencesVm$;
  readonly uid$ = this.preferencesFacade.currentUid$;

  readonly lastEditorUid = this.preferencesUi.lastEditorUid;
  readonly lastCompatibilityTargetUid = this.preferencesUi.lastCompatibilityTargetUid;

  constructor() {
    this.preferencesUi.setActiveView('hub');
  }
}