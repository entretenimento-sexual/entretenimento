//src\app\shared\components-globais\modal-mensagem\modal-mensagem.component.ts
import { Component, Output, EventEmitter, Inject } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { Timestamp } from '@firebase/firestore';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';

@Component({
  selector: 'app-modal-mensagem',
  templateUrl: './modal-mensagem.component.html',
  styleUrls: ['./modal-mensagem.component.css']
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
        content: this.mensagem,
        senderId: '', // Inicialmente vazio, será preenchido com o UID do usuário autenticado
        timestamp: Timestamp.now()
      };

      this.authService.getUserAuthenticated().subscribe(async (currentUser) => {
        if (currentUser) {
          mensagem.senderId = currentUser.uid;

          const currentUserUid = currentUser.uid;
          const profileUid = this.data.profile.uid;

          if (currentUserUid && profileUid) {
            const participantes = [currentUserUid, profileUid];

            try {
              const chatId = await this.chatService.getOrCreateChatId(participantes);

              if (chatId !== null) {
                await this.chatService.sendMessage(chatId, mensagem);

                // Atualize a propriedade 'lastMessage' do chat com a mensagem enviada
                const chatUpdate: Partial<Chat> = {
                  lastMessage: mensagem
                };
                await this.chatService.updateChat(chatId, chatUpdate);

                console.log('Mensagem enviada com sucesso!');
                this.mensagemEnviada.emit(profileUid);
                this.dialogRef.close();
              } else {
                console.error('Erro ao criar o chat.');
              }
            } catch (error) {
              console.error('Erro ao enviar mensagem:', error);
            }
          } else {
            console.error('currentUserUid ou profileUid não definidos.');
          }
        } else {
          console.error('Usuário não autenticado.');
        }
      });
    }
  }
}
