//src\app\shared\user-card\user-card.component.ts
import { Component, input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { ModalMensagemComponent } from '../components-globais/modal-mensagem/modal-mensagem.component';
import { MatDialog } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AppState } from 'src/app/store/states/app.state';
import { Store } from '@ngrx/store';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { sendFriendRequest } from 'src/app/store/actions/actions.interactions/actions.friends';
import { take } from 'rxjs/operators';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';

@Component({
    selector: 'app-user-card',
    templateUrl: './user-card.component.html',
    styleUrls: ['./user-card.component.css'],
    providers: [DateFormatPipe],
    standalone: true,
    imports: [CommonModule, RouterModule]
})
export class UserCardComponent {
  readonly user = input.required<IUserDados | null>();
  readonly distanciaKm = input<number | null>(null);

  constructor(private dateFormatPipe: DateFormatPipe,
              private dialog: MatDialog,
              private store: Store<AppState>,
              private errorNotifier: ErrorNotificationService,
              ) { }

  ngOnChanges() {
    console.log('User:', this.user());
    console.log('Distância recebida:', this.distanciaKm());
  }


  abrirModal(event: Event): void {
    event.preventDefault(); // Evita que o link navegue para outra página


    const user = this.user();
    if (user) {
      this.dialog.open(ModalMensagemComponent, {
        width: '400px',
        data: { profile: user }
      });
    }
  }

  adicionarAmigo(): void {
    const target = this.user();
    if (!target) return;

    this.store.select(selectCurrentUser).pipe(take(1)).subscribe(me => {
      if (!me?.uid) {
        this.errorNotifier.showInfo('É necessário estar logado.');
        return;
      }
      if (target.uid === me.uid) {
        this.errorNotifier.showInfo('Você não pode se adicionar.');
        return;
      }
      this.store.dispatch(sendFriendRequest({ requesterUid: me.uid, targetUid: target.uid }));
    });
  }

  getUserNicknameClass(user: IUserDados | null): string {
    if (!user || !user.lastLogin) return '';

    const toDate = (v: any): Date => {
      if (v instanceof Date) return v;
      if (typeof v === 'number') return new Date(v);
      if (v?.toDate) return v.toDate(); // Timestamp do Firestore
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

