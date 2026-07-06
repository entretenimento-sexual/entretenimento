// src/app/authentication/email-input-modal/email-input-modal.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { EmailInputModalComponent } from './email-input-modal.component';
import { EmailInputModalService } from '../../core/services/autentication/email-input-modal.service';

describe('EmailInputModalComponent', () => {
  let component: EmailInputModalComponent;
  let fixture: ComponentFixture<EmailInputModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailInputModalComponent],
      providers: [
        {
          provide: EmailInputModalService,
          useValue: {
            isModalOpen: new Subject<boolean>(),
            emailSentMessage: new Subject<string>(),
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
