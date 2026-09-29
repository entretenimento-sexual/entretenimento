import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PreferenceProfilePersistenceService } from 'src/app/preferences/services/preference-profile-persistence.service';
import { ProfilePreferencesService } from 'src/app/preferences/services/profile-preferences.service';
import { createEmptyPreferenceProfile } from 'src/app/preferences/utils/preference-normalizers';

import { ProgressiveSignupComponent } from './progressive-signup.component';

describe('ProgressiveSignupComponent', () => {
  let component: ProgressiveSignupComponent;
  let fixture: ComponentFixture<ProgressiveSignupComponent>;

  const uid = 'user-1';
  const profile = {
    ...createEmptyPreferenceProfile(uid),
    softRules: {
      ...createEmptyPreferenceProfile(uid).softRules,
      sexualPractices: ['bdsm'] as const,
      interests: ['cinema'],
    },
  };

  const navigate = vi.fn(() => Promise.resolve(true));
  const saveProfileWithProjection$ = vi.fn(() => of(void 0));

  beforeEach(() => {
    navigate.mockClear();
    saveProfileWithProjection$.mockClear();

    TestBed.configureTestingModule({
      declarations: [ProgressiveSignupComponent],
      providers: [
        {
          provide: Router,
          useValue: { navigate },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({ uid }),
          },
        },
        {
          provide: ProfilePreferencesService,
          useValue: {
            getProfile$: vi.fn(() => of(profile)),
          },
        },
        {
          provide: PreferenceProfilePersistenceService,
          useValue: {
            saveProfileWithProjection$,
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: {
            report: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showWarning: vi.fn(),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(ProgressiveSignupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('hidrata as escolhas a partir do perfil canônico salvo', () => {
    expect(component.loading).toBe(false);
    expect(component.isSelected('bdsm')).toBe(true);
    expect(component.isSelected('swing')).toBe(false);
  });

  it('salva somente a fatia de práticas sem apagar outras preferências', () => {
    component.selectedPractices.clear();
    component.selectedPractices.add('swing');
    component.selectedPractices.add('voyeurism');

    component.register();

    expect(saveProfileWithProjection$).toHaveBeenCalledTimes(1);

    const [savedUid, savedProfile] =
      saveProfileWithProjection$.mock.calls[0] as unknown as [
        string,
        ReturnType<typeof createEmptyPreferenceProfile>
      ];

    expect(savedUid).toBe(uid);
    expect(savedProfile.softRules.sexualPractices).toEqual([
      'swing',
      'voyeurism',
    ]);
    expect(savedProfile.softRules.interests).toEqual(['cinema']);
  });

  it('segue para a rota canônica de perfis sugeridos após salvar', () => {
    component.register();

    expect(navigate).toHaveBeenCalledWith([
      '/dashboard/perfis-sugeridos',
    ]);
  });

  it('permite pular sem persistir escolhas', () => {
    component.skipForNow();

    expect(saveProfileWithProjection$).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith([
      '/dashboard/perfis-sugeridos',
    ]);
  });
});
