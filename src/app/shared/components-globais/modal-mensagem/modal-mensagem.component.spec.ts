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

describe('ModalMensagemComponent', () => {
  let component: ModalMensagemComponent;
  let fixture: ComponentFixture<ModalMensagemComponent>;

  let dialogRefMock: {
    close: jasmine.Spy;
  };

  let chatServiceMock: {
    getOrCreateChatId: jasmine.Spy;
    sendMessage: jasmine.Spy;
    updateChat: jasmine.Spy;
  };

  let authSessionMock: {
    uid$: Observable<string | null>;
    currentAuthUser: { uid: string; displayName?: string } | null;
  };

  let currentUserStoreMock: {
    user$: Observable<IUserDados | null | undefined>;
  };

  let globalErrorMock: {
    handleError: jasmine.Spy;
  };

  let errorNotifierMock: {
    showError: jasmine.Spy;
    showWarning: jasmine.Spy;
  };

  beforeEach(async () => {
    dialogRefMock = {
      close: jasmine.createSpy('close'),
    };

    chatServiceMock = {
      getOrCreateChatId: jasmine.createSpy('getOrCreateChatId').and.returnValue(of('chat-1')),
      sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of(void 0)),
      updateChat: jasmine.createSpy('updateChat').and.returnValue(of(void 0)),
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
      handleError: jasmine.createSpy('handleError'),
    };

    errorNotifierMock = {
      showError: jasmine.createSpy('showError'),
      showWarning: jasmine.createSpy('showWarning'),
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
