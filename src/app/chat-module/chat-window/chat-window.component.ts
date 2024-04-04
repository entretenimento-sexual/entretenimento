// src\app\chat-module\chat-window\chat-window.component.ts
import { Component } from '@angular/core';
import { Timestamp } from '@firebase/firestore';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';

@Component({
  selector: 'app-chat-window',
  templateUrl: './chat-window.component.html',
  styleUrls: ['./chat-window.component.css']
})
export class ChatWindowComponent {
  messages: { content: string, senderId: string, timestamp: Timestamp }[] = [];
  messageContent = ''; // Adicione essa linha para representar o conteúdo da mensagem a ser enviada

    constructor(private chatService: ChatService,
                private authService: AuthService) { }

  // Adicione esse método que será chamado quando o botão "Enviar" for pressionado:
  sendMessage() {
    if (this.messageContent.trim()) {
      const userId = this.authService.currentUser?.uid;
      if(!userId) {
        console.error("usuário não autenticado");
        return
      }
      const newMessage = {
        content: this.messageContent.trim(),
        senderId: userId, // Substitua 'userId' pelo ID real do usuário
        timestamp: Timestamp.fromDate(new Date()) // Substitua por um timestamp válido se estiver usando Firebase
      };
      this.messages.push(newMessage);
      this.messageContent = '';
      this.chatService.sendMessage('chatId', newMessage);
    }
  }
}
