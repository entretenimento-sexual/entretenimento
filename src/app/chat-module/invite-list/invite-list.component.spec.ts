// src/app/chat-module/invite-list/invite-list.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { InviteInboxItem } from '../../core/interfaces/interfaces-chat/invite.interface';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
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
import { InviteListComponent } from './invite-list.component';

function buildInvite(id: string, receiverId = 'u1'): InviteInboxItem {
  return {
    id,
    type: 'room',
    targetId: 'room-1',
    targetName: 'Sala de teste',
    senderId: 'sender-1',
    receiverId,
    status: 'pending',
    sentAtMs: 1000,
    expiresAtMs: 2000,
    roomId: 'room-1',
    roomName: 'Sala de teste',
  };
}

describe('InviteListComponent', () => {
  let component: InviteListComponent;
  let fixture: ComponentFixture<InviteListComponent>;
  let store: MockStore;
  let authUidSubject: BehaviorSubject<string | null>;
  let errorNotifierMock: { showError: Mock };

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('u1');
    errorNotifierMock = { showError: vi.fn() };

    await TestBed.configureTestingModule({
      declarations: [InviteListComponent],
      imports: [CommonModule, RouterTestingModule],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectPendingInvites, value: [] },
            { selector: selectPendingInvitesCount, value: 0 },
            { selector: selectInvitesLoading, value: false },
            { selector: selectInvitesError, value: null },
          ],
        }),
        {
          provide: AuthSessionService,
          useValue: { uid$: authUidSubject.asObservable() },
        },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');

    fixture = TestBed.createComponent(InviteListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar e observar o UID autenticado', () => {
    expect(component).toBeTruthy();
    expect(component.userId).toBe('u1');
  });

  it('deve limpar userId quando não houver sessão', () => {
    authUidSubject.next(null);
    fixture.detectChanges();
    expect(component.userId).toBeNull();
  });

  it('deve refletir a projeção serializável do Store', async () => {
    const invites = [buildInvite('invite-1'), buildInvite('invite-2')];

    store.overrideSelector(selectPendingInvites, invites);
    store.refreshState();

    await expect(firstValueFrom(component.invites$)).resolves.toEqual(invites);
  });

  it('despacha AcceptInvite com ownerUid', () => {
    component.respondToInvite(buildInvite('invite-1'), 'accepted');

    expect(store.dispatch).toHaveBeenCalledWith(
      AcceptInvite({ ownerUid: 'u1', inviteId: 'invite-1' })
    );
  });

  it('despacha DeclineInvite com ownerUid', () => {
    component.respondToInvite(buildInvite('invite-2'), 'declined');

    expect(store.dispatch).toHaveBeenCalledWith(
      DeclineInvite({ ownerUid: 'u1', inviteId: 'invite-2' })
    );
  });

  it('bloqueia convite pertencente a outra conta', () => {
    component.respondToInvite(buildInvite('invite-1', 'u2'), 'accepted');

    expect(store.dispatch).not.toHaveBeenCalled();
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Erro ao processar resposta ao convite.'
    );
  });

  it('não expõe UID bruto no subtítulo', () => {
    expect(component.getInviteSubtitle(buildInvite('invite-1'))).toBe(
      'Você foi convidado para participar'
    );
  });
});
