// src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.spec.ts

import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { DirectChatAvailabilityService } from 'src/app/messaging/direct-chat/services/direct-chat-availability.service';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { ModalMensagemComponent } from './modal-mensagem.component';

import { DirectChatService } from '../../../messaging/direct-chat/services/direct-chat.service';
import { DirectThreadService } from '../../../messaging/direct-chat/services/direct-thread.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';

describe('ModalMensagemComponent', () => {
  let component: ModalMensagemComponent;
  let available$: BehaviorSubject<boolean>;
  let fixture: ComponentFixture<ModalMensagemComponent>;

  let dialogRefMock: {
    close: Mock;
    disableClose: boolean;
  };

  let directChatServiceMock: {
    ensureDirectChatIdWithUser$: Mock;
  };

  let directThreadServiceMock: {
    sendMessage$: Mock;
  };

  let globalErrorMock: {
    handleError: Mock;
  };

  let errorNotifierMock: {
    showError: Mock;
    showWarning: Mock;
    showSuccess: Mock;
  };

  beforeEach(async () => {
    available$ = new BehaviorSubject(true);
    dialogRefMock = {
      close: vi.fn(),
      disableClose: false,
    };

    directChatServiceMock = {
      ensureDirectChatIdWithUser$: vi.fn().mockReturnValue(of('chat-1')),
    };

    directThreadServiceMock = {
      sendMessage$: vi.fn().mockReturnValue(of('message-1')),
    };

    globalErrorMock = {
      handleError: vi.fn(),
    };

    errorNotifierMock = {
      showError: vi.fn(),
      showWarning: vi.fn(),
      showSuccess: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [ModalMensagemComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: DirectChatAvailabilityService, useValue: { observeForCurrentUser$: () => available$ } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { profile: { uid: 'u2', nickname: 'Perfil' } },
        },
        { provide: DirectChatService, useValue: directChatServiceMock },
        { provide: DirectThreadService, useValue: directThreadServiceMock },
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

  it('revoga composição e descarta abertura pendente após perder acesso bilateral', () => {
    const pending = new Subject<string>();
    directChatServiceMock.ensureDirectChatIdWithUser$.mockReturnValue(pending);
    component.mensagem = 'Olá';
    component.enviarMensagem();
    expect(component.isSending()).toBe(true);
    available$.next(false);
    expect(component.canSend()).toBe(false);
    expect(component.isSending()).toBe(false);
    pending.next('chat-1');
    expect(directThreadServiceMock.sendMessage$).not.toHaveBeenCalled();
    component.enviarMensagem();
    expect(directChatServiceMock.ensureDirectChatIdWithUser$).toHaveBeenCalledTimes(1);
    available$.next(true);
    expect(component.canSend()).toBe(true);
  });
});