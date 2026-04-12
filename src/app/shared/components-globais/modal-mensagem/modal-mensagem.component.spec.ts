// src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { ModalMensagemComponent } from './modal-mensagem.component';
import { ChatService } from '../../../core/services/batepapo/chat-service/chat.service';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../../core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';

import { IUserDados } from '../../../core/interfaces/iuser-dados';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

describe('ModalMensagemComponent', () => {
  let component: ModalMensagemComponent;
  let fixture: ComponentFixture<ModalMensagemComponent>;

  let dialogRefMock: {
    close: Mock;
  };

  let chatServiceMock: {
    getOrCreateChatId: Mock;
    sendMessage: Mock;
    updateChat: Mock;
  };

  let authSessionMock: {
    uid$: Observable<string | null>;
    currentAuthUser: { uid: string; displayName?: string } | null;
  };

  let currentUserStoreMock: {
    user$: Observable<IUserDados | null | undefined>;
  };

  let globalErrorMock: {
    handleError: Mock;
  };

  let errorNotifierMock: {
    showError: Mock;
    showWarning: Mock;
  };

  beforeEach(async () => {
    dialogRefMock = {
      close: vi.fn(),
    };

  chatServiceMock = {
  getOrCreateChatId: vi.fn(),
  sendMessage: vi.fn(),
  updateChat: vi.fn(),
};

    authSessionMock = {
      uid$: of('u1'),
      currentAuthUser: { uid: 'u1', displayName: 'Tester' },
    };

    currentUserStoreMock = {
      user$: of({
        uid: 'u1',
        nickname: 'Tester',
      } as IUserDados),
    };

    globalErrorMock = {
      handleError: vi.fn(),
    };

    errorNotifierMock = {
      showError: vi.fn(),
      showWarning: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [ModalMensagemComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: { profile: { uid: 'u2' } } },

        { provide: AuthSessionService, useValue: authSessionMock },
        { provide: CurrentUserStoreService, useValue: currentUserStoreMock },

        { provide: ChatService, useValue: chatServiceMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ModalMensagemComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
