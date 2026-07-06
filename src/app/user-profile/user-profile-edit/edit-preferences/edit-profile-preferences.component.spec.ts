// src/app/user-profile/user-profile-edit/edit-preferences/edit-profile-preferences.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { EditProfilePreferencesComponent } from './edit-profile-preferences.component';
import { UserPreferencesService } from '../../../core/services/preferences/user-preferences.service';
import { UserPreferenceProfileService } from '../../../core/services/preferences/user-preference-profile.service';
import {
  createErrorTestingProviderMocks,
  provideErrorTestingMocks,
} from '../../../../test/angular-error-testing.providers';

describe('EditProfilePreferencesComponent', () => {
  let fixture: ComponentFixture<EditProfilePreferencesComponent>;

  beforeEach(async () => {
    const errorProviderMocks = createErrorTestingProviderMocks();

    await TestBed.configureTestingModule({
      imports: [EditProfilePreferencesComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ uid: 'u1' })),
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            getUserPreferences$: vi.fn(() => of(null)),
            saveUserPreferences$: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: UserPreferenceProfileService,
          useValue: {
            getPreferenceProfile$: vi.fn(() => of(null)),
            savePreferenceProfile$: vi.fn(() => of(void 0)),
          },
        },
        ...provideErrorTestingMocks(errorProviderMocks),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EditProfilePreferencesComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
