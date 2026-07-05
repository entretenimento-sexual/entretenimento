import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { GuestBannerComponent } from './guest-banner.component';
import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
} from '../../../test/ngrx-store-testing.providers';

describe('GuestBannerComponent', () => {
  let component: GuestBannerComponent;
  let fixture: ComponentFixture<GuestBannerComponent>;

  beforeEach(() => {
    const storeMock = createStoreTestingMock({ defaultSelectorValue: null });

    TestBed.configureTestingModule({
      declarations: [GuestBannerComponent],
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: Auth,
          useValue: {
            currentUser: null,
          },
        },
        {
          provide: EmailVerificationService,
          useValue: {
            resendVerificationEmail: vi.fn(() => of('ok')),
            reloadCurrentUser: vi.fn(() => of(false)),
            getCurrentUserUid: vi.fn(() => of(null)),
            updateEmailVerificationStatus: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(GuestBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
