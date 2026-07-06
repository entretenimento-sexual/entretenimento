import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { UserPhotoManagerComponent } from './user-photo-manager.component';
import { PhotoFirestoreService } from '../../core/services/image-handling/photo-firestore.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';

describe('UserPhotoManagerComponent', () => {
  let component: UserPhotoManagerComponent;
  let fixture: ComponentFixture<UserPhotoManagerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserPhotoManagerComponent],
      providers: [
        {
          provide: PhotoFirestoreService,
          useValue: {
            getPhotosByUser: vi.fn(() => of([])),
            deletePhoto: vi.fn(() => Promise.resolve()),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserPhotoManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
