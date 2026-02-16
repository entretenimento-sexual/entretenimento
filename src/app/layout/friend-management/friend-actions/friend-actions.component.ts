// src/app/layout/friend-management/friend-actions/friend-actions.component.ts
// Componente para ações relacionadas a amigos: enviar solicitação, ver pedidos recebidos e listar amigos.
// Usa NgRx para gerenciar estado e interações com a store.
// Permite enviar solicitações de amizade com mensagem personalizada.
// Exibe feedback de sucesso/erro usando ErrorNotificationService.
// Inclui ferramentas de debug (logs apenas em dev) e reatividade robusta.
//
// Nota importante (resiliência):
// - Em várias telas, o @Input() user pode chegar depois do ngOnInit (cold start / hidratação do store).
// - Portanto, NÃO fazemos "return" no ngOnInit caso user.uid ainda não exista.
// - Em vez disso, derivamos um uid$ reativo e ligamos dispatch/selectors via switchMap.
import { ChangeDetectionStrategy, Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Store } from '@ngrx/store';

import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, filter, map, switchMap, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';

import { FriendBlockedComponent } from '../friend-blocked/friend-blocked.component';
import { FriendRequestsComponent } from '../friend-requests/friend-requests.component';
import { FriendCardsComponent } from '../friend-cards/friend-cards.component'; // ✅ grid de cards

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

import { selectInboundRequests } from 'src/app/store/selectors/selectors.interactions/friends/inbound.selectors';
import { selectIsSendingFriendRequest } from 'src/app/store/selectors/selectors.interactions/friends/busy.selectors';
import { selectSendFriendRequestError, selectSendFriendRequestSuccess } from 'src/app/store/selectors/selectors.interactions/friends/friends.selectors';

import * as P from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import { selectFriendsPageItems, selectFriendsPageLoading } from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

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
    FriendCardsComponent,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  templateUrl: './friend-actions.component.html',
  styleUrls: ['./friend-actions.component.css'],
})
export class FriendActionsComponent implements OnInit {
  // ---------------------------------------------------------------------------
  // Debug tools (somente em dev/staging)
  // ---------------------------------------------------------------------------
  private readonly debug = !environment.production && !!(environment as any)?.enableDebugTools;
  private dbg(msg: string, extra?: unknown) {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log('[FriendActions]', msg, extra ?? '');
  }

  // ---------------------------------------------------------------------------
  // DI
  // ---------------------------------------------------------------------------
  private store = inject<Store<AppState>>(Store as any);
  private fb = inject(FormBuilder);
  private notifier = inject(ErrorNotificationService);

  // ---------------------------------------------------------------------------
  // Input resiliente
  // ---------------------------------------------------------------------------
  // Importante: o @Input pode chegar depois do ngOnInit.
  // Então transformamos "user" em stream para reagir a mudanças.
  private readonly user$ = new BehaviorSubject<IUserDados | null>(null);

  @Input({ required: true })
  set user(v: IUserDados) {
    this.user$.next(v ?? null);
  }
  // Getter mantém compatibilidade com o template / uso atual.
  get user(): IUserDados {
    return this.user$.value as IUserDados;
  }

  // UID reativo (fonte para dispatch e selectors “fábrica”)
  private readonly uid$ = this.user$.pipe(
    map(u => (u?.uid ?? '').trim() || null),
    distinctUntilChanged(),
    tap(uid => this.dbg('uid$', uid)),
    filter((uid): uid is string => !!uid),
  );

  // ---------------------------------------------------------------------------
  // Form + streams do NgRx
  // ---------------------------------------------------------------------------
  form!: FormGroup;

  // Inbox de solicitações (global; filtra por uid no effect/selector conforme seu slice)
  friendRequests$!: Observable<(FriendRequest & { id: string })[]>;
  isSending$!: Observable<boolean>;
  sendError$!: Observable<string | null>;
  sendSuccess$!: Observable<boolean>;

  // Lista paginada de amigos para alimentar o grid de cards
  friendsItems$!: Observable<any[]>;
  friendsLoading$!: Observable<boolean>;

