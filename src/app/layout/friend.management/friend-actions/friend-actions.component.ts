// src/app/layout/friend.management/friend-actions/friend-actions.component.ts
import { ChangeDetectionStrategy, Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';

import { FriendBlockedComponent } from '../friend-blocked/friend-blocked.component';
import { FriendRequestsComponent } from '../friend-requests/friend-requests.component';
import { FriendCardsComponent } from '../friend-cards/friend-cards.component'; // ✅ usa cards

import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

import {
  sendFriendRequest,
  resetSendFriendRequestStatus,
  loadInboundRequests,
} from 'src/app/store/actions/actions.interactions/actions.friends';

import {
  selectInboundRequests,
} from 'src/app/store/selectors/selectors.interactions/friends/inbound.selectors';

import {
  selectIsSendingFriendRequest,
} from 'src/app/store/selectors/selectors.interactions/friends/busy.selectors';

import {
  selectSendFriendRequestError,
  selectSendFriendRequestSuccess,
} from 'src/app/store/selectors/selectors.interactions/friends/friends.selectors';

import * as P from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import {
  selectFriendsPageItems,
  selectFriendsPageLoading,
} from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-friend-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SharedMaterialModule,
    FriendBlockedComponent,
    FriendRequestsComponent,
    FriendCardsComponent,            // ✅ importa o componente de cards
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './friend-actions.component.html',
  styleUrls: ['./friend-actions.component.css'],
})
export class FriendActionsComponent implements OnInit {
  @Input({ required: true }) user!: IUserDados;

  private store = inject<Store<AppState>>(Store as any);
  private fb = inject(FormBuilder);
  private notifier = inject(ErrorNotificationService);

  form!: FormGroup;

  friendRequests$!: Observable<(FriendRequest & { id: string })[]>;
  isSending$!: Observable<boolean>;
  sendError$!: Observable<string | null>;
  sendSuccess$!: Observable<boolean>;

  // ✅ Observables para alimentar o card grid
  friendsItems$!: Observable<any[]>;
  friendsLoading$!: Observable<boolean>;

  ngOnInit(): void {
    this.form = this.fb.group({
      friendUid: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(64)]],
      message: ['', [Validators.maxLength(140)]],
    });

    if (!this.user?.uid) return;

    // Inbox de solicitações
    this.friendRequests$ = this.store.select(selectInboundRequests);
    this.isSending$ = this.store.select(selectIsSendingFriendRequest);
    this.sendError$ = this.store.select(selectSendFriendRequestError);
    this.sendSuccess$ = this.store.select(selectSendFriendRequestSuccess);

    // ✅ Carrega a 1ª página da lista de amigos para este UID (ex.: 12 itens)
    this.store.dispatch(P.loadFriendsFirstPage({ uid: this.user.uid, pageSize: 12 }));
    // Inbox de pedidos recebidos
    this.store.dispatch(loadInboundRequests({ uid: this.user.uid }));

    // ✅ Liga selectors “fábrica” ao UID deste componente
    this.friendsItems$ = this.store.select(selectFriendsPageItems(this.user.uid));
    this.friendsLoading$ = this.store.select(selectFriendsPageLoading(this.user.uid));

    // feedback de envio
    this.sendSuccess$
      .pipe(takeUntilDestroyed(), filter(Boolean))
      .subscribe(() => {
        this.notifier.showSuccess('Solicitação enviada!');
        this.form.reset();
        this.store.dispatch(loadInboundRequests({ uid: this.user.uid }));
        this.store.dispatch(resetSendFriendRequestStatus());
      });

    this.sendError$
      .pipe(takeUntilDestroyed(), filter((e): e is string => !!e))
      .subscribe((msg) => {
        this.notifier.showError('Erro ao enviar solicitação.', msg);
        this.store.dispatch(resetSendFriendRequestStatus());
      });
  }

  send(): void {
    if (!this.user?.uid) return;
    if (this.form.invalid) {
      this.notifier.showInfo('Verifique os campos do formulário.');
      this.form.markAllAsTouched();
      return;
    }

    const friendUid = (this.form.value.friendUid as string).trim();
    const message = ((this.form.value.message as string) || '').trim();

    if (friendUid === this.user.uid) {
      this.notifier.showInfo('Você não pode enviar solicitação para si mesmo.');
      return;
    }
    if (/[\n\r\t]/.test(message)) {
      this.notifier.showInfo('A mensagem não pode conter quebras de linha.');
      return;
    }

    this.store.dispatch(sendFriendRequest({
      requesterUid: this.user.uid,
      targetUid: friendUid,
      message,
    }));
  }
}
