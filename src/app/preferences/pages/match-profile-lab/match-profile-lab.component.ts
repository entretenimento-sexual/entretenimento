// src/app/preferences/pages/match-profile-lab/match-profile-lab.component.ts
// Página laboratório do MatchProfile.
//
// Objetivo:
// - visualizar built vs stored
// - acionar materialização manual no domínio novo
// - servir de base para evolução futura do fluxo de discovery
// Visual clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { MatchProfileFacade } from '../../application/match-profile.facade';
import { MatchProfilePreviewCardComponent } from '../../components/match-profile-preview-card/match-profile-preview-card.component';
import { PreferencesPageHeaderComponent } from '../../components/preferences-page-header/preferences-page-header.component';
import { PreferencesDomainNavComponent } from '../../components/preferences-domain-nav/preferences-domain-nav.component';
import { PreferencesUiService } from '../../state/preferences-ui.service';

@Component({
  selector: 'app-match-profile-lab',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatchProfilePreviewCardComponent,
    PreferencesPageHeaderComponent,
    PreferencesDomainNavComponent,
  ],
  templateUrl: './match-profile-lab.component.html',
  styleUrl: './match-profile-lab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchProfileLabComponent {
  private readonly matchProfileFacade = inject(MatchProfileFacade);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly preferencesUi = inject(PreferencesUiService);

  readonly isSaving = signal(false);
  readonly vm$ = this.matchProfileFacade.currentMatchProfileVm$;

  constructor() {
    this.preferencesUi.setActiveView('match_profile_lab');
  }

  rebuild(): void {
    this.isSaving.set(true);

    this.matchProfileFacade.rebuildAndPersistForCurrentUser$().subscribe({
      next: () => {
        this.isSaving.set(false);
        this.notifier.showSuccess('Match profile materializado com sucesso.');
      },
      error: () => {
        this.isSaving.set(false);
      },
    });
  }
}