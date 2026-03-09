// src/app/chat-module/invite-list/invite-list.component.spec.ts
// Testes do InviteListComponent
//
// Ajustes desta versão:

// - adiciona MockStore para o selectInvites
// - adiciona mocks de ErrorNotificationService e GlobalErrorHandlerService
// - usa BehaviorSubject para simular uid$
// - evita typings problemáticos com SpyObj<Service>

import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { InviteListComponent } from './invite-list.component';

import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';

import { LoadInvites } from '../../store/actions/actions.chat/invite.actions';
import { selectInvites } from '../../store/selectors/selectors.chat/invite.selectors';
import { Invite } from '../../core/interfaces/interfaces-chat/invite.interface';

describe('InviteListComponent', () => {
  let component: InviteListComponent;
  let fixture: ComponentFixture<InviteListComponent>;
  let store: MockStore;

  let authUidSubject: BehaviorSubject<string | null>;

  let authSessionMock: {
    uid$: any;
    currentAuthUser?: { uid: string } | null;
  };

  let errorNotifierMock: {
    showError: jasmine.Spy;
  };

  let globalErrorMock: {
    handleError: jasmine.Spy;
  };

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('u1');

    authSessionMock = {
      uid$: authUidSubject.asObservable(),
      currentAuthUser: { uid: 'u1' },
    };

    errorNotifierMock = {
      showError: jasmine.createSpy('showError'),
    };

    globalErrorMock = {
      handleError: jasmine.createSpy('handleError'),
    };

    await TestBed.configureTestingModule({
      declarations: [InviteListComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        provideMockStore({
          selectors: [
            {
              selector: selectInvites,
              value: [] as Invite[],
            },
          ],
        }),
        { provide: AuthSessionService, useValue: authSessionMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');

    fixture = TestBed.createComponent(InviteListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deve carregar convites quando houver UID autenticado', () => {
    expect(store.dispatch).toHaveBeenCalledWith(
      LoadInvites({ userId: 'u1' })
    );
    expect(component.userId).toBe('u1');
  });

  it('deve limpar convites locais quando não houver UID autenticado', () => {
    component.invites = [
      { id: 'i1' } as Invite,
      { id: 'i2' } as Invite,
    ];

    authUidSubject.next(null);
    fixture.detectChanges();

    expect(component.userId).toBeNull();
    expect(component.invites).toEqual([]);
  });

  it('deve refletir convites vindos do store', () => {
    const invites: Invite[] = [
      { id: 'a1' } as Invite,
      { id: 'a2' } as Invite,
    ];

    store.overrideSelector(selectInvites, invites);
    store.refreshState();
    fixture.detectChanges();

    expect(component.invites).toEqual(invites);
  });

  it('deve mostrar erro ao responder convite sem userId', () => {
    component.userId = null;

    component.respondToInvite({ id: 'invite-1' } as Invite, 'accepted');

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Erro ao processar resposta ao convite.'
    );
  });

  it('deve mostrar erro ao responder convite sem invite.id', () => {
    component.userId = 'u1';

    component.respondToInvite({} as Invite, 'declined');

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Erro ao processar resposta ao convite.'
    );
  });
});
