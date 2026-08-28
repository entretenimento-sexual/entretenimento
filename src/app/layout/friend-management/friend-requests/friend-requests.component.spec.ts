// src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import * as A from 'src/app/store/actions/actions.interactions/actions.friends';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';
import { selectRequestsLoading } from 'src/app/store/selectors/selectors.interactions/friends/inbound.selectors';
import {
  selectCancelingOutboundRequestIds,
  selectOutboundRequestsLoading,
} from 'src/app/store/selectors/selectors.interactions/friends/outbound.selectors';
import {
  selectInboundRequestsCount,
  selectInboundRequestsRichVM,
  selectOutboundRequestsCount,
  selectOutboundRequestsRichVM,
} from 'src/app/store/selectors/selectors.interactions/friends';

import { FriendRequestsComponent } from './friend-requests.component';

describe('FriendRequestsComponent', () => {
  let fixture: ComponentFixture<FriendRequestsComponent>;
  let store: MockStore;

  const dialogOpen = vi.fn(() => ({
    afterClosed: () => of(true),
  }));

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [FriendRequestsComponent],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCurrentUserUid, value: 'owner-1' },
            { selector: selectInboundRequestsRichVM, value: [] },
            { selector: selectOutboundRequestsRichVM, value: [] },
            { selector: selectInboundRequestsCount, value: 0 },
            { selector: selectOutboundRequestsCount, value: 0 },
            { selector: selectRequestsLoading, value: false },
            { selector: selectOutboundRequestsLoading, value: false },
            { selector: selectCancelingOutboundRequestIds, value: [] },
          ],
        }),
        {
          provide: MatDialog,
          useValue: { open: dialogOpen },
        },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(FriendRequestsComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('mantém cabeçalho enxuto sem resumo duplicado', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe(
      'Solicitações de amizade'
    );
    expect(element.querySelector('.friend-requests__summary')).toBeNull();
    expect(element.querySelector('.friend-requests__eyebrow')).toBeNull();
    expect(element.querySelector('.friend-requests')?.hasAttribute('aria-live')).toBe(
      false
    );
  });

  it('bloqueia somente após confirmação no diálogo da plataforma', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');

    await fixture.componentInstance.blockUser({
      requesterUid: 'target-1',
      nickname: 'Perfil teste',
    });

    expect(dialogOpen).toHaveBeenCalledWith(
      ConfirmacaoDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Bloquear usuário?',
          confirmLabel: 'Bloquear',
          tone: 'danger',
        }),
      })
    );
    expect(dispatch).toHaveBeenCalledWith(
      A.blockUser({ ownerUid: 'owner-1', targetUid: 'target-1' })
    );
  });
});
