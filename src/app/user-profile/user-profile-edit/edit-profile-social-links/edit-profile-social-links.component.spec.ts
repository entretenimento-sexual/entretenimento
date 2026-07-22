import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditProfileSocialLinksComponent } from './edit-profile-social-links.component';
import { AccessControlService } from '../../../core/services/autentication/auth/access-control.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { UserSocialLinksService } from '../../../core/services/user-profile/user-social-links.service';

describe('EditProfileSocialLinksComponent', () => {
  let component: EditProfileSocialLinksComponent;
  let fixture: ComponentFixture<EditProfileSocialLinksComponent>;

  let subscriber$: BehaviorSubject<boolean>;
  let serviceMock: {
    getSocialLinks: ReturnType<typeof vi.fn>;
    saveSocialLinks: ReturnType<typeof vi.fn>;
    removeLink: ReturnType<typeof vi.fn>;
  };
  let notificationMock: {
    showSuccess: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    showWarning: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    subscriber$ = new BehaviorSubject<boolean>(true);
    serviceMock = {
      getSocialLinks: vi.fn(() => of({ instagram: 'tester' })),
      saveSocialLinks: vi.fn(() => of(void 0)),
      removeLink: vi.fn(() => of(void 0)),
    };
    notificationMock = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
      showWarning: vi.fn(),
    };

    TestBed.configureTestingModule({
      declarations: [EditProfileSocialLinksComponent],
      imports: [FormsModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ uid: 'u1' }),
            },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            appUserResolved$: of(true),
            authUid$: of('u1'),
            isSubscriber$: subscriber$.asObservable(),
          },
        },
        {
          provide: UserSocialLinksService,
          useValue: serviceMock,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: notificationMock,
        },
      ],
    });

    fixture = TestBed.createComponent(EditProfileSocialLinksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar e reconhecer o assinante dono do perfil', () => {
    expect(component).toBeTruthy();
    expect(component.isOwner).toBe(true);
    expect(component.canPublish).toBe(true);
  });

  it('deve publicar fonte privada e espelho público', () => {
    component.salvarRedes();

    expect(serviceMock.saveSocialLinks).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ instagram: 'tester' }),
      {
        publishToPublic: true,
        notifyOnError: false,
      }
    );
    expect(notificationMock.showSuccess).toHaveBeenCalledWith(
      'Redes sociais publicadas.'
    );
  });

  it('deve bloquear inclusão e alteração quando a assinatura estiver inativa', () => {
    subscriber$.next(false);
    fixture.detectChanges();

    component.updateLocalLink('instagram', 'novo');
    component.salvarRedes();

    expect(component.canPublish).toBe(false);
    expect(component.socialLinks.instagram).toBe('tester');
    expect(serviceMock.saveSocialLinks).not.toHaveBeenCalled();
    expect(notificationMock.showWarning).toHaveBeenCalledWith(
      'Uma assinatura ativa é necessária para publicar redes sociais.'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'exclusiva para assinantes'
    );
  });

  it('deve permitir remover link próprio mesmo sem assinatura', () => {
    subscriber$.next(false);
    fixture.detectChanges();

    component.removerRede('instagram');

    expect(serviceMock.removeLink).toHaveBeenCalledWith('u1', 'instagram', {
      publishToPublic: true,
      notifyOnError: false,
    });
    expect(component.socialLinks.instagram).toBeUndefined();
  });
});
