// src/app/preferences/pages/preferences-editor/preferences-editor.component.ts
// Não esquecer ferramentas de debug e comentários explicativos
// Visual clean, simplificado, em português, de fácil navegação e sempre visando o mobile
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { PreferencesEditorFacade } from '../../application/preferences-editor.facade';
import { PreferenceProfile } from '../../models/preference-profile.model';
import { IntentState } from '../../models/intent-state.model';

import { PreferenceSummaryCardComponent } from '../../components/preference-summary-card/preference-summary-card.component';
import { IntentStateCardComponent } from '../../components/intent-state-card/intent-state-card.component';
import { PreferenceProfileFormComponent } from '../../components/preference-profile-form/preference-profile-form.component';
import { IntentStateFormComponent } from '../../components/intent-state-form/intent-state-form.component';
import { DiscoveryVisibilityPanelComponent } from '../../components/discovery-visibility-panel/discovery-visibility-panel.component';
import { PreferencesUiService } from '../../state/preferences-ui.service';
import { PreferencesPageHeaderComponent } from '../../components/preferences-page-header/preferences-page-header.component';
import { PreferencesDomainNavComponent } from '../../components/preferences-domain-nav/preferences-domain-nav.component';

@Component({
  selector: 'app-preferences-editor',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PreferenceSummaryCardComponent,
    IntentStateCardComponent,
    PreferenceProfileFormComponent,
    IntentStateFormComponent,
    DiscoveryVisibilityPanelComponent,
    PreferencesPageHeaderComponent,
    PreferencesDomainNavComponent,
  ],
  templateUrl: './preferences-editor.component.html',
  styleUrl: './preferences-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesEditorComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly editorFacade = inject(PreferencesEditorFacade);
  private readonly notifier = inject(ErrorNotificationService);
  private readonly preferencesUi = inject(PreferencesUiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isSavingProfile = signal(false);
  readonly isSavingIntent = signal(false);

  readonly uid$ = this.route.paramMap.pipe(
    map((params) => (params.get('uid') ?? params.get('id') ?? '').trim() || null),
    distinctUntilChanged(),
    tap((uid) => {
      this.preferencesUi.setActiveView('editor');
      this.preferencesUi.setLastEditorUid(uid);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$ = this.uid$.pipe(
    map((uid) => uid ?? ''),
    switchMap((uid) => this.editorFacade.getEditorState$(uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  onSaveProfile(uid: string, profile: PreferenceProfile): void {
    if (!uid || this.isSavingProfile()) return;

    this.isSavingProfile.set(true);

    this.editorFacade
      .saveProfileOnly$(uid, profile)
      .pipe(
        finalize(() => this.isSavingProfile.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.notifier.showSuccess('Perfil de preferências salvo com sucesso.');
        },
        error: () => {
          // Feedback de erro já tratado pela façade.
        },
      });
  }

  onSaveIntent(uid: string, intent: IntentState): void {
    if (!uid || this.isSavingIntent()) return;

    this.isSavingIntent.set(true);

    this.editorFacade
      .saveIntentOnly$(uid, intent)
      .pipe(
        finalize(() => this.isSavingIntent.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.notifier.showSuccess('Intenção atual salva com sucesso.');
        },
        error: () => {
          // Feedback de erro já tratado pela façade.
        },
      });
  }
}
