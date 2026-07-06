// src/app/chat-module/chat-message/chat-message.component.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';

import { ChatMessageComponent } from './chat-message.component';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';

describe('ChatMessageComponent', () => {
  let fixture: ComponentFixture<ChatMessageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ChatMessageComponent],
      providers: [
        { provide: Firestore, useValue: {} },
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getUser$: vi.fn(() => of({ uid: 'u1', nickname: 'Eu' })),
            getPublicUserById$: vi.fn(() => of({ uid: 'u2', nickname: 'Outro' })),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: of('u1'),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: {
            log: vi.fn(),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatMessageComponent);
    const comp = fixture.componentInstance;
    comp.currentUserUid = 'u1';
    fixture.componentRef.setInput('message', {
      senderId: 'u1',
      content: 'hi',
      timestamp: { toDate: () => new Date() },
    } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
