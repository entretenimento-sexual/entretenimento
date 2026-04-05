// src/app/preferences/pages/preferences-editor/preferences-editor.component.ts
// Não esquecer ferramentas de debug e comentários explicativos
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { distinctUntilChanged, map, tap } from 'rxjs/operators';

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
import { Observable } from 'rxjs';
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

  readonly isSavingProfile = signal(false);
  readonly isSavingIntent = signal(false);

  readonly uid$ = this.route.paramMap.pipe(
    map((params) => (params.get('uid') ?? params.get('id') ?? '').trim() || null),
    distinctUntilChanged(),
    tap((uid) => {
      this.preferencesUi.setActiveView('editor');
      this.preferencesUi.setLastEditorUid(uid);
    })
  );

  readonly state$ = this.uid$.pipe(
    map((uid) => uid ?? ''),
    switchMapSafe((uid) => this.editorFacade.getEditorState$(uid))
  );

  onSaveProfile(uid: string, profile: PreferenceProfile): void {
    if (!uid) return;

    this.isSavingProfile.set(true);

    this.editorFacade.saveProfileOnly$(uid, profile).subscribe({
      next: () => {
        this.isSavingProfile.set(false);
        this.notifier.showSuccess('Perfil de preferências salvo com sucesso.');
      },
      error: () => {
        this.isSavingProfile.set(false);
      },
    });
  }

  onSaveIntent(uid: string, intent: IntentState): void {
    if (!uid) return;

    this.isSavingIntent.set(true);

    this.editorFacade.saveIntentOnly$(uid, intent).subscribe({
      next: () => {
        this.isSavingIntent.set(false);
        this.notifier.showSuccess('Intenção atual salva com sucesso.');
      },
      error: () => {
        this.isSavingIntent.set(false);
      },
    });
  }
}

function switchMapSafe<T, R>(project: (value: T) => Observable<R>) {
  return (source: Observable<T>): Observable<R> =>
    new Observable<R>((subscriber) => {
      let innerSub: { unsubscribe(): void } | null = null;

      const outerSub = source.subscribe({
        next(value) {
          innerSub?.unsubscribe();
          innerSub = project(value).subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
          });
        },
        error: (e) => subscriber.error(e),
        complete: () => subscriber.complete(),
      });

      return () => {
        innerSub?.unsubscribe();
        outerSub.unsubscribe();
      };
    });
}