  ngOnInit(): void {
    // Formulário simples e previsível (UX: validação rápida)
    this.form = this.fb.group({
      friendUid: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(64)]],
      message: ['', [Validators.maxLength(140)]],
    });

    // Selectors globais (não dependem do uid para existir)
    this.friendRequests$ = this.store.select(selectInboundRequests);
    this.isSending$ = this.store.select(selectIsSendingFriendRequest);
    this.sendError$ = this.store.select(selectSendFriendRequestError);
    this.sendSuccess$ = this.store.select(selectSendFriendRequestSuccess);

    // -----------------------------------------------------------------------
    // Bootstrap reativo por UID
    // - Carrega inbox e primeira página assim que uid existir.
    // - Se uid mudar (troca de conta), reexecuta corretamente.
    // -----------------------------------------------------------------------
    this.uid$
      .pipe(takeUntilDestroyed())
      .subscribe((uid) => {
        this.dbg('dispatch bootstrap', { uid });

        // Primeira página do grid (ex.: 12 itens)
        this.store.dispatch(P.loadFriendsFirstPage({ uid, pageSize: 12 }));

        // Inbox de pedidos recebidos
        this.store.dispatch(loadInboundRequests({ uid }));
      });

    // Selectors “fábrica” ligados reativamente ao UID
    this.friendsItems$ = this.uid$.pipe(
      switchMap(uid => this.store.select(selectFriendsPageItems(uid))),
      tap(items => this.dbg('friendsItems$', { count: items?.length ?? 0 })),
    );

    this.friendsLoading$ = this.uid$.pipe(
      switchMap(uid => this.store.select(selectFriendsPageLoading(uid))),
      tap(loading => this.dbg('friendsLoading$', loading)),
    );

    // -----------------------------------------------------------------------
    // Feedback de envio (sucesso/erro)
    // - Reset do status evita “toasts repetidos” em reentradas.
    // -----------------------------------------------------------------------
    this.sendSuccess$
      .pipe(takeUntilDestroyed(), filter(Boolean))
      .subscribe(() => {
        this.notifier.showSuccess('Solicitação enviada!');
        this.form.reset();

        const uid = (this.user?.uid ?? '').trim();
        if (uid) this.store.dispatch(loadInboundRequests({ uid }));

        this.store.dispatch(resetSendFriendRequestStatus());
      });

    this.sendError$
      .pipe(takeUntilDestroyed(), filter((e): e is string => !!e))
      .subscribe((msg) => {
        this.notifier.showError('Erro ao enviar solicitação.', msg);
        this.store.dispatch(resetSendFriendRequestStatus());
      });
  }

  // ---------------------------------------------------------------------------
  // Handler: envio de solicitação
  // ---------------------------------------------------------------------------
  // Mantemos o nome do método "send()" para não quebrar template/contrato.
  send(): void {
    const requesterUid = (this.user?.uid ?? '').trim();
    if (!requesterUid) {
      // Não notifica agressivamente aqui: tela pode estar em cold start.
      this.dbg('send() bloqueado: requesterUid ausente');
      return;
    }

    if (this.form.invalid) {
      this.notifier.showInfo('Verifique os campos do formulário.');
      this.form.markAllAsTouched();
      return;
    }

    const friendUid = (this.form.value.friendUid as string).trim();
    const message = ((this.form.value.message as string) || '').trim();

    // Regras simples para reduzir envio inválido e ruído no backend
    if (friendUid === requesterUid) {
      this.notifier.showInfo('Você não pode enviar solicitação para si mesmo.');
      return;
    }
    if (/[\n\r\t]/.test(message)) {
      this.notifier.showInfo('A mensagem não pode conter quebras de linha.');
      return;
    }

    this.dbg('dispatch sendFriendRequest', { requesterUid, targetUid: friendUid });

    // Ação → Effects/Services fazem o restante (e tratam erros centralizados)
    this.store.dispatch(sendFriendRequest({
      requesterUid,
      targetUid: friendUid,
      message,
    }));
  }
}
