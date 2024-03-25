// src\app\chat-module\chat-module-layout\chat-module-layout.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from '@firebase/firestore';
import { Message } from 'src/app/core/interfaces/message.interface';

@Component({
  selector: 'app-chat-module-layout',
  templateUrl: './chat-module-layout.component.html',
  styleUrls: ['./chat-module-layout.component.css']
})
export class ChatModuleLayoutComponent implements OnInit {
  usuario$: Observable<IUserDados | null> | undefined;
  messageContent: string = '';
  currentChatId: string = ''; // Este será o ID do chat atual
  selectedChatId: string | undefined;
  selectedReceiverId: string | undefined;

  constructor(private authService: AuthService,
              private chatService: ChatService) {
    console.log('Construtor do ChatModuleLayoutComponent chamado:', Date.now());
               }

  ngOnInit(): void {
    console.log('ngOnInit do ChatModuleLayoutComponent iniciado:', Date.now());
    this.usuario$ = this.authService.user$;
    // Aqui você também pode definir o currentChatId com base na lógica do seu chat

    this.usuario$.subscribe(data => {
      console.log('Dados do usuário:', data);
    });
  }

  onChatSelected(chatId: string | undefined) {
    this.selectedChatId = chatId;
    if (chatId) {
      this.chatService.getChatDetails(chatId).subscribe(chat => {
        if (chat && chat.participants) {
          // Assume que 'participants' é um array contendo os IDs do usuário e do destinatário
          this.selectedReceiverId = chat.participants.find(participantId => participantId !== this.authService.currentUser?.uid);
        }
      });
    }
  }
  sendMessage() {
    const senderId = this.authService.currentUser?.uid;

    if (this.messageContent.trim() && senderId && this.selectedReceiverId) {
      this.chatService.getOrCreateChatId([senderId, this.selectedReceiverId])
        .then((chatId: string) => {
          const message: Message = {
            content: this.messageContent,
            senderId: senderId,
            timestamp: Timestamp.fromDate(new Date())
          };
          return this.chatService.sendMessage(chatId, message);
        })
        .then(() => {
          console.log("Mensagem enviada com sucesso");
          this.messageContent = '';
        })
        .catch((error: any) => console.error("Erro ao enviar mensagem:", error));
    }
  }
}


