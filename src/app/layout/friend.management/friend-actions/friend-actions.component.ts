// src/app/layout/friend.management/friend-actions/friend-actions.component.ts
import { ChangeDetectionStrategy, Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, filter, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';

import { FriendBlockedComponent } from '../friend-blocked/friend-blocked.component';
import { FriendListComponent } from '../friend-list/friend-list.component';
import { FriendRequestsComponent } from '../friend-requests/friend-requests.component';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

import {
  sendFriendRequest,
  resetSendFriendRequestStatus,
  loadInboundRequests,   // ✅ em vez de loadRequests
  loadFriends,
} from 'src/app/store/actions/actions.interactions/actions.friends';

import {
  selectFriendRequests,
  // estes três adicionaremos no passo 2
  selectIsSendingFriendRequest,
  selectSendFriendRequestError,
  selectSendFriendRequestSuccess,
} from 'src/app/store/selectors/selectors.interactions/friend.selector';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';

@Component({
  selector: 'app-friend-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SharedMaterialModule,          // ✅ menos repetição
    FriendBlockedComponent,
    FriendListComponent,
    FriendRequestsComponent,
  ],
  templateUrl: './friend-actions.component.html',
  styleUrl: './friend-actions.component.css',
})
export class FriendActionsComponent implements OnInit {
  @Input({ required: true }) user!: IUserDados;

  private store = inject<Store<AppState>>(Store as any);
  private fb = inject(FormBuilder);
  private notifier = inject(ErrorNotificationService);

  form!: FormGroup;

  friendRequests$!: Observable<(FriendRequest & { id: string })[]>; // ✅ tipagem correta
  isSending$!: Observable<boolean>;
  sendError$!: Observable<string | null>;
  sendSuccess$!: Observable<boolean>;

  ngOnInit(): void {
    this.form = this.fb.group({
      friendUid: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(64)]],
      message: ['', [Validators.maxLength(140)]],
    });

    if (!this.user?.uid) return;

    // store selectors
    this.friendRequests$ = this.store.select(selectFriendRequests);
    this.isSending$ = this.store.select(selectIsSendingFriendRequest);
    this.sendError$ = this.store.select(selectSendFriendRequestError);
    this.sendSuccess$ = this.store.select(selectSendFriendRequestSuccess);

    // carregar dados iniciais
    this.store.dispatch(loadFriends({ uid: this.user.uid }));
    this.store.dispatch(loadInboundRequests({ uid: this.user.uid })); // ✅ era loadRequests()

    // feedback de envio
    this.sendSuccess$
      .pipe(takeUntilDestroyed(), filter(Boolean))
      .subscribe(() => {
        this.notifier.showSuccess('Solicitação enviada!');
        this.form.reset();
        this.store.dispatch(loadInboundRequests({ uid: this.user.uid })); // recarrega inbox
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

    // ✅ nomes de props corretos da action:
    this.store.dispatch(sendFriendRequest({
      requesterUid: this.user.uid,
      targetUid: friendUid,
      message,
    }));
  }
}
