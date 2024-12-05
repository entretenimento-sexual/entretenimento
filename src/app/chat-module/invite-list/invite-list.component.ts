// src\app\chat-module\invite-list\invite-list.component.ts
import { Component, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { LoadInvites, UpdateInviteStatus } from 'src/app/store/actions/actions.chat/invite.actions';
import { selectInvites } from 'src/app/store/selectors/selectors.chat/invite.selectors';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-invite-list',
  templateUrl: './invite-list.component.html',
  styleUrls: ['./invite-list.component.css'],
  standalone: false
})

export class InviteListComponent implements OnInit {
  invites: Invite[] = [];
  userId: string | null = null;

  constructor(
    private authService: AuthService,
    private store: Store<AppState>,
    private errorNotifier: ErrorNotificationService
  ) { }

  ngOnInit(): void {
    this.authService.user$.subscribe({
      next: (user) => {
        if (user?.uid) {
          this.userId = user.uid;
          this.loadInvites(user.uid);
        } else {
          this.errorNotifier.showError('Usuário não autenticado.');
        }
      },
      error: () => this.errorNotifier.showError('Erro ao carregar dados do usuário.')
    });

    this.store.select(selectInvites).subscribe({
      next: (invites) => {
        this.invites = invites;
        console.log('Convites carregados:', invites);
      },
      error: () => this.errorNotifier.showError('Erro ao carregar convites do estado.')
    });
  }

  loadInvites(userId: string): void {
    this.store.dispatch(LoadInvites({ userId }));
  }

  respondToInvite(invite: Invite, status: 'accepted' | 'declined'): void {
    if (!this.userId || !invite.id) {
      this.errorNotifier.showError('Erro ao processar resposta ao convite.');
      return;
    }

    this.store.dispatch(
      UpdateInviteStatus({
        roomId: invite.roomId || 'default-room-id', // Substituir por lógica real
        inviteId: invite.id,
        status
      })
    );
  }
}
