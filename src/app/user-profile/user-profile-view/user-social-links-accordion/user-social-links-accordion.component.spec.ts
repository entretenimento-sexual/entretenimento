// src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SocialLinksAccordionComponent } from './user-social-links-accordion.component';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

// ✅ imports corretos (ajuste para o seu projeto)
import { AuthService } from '../../../core/services/autentication/auth.service';
import { UserSocialLinksService } from '../../../core/services/user-profile/user-social-links.service';
// Mocks mínimos dos serviços usados no componente
class MockUserSocialLinksService {
  getSocialLinks = jest.fn().mockReturnValue(of({}));
  saveSocialLinks = jest.fn().mockReturnValue(of(void 0));
  removeLink = jest.fn().mockReturnValue(of(void 0));
}
class MockAuthService {
  currentUser = { uid: 'u1' };
}

describe('SocialLinksAccordionComponent', () => {
  let component: SocialLinksAccordionComponent;
  let fixture: ComponentFixture<SocialLinksAccordionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SocialLinksAccordionComponent, // standalone
        RouterTestingModule,
        NoopAnimationsModule,
      ],
      providers: [
        { provide: UserSocialLinksService, useClass: MockUserSocialLinksService },
        { provide: AuthService, useClass: MockAuthService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SocialLinksAccordionComponent);
    component = fixture.componentInstance;

    // ✅ em testes de standalone + signal input, use setInput:
    fixture.componentRef.setInput('uid', 'u1');

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
