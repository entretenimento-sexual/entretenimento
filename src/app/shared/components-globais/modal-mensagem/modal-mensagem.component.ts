//src\app\shared\components-globais\modal-mensagem\modal-mensagem.component.ts
import { Component, Output, EventEmitter, Inject } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { Timestamp } from '@firebase/firestore';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { switchMap, take, throwError } from 'rxjs';

@Component({
    selector: 'app-modal-mensagem',
    templateUrl: './modal-mensagem.component.html',
    styleUrls: ['./modal-mensagem.component.css'],
    standalone: false
})

export class ModalMensagemComponent {

  @Output() mensagemEnviada = new EventEmitter<string>();
  mensagem: string = '';

  constructor(
    public dialogRef: MatDialogRef<ModalMensagemComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { profile: IUserDados },
    private chatService: ChatService,
    private authService: AuthService
  ) {
    console.log('Data recebida:', data);
  }

  async enviarMensagem(): Promise<void> {
    if (this.mensagem.trim().length > 0) {
      const mensagem: Message = {
        nickname: '',
        content: this.mensagem,
        senderId: '',
        timestamp: Timestamp.now()
      };

      this.authService.user$.pipe(
        take(1),
        switchMap(currentUser => {
          if (currentUser) {
            mensagem.senderId = currentUser.uid;
            const currentUserUid = currentUser.uid;
            const profileUid = this.data.profile.uid;

            if (currentUserUid && profileUid) {
              const participantes = [currentUserUid, profileUid];
              return this.chatService.getOrCreateChatId(participantes).pipe(
                switchMap(chatId => {
                  if (chatId !== null) {
                    return this.chatService.sendMessage(chatId, mensagem, currentUserUid).pipe(
                      switchMap(() => {
                        const chatUpdate: Partial<Chat> = {
                          lastMessage: mensagem
                        };
                        return this.chatService.updateChat(chatId, chatUpdate);
                      })
                    );
                  } else {
                    return throwError(() => new Error('Erro ao criar o chat.'));
                  }
                })
              );
            } else {
              return throwError(() => new Error('currentUserUid ou profileUid não definidos.'));
            }
          } else {
            return throwError(() => new Error('Usuário não autenticado.'));
          }
        })
      ).subscribe({
        next: () => {
          console.log('Mensagem enviada com sucesso!');
          this.mensagemEnviada.emit(this.data.profile.uid);
          this.dialogRef.close();
        },
        error: error => console.log('Erro ao enviar mensagem:', error)
      });
    }
  }
  fecharModal(): void {
    this.dialogRef.close();
  }
}
