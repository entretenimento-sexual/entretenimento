// src/app/authentication/email-input-modal/email-input-modal.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { EmailInputModalComponent } from './email-input-modal.component';
import {
  EmailInputModalService,
  PasswordRecoveryModalState,
} from '../../core/services/autentication/email-input-modal.service';

describe('EmailInputModalComponent', () => {
  let component: EmailInputModalComponent;
  let fixture: ComponentFixture<EmailInputModalComponent>;

  const state$ = new BehaviorSubject<PasswordRecoveryModalState>({
    isOpen: false,
    email: '',
    isSending: false,
    requestCompleted: false,
    submittedEmail: null,
    isLocalDev: true,
    feedback: null,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailInputModalComponent],
      providers: [
        {
          provide: EmailInputModalService,
          useValue: {
            state$: state$.asObservable(),
            updateEmail: vi.fn(),
            sendPasswordRecoveryEmail: vi.fn(),
            closeModal: vi.fn(),
          },
        },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(EmailInputModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
