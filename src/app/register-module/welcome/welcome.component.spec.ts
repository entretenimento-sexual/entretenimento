//src\app\register-module\welcome\welcome.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { WelcomeComponent } from './welcome.component';
import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';

class EmailVerificationServiceMock {
  resendVerificationEmail() { return of('OK'); }
}

describe('WelcomeComponent', () => {
  let component: WelcomeComponent;
  let fixture: ComponentFixture<WelcomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [WelcomeComponent],              // ⬅️ não-standalone
      imports: [CommonModule, RouterTestingModule],
      providers: [{ provide: EmailVerificationService, useClass: EmailVerificationServiceMock }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(WelcomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => { expect(component).toBeTruthy(); });
});
