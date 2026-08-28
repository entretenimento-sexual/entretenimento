import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserProfilePreferencesComponent } from './user-profile-preferences.component';
import { UserPreferencesService } from '../../../core/services/preferences/user-preferences.service';
import { UserPreferenceProfileService } from '../../../core/services/preferences/user-preference-profile.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';

describe('UserProfilePreferencesComponent', () => {
  let component: UserProfilePreferencesComponent;
  let fixture: ComponentFixture<UserProfilePreferencesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserProfilePreferencesComponent],
      providers: [
        {
          provide: UserPreferenceProfileService,
          useValue: {
            getPreferenceProfile$: vi.fn(() => of(null)),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            getUserPreferences$: vi.fn(() => of(null)),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfilePreferencesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
