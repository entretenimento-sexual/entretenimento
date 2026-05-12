// src/app/chat-module/invite-list/invite-list.component.spec.ts
// Testes do InviteListComponent
//
// Ajustes desta versão:
// - remove expectativas legadas sobre component.invites;
// - remove expectativa legada de LoadInvites neste componente;
// - testa invites$ vindo do NgRx selector atual;
// - testa AcceptInvite / DeclineInvite;
// - mantém AuthSessionService como fonte canônica do UID.

import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { describe, beforeEach, expect, it, Mock, vi } from 'vitest';

import { InviteListComponent } from './invite-list.component';

import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';

import { Invite } from '../../core/interfaces/interfaces-chat/invite.interface';

import {
  AcceptInvite,
  DeclineInvite,
} from '../../store/actions/actions.chat/invite.actions';

import {
  selectInvitesError,
  selectInvitesLoading,
  selectPendingInvites,
  selectPendingInvitesCount,
} from '../../store/selectors/selectors.chat/invite.selectors';

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
    showError: Mock;
  };

  let globalErrorMock: {
    handleError: Mock;
  };

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('u1');

    authSessionMock = {
      uid$: authUidSubject.asObservable(),
      currentAuthUser: { uid: 'u1' },
    };

    errorNotifierMock = {
      showError: vi.fn(),
    };

    globalErrorMock = {
      handleError: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [InviteListComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        provideMockStore({
          selectors: [
            {
              selector: selectPendingInvites,
              value: [] as Invite[],
            },
            {
              selector: selectPendingInvitesCount,
              value: 0,
            },
            {
              selector: selectInvitesLoading,
              value: false,
            },
            {
              selector: selectInvitesError,
              value: null,
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
    vi.spyOn(store, 'dispatch');

    fixture = TestBed.createComponent(InviteListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('deve observar o UID autenticado pela sessão', () => {
    expect(component.userId).toBe('u1');
  });

  it('deve limpar userId quando não houver UID autenticado', () => {
    authUidSubject.next(null);
    fixture.detectChanges();

    expect(component.userId).toBeNull();
  });

  it('deve refletir convites vindos do store via invites$', async () => {
    const invites: Invite[] = [
      { id: 'a1' } as Invite,
      { id: 'a2' } as Invite,
    ];

    store.overrideSelector(selectPendingInvites, invites);
    store.refreshState();

    const result = await firstValueFrom(component.invites$);

    expect(result).toEqual(invites);
  });

  it('deve despachar AcceptInvite ao aceitar convite válido', () => {
    component.userId = 'u1';

    component.respondToInvite({ id: 'invite-1' } as Invite, 'accepted');

    expect(store.dispatch).toHaveBeenCalledWith(
      AcceptInvite({ inviteId: 'invite-1' })
    );
  });

  it('deve despachar DeclineInvite ao recusar convite válido', () => {
    component.userId = 'u1';

    component.respondToInvite({ id: 'invite-2' } as Invite, 'declined');

    expect(store.dispatch).toHaveBeenCalledWith(
      DeclineInvite({ inviteId: 'invite-2' })
    );
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