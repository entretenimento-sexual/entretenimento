// src/app/layout/friend.management/friend-requests/friend-requests.component.ts
import { Component, OnInit, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { map, Observable } from 'rxjs';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';

// ⬇️ NOVO serviço unificado de amizade
import { FriendshipService } from 'src/app/core/services/interactions/friendship.service';

// ⬇️ NOVAS actions unificadas de amizade
import {
  loadInboundRequests,
  // Se quiser trocar o service por NgRx Effects mais tarde:
  // acceptFriendRequest,
  // declineFriendRequest,
} from '../../../store/actions/actions.interactions/actions.friends';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';

// Modelo
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';

@Component({
  selector: 'app-friend-requests',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatButtonModule, MatCardModule],
  templateUrl: './friend-requests.component.html',
  styleUrl: './friend-requests.component.css',
})
export class FriendRequestsComponent implements OnInit {
  readonly user = input.required<IUserDados>();

  // Se sua store mantém as requests em state.friends.requests:
  friendRequests$!: Observable<(FriendRequest & { id?: string })[]>;

  // Loading “provisório” via CacheService (mantive sua abordagem)
  isLoading$: Observable<boolean> = this.cache.get<boolean>('loadingRequests').pipe(
    map(v => v ?? false)
  );

  constructor(
    private store: Store<AppState>,
    private friendship: FriendshipService,
    private notify: ErrorNotificationService,
    private cache: CacheService,
  ) { }

  ngOnInit(): void {
    const u = this.user();
    if (!u?.uid) return;

    // 🔄 carrega solicitações recebidas do usuário logado
    this.store.dispatch(loadInboundRequests({ uid: u.uid }));

    // Enquanto você não cria novos selectors “friendship.selectors.ts”:
    this.friendRequests$ = this.store.pipe(
      select(s => s.friends.requests as (FriendRequest & { id?: string })[])
    );
  }

  acceptRequest(req: FriendRequest & { id?: string }): void {
    const u = this.user();
    if (!u?.uid || !req?.id || !req?.requesterUid) return;

    this.cache.set('loadingRequests', true, 5000);
    this.friendship.acceptRequest(req.id, req.requesterUid, u.uid).subscribe({
      next: () => {
        this.cache.set('loadingRequests', false);
        this.notify.showSuccess('Solicitação aceita — vocês agora são amigos.');
        this.store.dispatch(loadInboundRequests({ uid: u.uid }));
      },
      error: (err: unknown) => {
        this.cache.set('loadingRequests', false);
        this.notify.showError('Erro ao aceitar solicitação.', (err as any)?.message);
      },
    });

    // ✅ Versão 100% NgRx (quando criar os Effects):
    // this.store.dispatch(acceptFriendRequest({ requestId: req.id, requesterUid: req.requesterUid, targetUid: u.uid }));
  }

  rejectRequest(req: FriendRequest & { id?: string }): void {
    if (!req?.id) return;

    this.cache.set('loadingRequests', true, 5000);
    this.friendship.declineRequest(req.id).subscribe({
      next: () => {
        this.cache.set('loadingRequests', false);
        this.notify.showInfo('Solicitação recusada.');
        const u = this.user();
        if (u?.uid) this.store.dispatch(loadInboundRequests({ uid: u.uid }));
      },
      error: (err: unknown) => {
        this.cache.set('loadingRequests', false);
        this.notify.showError('Erro ao recusar solicitação.', (err as any)?.message);
      },
    });

    // ✅ Versão 100% NgRx (quando criar os Effects):
    // this.store.dispatch(declineFriendRequest({ requestId: req.id }));
  }
}
