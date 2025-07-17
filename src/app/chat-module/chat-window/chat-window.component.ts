// src\app\chat-module\chat-window\chat-window.component.ts
import { Component } from '@angular/core';
import { Timestamp } from '@firebase/firestore';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

@Component({
    selector: 'app-chat-window',
    templateUrl: './chat-window.component.html',
    styleUrls: ['./chat-window.component.css'],
    standalone: false
})
export class ChatWindowComponent {
  messages: Message[] = [];
  messageContent = ''; // Adicione essa linha para representar o conteúdo da mensagem a ser enviada

    constructor(private chatService: ChatService,
                private authService: AuthService) { }

  // Adicione esse método que será chamado quando o botão "Enviar" for pressionado:
  sendMessage() {
    if (this.messageContent.trim()) {
      // Substituindo currentUser pelo observable correto
      this.authService.user$.subscribe((currentUser: IUserDados | null) => {
        const userId = currentUser?.uid;
        const nickname = currentUser?.nickname || 'Usuário'; // Adicionando o nickname
        if (!userId) {
          console.log("Usuário não autenticado");
          return;
        }

        const newMessage = {
          content: this.messageContent.trim(),
          senderId: userId,
          nickname: nickname, // Adicionando a propriedade 'nickname' ao objeto Message
          timestamp: Timestamp.fromDate(new Date())
        };

        this.messages.push(newMessage);
        this.messageContent = '';
        console.log("Mensagem enviada pelo usuário:", newMessage);
        this.chatService.sendMessage('chatId', newMessage, userId);
      });
    }
  }
}
