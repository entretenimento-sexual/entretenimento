// src/app/chat-module/rooms/room-interaction/room-interaction.component.spec.ts
// Testes do RoomInteractionComponent
//
// Ajustes desta revisão:
// - convertido de Jasmine para Jest para alinhar com o runner atual do projeto
// - mantém AuthSessionService + CurrentUserStoreService como fontes canônicas
// - mantém mock de RoomParticipantsService restrito às responsabilidades atuais:
//   1) getParticipants()
//   2) getRoomCreator()
// - mantém GlobalErrorHandlerService e ErrorNotificationService
// - mantém o input obrigatório roomId antes do detectChanges
//
// Observação:
// - esta revisão não altera o comportamento esperado do spec;
// - ela apenas ajusta o arquivo ao ambiente de testes realmente usado no projeto.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { describe, beforeEach, it, expect, vi, type Mock, afterEach } from 'vitest';

import { RoomInteractionComponent } from './room-interaction.component';

import { RoomParticipantsService } from '../../../core/services/batepapo/room-services/room-participants.service';
import { RoomMessagesService } from '../../../core/services/batepapo/room-services/room-messages.service';
import { RoomService } from '../../../core/services/batepapo/room-services/room.service';

import { FirestoreUserQueryService } from '../../../core/services/data-handling/firestore-user-query.service';
import { FirestoreQueryService } from '../../../core/services/data-handling/firestore-query.service';

import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';

import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../../core/services/autentication/auth/current-user-store.service';

describe('RoomInteractionComponent', () => {
  let component: RoomInteractionComponent;
  let fixture: ComponentFixture<RoomInteractionComponent>;

  let authUidSubject: BehaviorSubject<string | null>;
  let currentUserSubject: BehaviorSubject<any>;

  let roomParticipantsServiceMock: {
    getParticipants: Mock;
    getRoomCreator: Mock;
  };

  let roomMessagesServiceMock: {
    getRoomMessages: Mock;
    markDeliveredAsRead$: Mock;
    sendMessageToRoom$: Mock;
  };

  let roomServiceMock: {
    getRoomById: Mock;
  };

  let firestoreUserQueryMock: {
    getUser: Mock;
  };

  let firestoreQueryMock: {
    getUserFromState: Mock;
  };

  let errorNotifierMock: {
    showError: Mock;
    showWarning: Mock;
  };

  let globalErrorMock: {
    handleError: Mock;
  };

  let authSessionMock: {
    uid$: any;
    currentAuthUser: { uid: string } | null;
  };

  let currentUserStoreMock: {
    user$: any;
  };

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('u1');
    currentUserSubject = new BehaviorSubject<any>({
      uid: 'u1',
      nickname: 'Tester',
    });

    roomParticipantsServiceMock = {
      getParticipants: vi.fn().mockReturnValue(of([])),
      getRoomCreator: vi.fn().mockReturnValue(of(null)),
    };

    roomMessagesServiceMock = {
      getRoomMessages: vi.fn().mockReturnValue(of([])),
      markDeliveredAsRead$: vi.fn().mockReturnValue(of(0)),
      sendMessageToRoom$: vi.fn().mockReturnValue(of('msg-1')),
    };

    roomServiceMock = {
      getRoomById: vi.fn().mockReturnValue(
        of({ roomName: 'Sala X' } as any)
      ),
    };

    firestoreUserQueryMock = {
      getUser: vi.fn().mockReturnValue(of(null)),
    };

    firestoreQueryMock = {
      getUserFromState: vi.fn().mockReturnValue(of(null)),
    };

    errorNotifierMock = {
      showError: vi.fn(),
      showWarning: vi.fn(),
    };

    globalErrorMock = {
      handleError: vi.fn(),
    };

    authSessionMock = {
      uid$: authUidSubject.asObservable(),
      currentAuthUser: { uid: 'u1' },
    };

    currentUserStoreMock = {
      user$: currentUserSubject.asObservable(),
    };

    await TestBed.configureTestingModule({
      declarations: [RoomInteractionComponent],
      imports: [],
      providers: [
        { provide: AuthSessionService, useValue: authSessionMock },
        { provide: CurrentUserStoreService, useValue: currentUserStoreMock },

        { provide: RoomParticipantsService, useValue: roomParticipantsServiceMock },
        { provide: RoomMessagesService, useValue: roomMessagesServiceMock },
        { provide: RoomService, useValue: roomServiceMock },

        { provide: FirestoreUserQueryService, useValue: firestoreUserQueryMock },
        { provide: FirestoreQueryService, useValue: firestoreQueryMock },

        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(RoomInteractionComponent);
    fixture.componentRef.setInput('roomId', 'room-1');
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deve carregar o nome da sala no init', () => {
    expect(roomServiceMock.getRoomById).toHaveBeenCalledWith('room-1');
    expect(component.roomName).toBe('Sala X');
  });

  it('deve observar o usuário atual corretamente', () => {
    expect(component.currentUser).toEqual({
      uid: 'u1',
      nickname: 'Tester',
    });
  });

  it('deve carregar mensagens no init', () => {
    expect(roomMessagesServiceMock.getRoomMessages).toHaveBeenCalledWith('room-1');
    expect(component.messages).toEqual([]);
  });

  it('deve carregar participantes no init', () => {
    expect(roomParticipantsServiceMock.getParticipants).toHaveBeenCalledWith('room-1');
    expect(component.participants).toEqual([]);
  });

  it('deve carregar criador da sala no init', () => {
    expect(roomParticipantsServiceMock.getRoomCreator).toHaveBeenCalledWith('room-1');
    expect(component.creatorDetails).toBeNull();
  });

  it('deve mostrar warning ao tentar enviar mensagem vazia', () => {
    component.messageContent = '   ';

    component.sendMessage();

    expect(errorNotifierMock.showWarning).toHaveBeenCalledWith(
      'Mensagem vazia. Não será enviada.'
    );
    expect(roomMessagesServiceMock.sendMessageToRoom$).not.toHaveBeenCalled();
  });

  it('deve enviar mensagem quando houver conteúdo e usuário autenticado', () => {
    component.messageContent = 'Olá sala';

    component.sendMessage();

    expect(roomMessagesServiceMock.sendMessageToRoom$).toHaveBeenCalled();
    expect(component.messageContent).toBe('');
  });

  it('deve mostrar erro ao enviar mensagem sem uid autenticado', () => {
    authUidSubject.next(null);
    currentUserSubject.next(null);

    component.messageContent = 'Teste';

    component.sendMessage();

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Erro ao enviar mensagem.'
    );
  });
});