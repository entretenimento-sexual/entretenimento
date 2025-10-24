// src/app/shared/components-globais/user-card/detailed-user-card/detailed-user-card.component.ts
import { Component, input, inject } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { BaseUserCardComponent } from '../base-user-card/base-user-card.component';
import { MatDialog } from '@angular/material/dialog';
import { SendRequestDialogComponent } from '../send-request-dialog/send-request-dialog.component';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import * as A from 'src/app/store/actions/actions.interactions/actions.friends';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';
import { filter, firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-detailed-user-card',
  standalone: true,
  imports: [BaseUserCardComponent, MatButtonModule],
  templateUrl: './detailed-user-card.component.html',
  styleUrl: './detailed-user-card.component.css'
})
export class DetailedUserCardComponent {
  readonly user = input.required<IUserDados>();

  private dialog = inject(MatDialog);
  private store = inject(Store<AppState>);

  sendMessage(user: IUserDados): void {
    // seu ModalMensagemComponent de chat continua como está
    // this.dialog.open(ModalMensagemComponent, { width: '400px', data: { profile: user } });
  }

  async sendFriendRequest(user: IUserDados): Promise<void> {
    const me = await firstValueFrom(this.store.select(selectCurrentUserUid).pipe(filter(Boolean)));
    if (!me || !user?.uid) return;

    const ref = this.dialog.open(SendRequestDialogComponent, {
      width: '420px',
      data: { nickname: user.nickname },
      autoFocus: false
    });

    const result: { message?: string } | null = await firstValueFrom(ref.afterClosed());
    if (!result) return; // cancelado

    this.store.dispatch(A.sendFriendRequest({
      requesterUid: me,
      targetUid: user.uid,
      message: result.message
    }));
  }
}
