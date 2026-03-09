// src/app/chat-module/rooms/room-interaction/room-interaction.component.spec.ts
// Testes do RoomInteractionComponent
//
// Ajustes desta versão:
// - usa AuthSessionService + CurrentUserStoreService
// - evita SpyObj<Service> para não colidir com as assinaturas concretas do projeto
// - adiciona mocks para markDeliveredAsRead$ e sendMessageToRoom$
// - adiciona GlobalErrorHandlerService
// - mantém o input obrigatório roomId antes do detectChanges

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of } from 'rxjs';

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
    getParticipants: jasmine.Spy;
    getRoomCreator: jasmine.Spy;
  };

  let roomMessagesServiceMock: {
    getRoomMessages: jasmine.Spy;
    markDeliveredAsRead$: jasmine.Spy;
    sendMessageToRoom$: jasmine.Spy;
  };

  let roomServiceMock: {
    getRoomById: jasmine.Spy;
  };

  let firestoreUserQueryMock: {
    getUser: jasmine.Spy;
  };

  let firestoreQueryMock: {
    getUserFromState: jasmine.Spy;
  };

  let errorNotifierMock: {
    showError: jasmine.Spy;
    showWarning: jasmine.Spy;
  };

  let globalErrorMock: {
    handleError: jasmine.Spy;
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
      getParticipants: jasmine.createSpy('getParticipants').and.returnValue(of([])),
      getRoomCreator: jasmine.createSpy('getRoomCreator').and.returnValue(of(null)),
    };

    roomMessagesServiceMock = {
      getRoomMessages: jasmine.createSpy('getRoomMessages').and.returnValue(of([])),
      markDeliveredAsRead$: jasmine.createSpy('markDeliveredAsRead$').and.returnValue(of(0)),
      sendMessageToRoom$: jasmine.createSpy('sendMessageToRoom$').and.returnValue(of('msg-1')),
    };

    roomServiceMock = {
      getRoomById: jasmine.createSpy('getRoomById').and.returnValue(
        of({ roomName: 'Sala X' } as any)
      ),
    };

    firestoreUserQueryMock = {
      getUser: jasmine.createSpy('getUser').and.returnValue(of(null)),
    };

    firestoreQueryMock = {
      getUserFromState: jasmine.createSpy('getUserFromState').and.returnValue(of(null)),
    };

    errorNotifierMock = {
      showError: jasmine.createSpy('showError'),
      showWarning: jasmine.createSpy('showWarning'),
    };

    globalErrorMock = {
      handleError: jasmine.createSpy('handleError'),
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
      imports: [CommonModule, RouterTestingModule],
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
