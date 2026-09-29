import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { filter, finalize, map, switchMap, take } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import type { PreferenceProfile } from 'src/app/preferences/models/preference-profile.model';
import type { SexualPractice } from 'src/app/preferences/models/preference.types';
import { PreferenceProfilePersistenceService } from 'src/app/preferences/services/preference-profile-persistence.service';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';

interface ProgressivePracticeOption {
  readonly value: SexualPractice;
  readonly label: string;
}

@Component({
  selector: 'app-progressive-signup',
  templateUrl: './progressive-signup.component.html',
  styleUrls: ['./progressive-signup.component.css'],
  standalone: false,
})
export class ProgressiveSignupComponent implements OnInit {
  readonly practices: readonly ProgressivePracticeOption[] = [
    { value: 'swing', label: 'Swing' },
    { value: 'menage', label: 'Ménage' },
    { value: 'exhibitionism', label: 'Exibicionismo' },
    { value: 'bdsm', label: 'BDSM' },
    { value: 'roleplay', label: 'Role-play' },
    { value: 'voyeurism', label: 'Voyeurismo' },
    { value: 'fetishes', label: 'Fetiches' },
    { value: 'group_sex', label: 'Sexo em grupo' },
    { value: 'tantra', label: 'Tantra' },
    { value: 'dom_sub', label: 'Dominação e submissão' },
    { value: 'outdoor', label: 'Ao ar livre' },
    { value: 'sensory_play', label: 'Exploração sensorial' },
  ];

  readonly selectedPractices = new Set<SexualPractice>();

  loading = true;
  saving = false;

  private uid: string | null = null;
  private profile: PreferenceProfile | null = null;

  constructor(
    private readonly router: Router,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly profilePreferences: ProfilePreferencesService,
    private readonly persistence: PreferenceProfilePersistenceService,
    private readonly applicationError: ApplicationErrorService,
    private readonly notification: ErrorNotificationService
  ) {}

  ngOnInit(): void {
    this.currentUserStore.user$
      .pipe(
        filter((user) => !!user?.uid),
        take(1),
        switchMap((user) =>
          this.profilePreferences.getProfile$(String(user!.uid)).pipe(
            take(1),
            map((profile) => ({
              uid: String(user!.uid),
              profile,
            }))
          )
        ),
        finalize(() => {
          this.loading = false;
        })
      )
      .subscribe({
        next: ({ uid, profile }) => {
          this.uid = uid;
          this.profile = profile;

          this.selectedPractices.clear();
          for (const practice of profile.softRules.sexualPractices ?? []) {
            this.selectedPractices.add(practice);
          }
        },
        error: (error: unknown) => {
          this.applicationError.report(error, {
            feature: 'progressive-signup',
            operation: 'loadPreferences',
            fallbackMessage:
              'Não foi possível carregar suas preferências agora.',
            metadata: {
              scope: 'ProgressiveSignupComponent',
            },
          });
        },
      });
  }

  capturePreference(event: Event, preference: SexualPractice): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) return;

    if (input.checked) {
      this.selectedPractices.add(preference);
      return;
    }

    this.selectedPractices.delete(preference);
  }

  isSelected(preference: SexualPractice): boolean {
    return this.selectedPractices.has(preference);
  }

  register(): void {
    if (this.saving) return;

    if (!this.uid || !this.profile) {
      this.notification.showWarning(
        'Aguarde o carregamento das suas preferências antes de continuar.'
      );
      return;
    }

    const nextProfile: PreferenceProfile = {
      ...this.profile,
      softRules: {
        ...this.profile.softRules,
        sexualPractices: Array.from(this.selectedPractices),
      },
      updatedAt: Date.now(),
    };

    this.saving = true;

    this.persistence
      .saveProfileWithProjection$(this.uid, nextProfile)
      .pipe(
        take(1),
        finalize(() => {
          this.saving = false;
        })
      )
      .subscribe({
        next: () => {
          this.profile = nextProfile;
          this.navigateToSuggestions();
        },
        error: (error: unknown) => {
          this.applicationError.report(error, {
            feature: 'progressive-signup',
            operation: 'savePreferences',
            fallbackMessage:
              'Não foi possível salvar suas preferências agora.',
            metadata: {
              scope: 'ProgressiveSignupComponent',
              selectedCount: this.selectedPractices.size,
            },
          });
        },
      });
  }

  skipForNow(): void {
    if (this.saving) return;
    this.navigateToSuggestions();
  }

  private navigateToSuggestions(): void {
    this.router
      .navigate(['/dashboard/perfis-sugeridos'])
      .catch((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'progressive-signup',
          operation: 'navigateToSuggestions',
          fallbackMessage:
            'As preferências foram mantidas, mas não foi possível abrir as sugestões.',
          metadata: {
            scope: 'ProgressiveSignupComponent',
          },
        });
      });
  }
}
