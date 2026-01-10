// src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { of, BehaviorSubject } from 'rxjs';

import { SocialLinksAccordionComponent } from './user-social-links-accordion.component';

// 🔁 IMPORTS RELATIVOS (a partir da pasta deste spec)
import { UserSocialLinksService } from '../../../core/services/user-profile/user-social-links.service';
import { CurrentUserStoreService } from '../../../core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';

class MockUserSocialLinksService {
  getSocialLinks = jest.fn().mockReturnValue(of({ instagram: 'alex' }));
  saveSocialLinks = jest.fn().mockReturnValue(of(void 0));
  removeLink = jest.fn().mockReturnValue(of(void 0));
}

class MockCurrentUserStoreService {
  user$ = new BehaviorSubject<any | null | undefined>({ uid: 'u1' });
}

class MockAuthSessionService { }
class MockErrorNotificationService {
  showSuccess = jest.fn();
  showError = jest.fn();
}

describe('SocialLinksAccordionComponent', () => {
  let component: SocialLinksAccordionComponent;
  let fixture: ComponentFixture<SocialLinksAccordionComponent>;
  let linksSvc: MockUserSocialLinksService;
  let notify: MockErrorNotificationService;

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
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SocialLinksAccordionComponent);
    component = fixture.componentInstance;

    linksSvc = TestBed.inject(UserSocialLinksService) as any;
    notify = TestBed.inject(ErrorNotificationService) as any;

    fixture.componentRef.setInput('uid', 'u1');
    fixture.componentRef.setInput('isOwner', false);

    fixture.detectChanges();
  });

  it('deve criar', () => {
    expect(component).toBeTruthy();
  });

  it('carrega e normaliza links (instagram)', () => {
    expect(linksSvc.getSocialLinks).toHaveBeenCalledWith('u1');
    expect(component.socialLinks?.instagram).toBe('alex');
    expect(component.normalizedLinks['instagram']).toBe('https://instagram.com/alex');
  });

  it('permite update quando uid logado === uid do perfil', () => {
    component.updateSocialLink('instagram', '@novo');
    expect(linksSvc.saveSocialLinks).toHaveBeenCalled();
    expect(notify.showSuccess).toHaveBeenCalled();
  });

  it('bloqueia update quando não pode editar', () => {
    fixture.componentRef.setInput('uid', 'u2');
    fixture.detectChanges();

    linksSvc.saveSocialLinks.mockClear();
    component.updateSocialLink('instagram', 'alguem');
    expect(linksSvc.saveSocialLinks).not.toHaveBeenCalled();
    expect(notify.showError).toHaveBeenCalled();
  });

  it('remove link quando pode editar', () => {
    fixture.componentRef.setInput('uid', 'u1');
    fixture.detectChanges();

    component.removeLink('instagram');
    expect(linksSvc.removeLink).toHaveBeenCalledWith('u1', 'instagram');
    expect(notify.showSuccess).toHaveBeenCalled();
  });
});
