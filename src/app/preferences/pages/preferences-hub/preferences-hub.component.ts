// src/app/preferences/pages/preferences-hub/preferences-hub.component.ts
// Hub principal do domínio novo de preferências.
//
// Ajuste desta versão:
// - o editor da própria conta usa rota canônica sem UID;
// - o atalho de retomada por UID foi suprimido para evitar estado obsoleto;
// - continua respeitando o shell global já existente;
// - não cria layout paralelo.
// Visual clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { PreferencesFacade } from '../../application/preferences.facade';
import { PreferencesHubCardComponent } from '../../components/preferences-hub-card/preferences-hub-card.component';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';
import { PreferencesUiService } from '../../state/preferences-ui.service';

@Component({
  selector: 'app-preferences-hub',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PreferencesHubCardComponent,
    PageHeaderComponent,
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


  constructor() {
    this.preferencesUi.setActiveView('hub');
  }
}
