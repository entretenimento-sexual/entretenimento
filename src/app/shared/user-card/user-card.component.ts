// src/app/shared/user-card/user-card.component.ts
import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';

import { take } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
// abre a DM existente
import { ModalMensagemComponent } from 'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component';

// diálogo de confirmação + mensagem opcional
import { SendRequestDialogComponent } from 'src/app/shared/components-globais/user-card/send-request-dialog/send-request-dialog.component';

@Component({
  selector: 'app-user-card',
  templateUrl: './user-card.component.html',
  styleUrls: ['./user-card.component.css'],
  standalone: true,
  imports: [CommonModule, RouterModule],
})
export class UserCardComponent {
  // Inputs
  readonly user = input.required<IUserDados | null>();
  readonly distanciaKm = input<number | null>(null);

  // Classe do nickname (performático)
  nicknameClass = computed(() => this.getUserNicknameClass(this.user()));

  constructor(
    private dialog: MatDialog,
    private store: Store<AppState>,
    private notifier: ErrorNotificationService,
  ) { }

  ngOnChanges() {
    // debug opcional
    // console.log('User:', this.user());
    // console.log('Distância recebida:', this.distanciaKm());
  }

  // ===== Ações =====

  abrirDM(event: Event): void {
    event.preventDefault();
    const profile = this.user();
    if (!profile) return;

    this.dialog.open(ModalMensagemComponent, {
      width: '400px',
      data: { profile },
    });
  }

  adicionarAmigo(): void {
    const target = this.user();
    if (!target) return;

    this.store.select(selectCurrentUser).pipe(take(1)).subscribe(me => {
      if (!me?.uid) {
        this.notifier.showInfo('É necessário estar logado.');
        return;
      }
      if (target.uid === me.uid) {
        this.notifier.showInfo('Você não pode se adicionar.');
        return;
      }

      const ref = this.dialog.open(SendRequestDialogComponent, {
        panelClass: 'send-request-dialog-panel',
        width: 'min(92vw, 460px)',
        maxWidth: '96vw',
        autoFocus: false,       // evita “pulo” de teclado em mobile
        restoreFocus: true,
        data: {
          requesterUid: me.uid,
          targetUid: target.uid,
          nickname: target.nickname,
          avatarUrl: target.photoURL,
          uid: target.uid,
          maxLength: 200,
        },
      });

      ref.afterClosed().subscribe(res => {
        if (!res) return; // cancelado
        if (res.ok) {
          this.notifier.showSuccess('Solicitação enviada com sucesso.');
        } else if (res.error) {
          // Aqui você pode tratar mensagens específicas vindas do service:
          // 'Vocês já são amigos', 'Você bloqueou este usuário', etc.
          this.notifier.showError(res.error);
        }
      });
    });
  }

  // ===== Aparência =====

  getUserNicknameClass(user: IUserDados | null): string {
    if (!user || !user.lastLogin) return '';

    const toDate = (v: any): Date => {
      if (v instanceof Date) return v;
      if (typeof v === 'number') return new Date(v);
      if (v?.toDate) return v.toDate(); // Firestore Timestamp
      return new Date(v);
    };

    const now = Date.now();
    const last = +toDate(user.lastLogin);
    const days = Math.floor((now - last) / (1000 * 60 * 60 * 24));

    if (user.isOnline) return 'nickname-online';
    if (days <= 7) return 'nickname-recent';
    if (days > 30) return 'nickname-inactive';
    return 'nickname-offline';
  }
}
