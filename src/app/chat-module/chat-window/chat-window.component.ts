// src\app\chat-module\chat-window\chat-window.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-chat-window',
  templateUrl: './chat-window.component.html',
  styleUrls: ['./chat-window.component.css']
})
export class ChatWindowComponent {
  messages: { content: string, senderId: string, timestamp: Date }[] = [];
  messageContent = ''; // Adicione essa linha para representar o conteúdo da mensagem a ser enviada

  // Adicione esse método que será chamado quando o botão "Enviar" for pressionado:
  sendMessage() {
    if (this.messageContent.trim()) {
      const newMessage = {
        content: this.messageContent.trim(),
        senderId: 'userId', // Substitua 'userId' pelo ID real do usuário
        timestamp: new Date() // Substitua por um timestamp válido se estiver usando Firebase
      };
      this.messages.push(newMessage);
      this.messageContent = '';
    }
  }

}
