// src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SocialLinksAccordionComponent } from './user-social-links-accordion.component';

import { AccessControlService } from '../../../core/services/autentication/auth/access-control.service';
import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { UserSocialLinksService } from '../../../core/services/user-profile/user-social-links.service';

class MockUserSocialLinksService {
  watchSocialLinks = vi.fn().mockReturnValue(of({ instagram: 'alex' }));
  saveSocialLinks = vi.fn().mockReturnValue(of(void 0));
  removeLink = vi.fn().mockReturnValue(of(void 0));
}

class MockCurrentUserStoreService {
  user$ = new BehaviorSubject<any | null | undefined>({ uid: 'u1' });
}

class MockAuthSessionService {
  private readonly authUserSubject = new BehaviorSubject<any | null>({ uid: 'u1' });
  private readonly uidSubject = new BehaviorSubject<string | null>('u1');

  authUser$ = this.authUserSubject.asObservable();
  uid$ = this.uidSubject.asObservable();
  ready$ = of(true);
  currentAuthUser: { uid: string } | null = { uid: 'u1' };

  setAuthUser(user: { uid: string } | null): void {
    this.currentAuthUser = user;
    this.authUserSubject.next(user);
    this.uidSubject.next(user?.uid ?? null);
  }
}

class MockAccessControlService {
  readonly subscriberSubject = new BehaviorSubject<boolean>(true);
  readonly isSubscriber$ = this.subscriberSubject.asObservable();
}

class MockErrorNotificationService {
  showSuccess = vi.fn();
  showError = vi.fn();
  showWarning = vi.fn();
}

class MockGlobalErrorHandlerService {
  handleError = vi.fn();
}

describe('SocialLinksAccordionComponent', () => {
  let component: SocialLinksAccordionComponent;
  let fixture: ComponentFixture<SocialLinksAccordionComponent>;

  let linksSvc: MockUserSocialLinksService;
  let notify: MockErrorNotificationService;
  let authSession: MockAuthSessionService;
  let accessControl: MockAccessControlService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SocialLinksAccordionComponent,
        RouterTestingModule,
        NoopAnimationsModule,
      ],
      providers: [
        { provide: UserSocialLinksService, useClass: MockUserSocialLinksService },
        { provide: CurrentUserStoreService, useClass: MockCurrentUserStoreService },
        { provide: AuthSessionService, useClass: MockAuthSessionService },
        { provide: AccessControlService, useClass: MockAccessControlService },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
        { provide: GlobalErrorHandlerService, useClass: MockGlobalErrorHandlerService },
      ],
    }).compileComponents();

    linksSvc = TestBed.inject(
      UserSocialLinksService
    ) as unknown as MockUserSocialLinksService;
    notify = TestBed.inject(
      ErrorNotificationService
    ) as unknown as MockErrorNotificationService;
    authSession = TestBed.inject(
      AuthSessionService
    ) as unknown as MockAuthSessionService;
    accessControl = TestBed.inject(
      AccessControlService
    ) as unknown as MockAccessControlService;

    authSession.setAuthUser({ uid: 'u1' });

    fixture = TestBed.createComponent(SocialLinksAccordionComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('uid', 'u1');
    fixture.componentRef.setInput('isOwner', false);
    fixture.detectChanges();
  });

  it('deve criar, carregar e normalizar links', () => {
    expect(component).toBeTruthy();
    expect(linksSvc.watchSocialLinks).toHaveBeenCalledWith('u1', {
      notifyOnError: false,
      allowAnonymousRead: false,
    });
    expect(component.socialLinks?.instagram).toBe('alex');
    expect(component.normalizedLinks.instagram).toBe(
      'https://instagram.com/alex'
    );
  });

  it('deve permitir publicar quando o dono for assinante', () => {
    component.updateSocialLink('instagram', '@novo');

    expect(linksSvc.saveSocialLinks).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ instagram: '@novo' }),
      {
        publishToPublic: true,
        notifyOnError: false,
      }
    );
    expect(notify.showSuccess).toHaveBeenCalledWith(
      'Rede social publicada.'
    );
  });

  it('deve bloquear publicação sem assinatura e preservar remoção', () => {
    accessControl.subscriberSubject.next(false);
    fixture.detectChanges();

    component.updateSocialLink('instagram', '@novo');
    component.removeLink('instagram');

    expect(component.canEdit()).toBe(false);
    expect(linksSvc.saveSocialLinks).not.toHaveBeenCalled();
    expect(notify.showWarning).toHaveBeenCalledWith(
      'Uma assinatura ativa é necessária para publicar redes sociais.'
    );
    expect(linksSvc.removeLink).toHaveBeenCalledWith('u1', 'instagram', {
      publishToPublic: true,
      notifyOnError: false,
    });
  });

  it('deve mostrar variante compacta sem aviso repetitivo para visitante', () => {
    const visitedFixture = TestBed.createComponent(
      SocialLinksAccordionComponent
    );
    visitedFixture.componentRef.setInput('uid', 'u2');
    visitedFixture.componentRef.setInput('compact', true);
    visitedFixture.componentRef.setInput('hideWhenEmpty', true);
    visitedFixture.detectChanges();

    const text = visitedFixture.nativeElement.textContent as string;

    expect(text).toContain('Redes');
    expect(text).toContain('Instagram');
    expect(text).not.toContain('Links externos abrem');
    expect(visitedFixture.nativeElement.hasAttribute('hidden')).toBe(false);
  });

  it('deve ocultar integralmente a variante visitada sem links públicos', () => {
    linksSvc.watchSocialLinks.mockReturnValue(of(null));

    const emptyFixture = TestBed.createComponent(
      SocialLinksAccordionComponent
    );
    emptyFixture.componentRef.setInput('uid', 'u2');
    emptyFixture.componentRef.setInput('compact', true);
    emptyFixture.componentRef.setInput('hideWhenEmpty', true);
    emptyFixture.detectChanges();

    expect(emptyFixture.nativeElement.hasAttribute('hidden')).toBe(true);
    expect(emptyFixture.nativeElement.textContent.trim()).toBe('');
  });
});
