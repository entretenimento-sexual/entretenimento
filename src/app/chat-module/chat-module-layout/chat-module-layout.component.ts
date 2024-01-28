// src\app\chat-module\chat-module-layout\chat-module-layout.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/chat.service';
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

  constructor(private authService: AuthService,
              private chatService: ChatService) { }

  ngOnInit(): void {
    this.usuario$ = this.authService.user$;
    // Aqui você também pode definir o currentChatId com base na lógica do seu chat

    this.usuario$.subscribe(data => {
      console.log('Dados do usuário:', data);
    });
  }

  onChatSelected(chatId: string | undefined) {
    this.selectedChatId = chatId;
  }

  sendMessage() {
    const senderId = this.authService.currentUser?.uid;
    const receiverId = 'ID do destinatário'; // Substitua pelo ID do destinatário da mensagem

    if (this.messageContent.trim() && senderId && receiverId) {
      this.chatService.getOrCreateChatId([senderId, receiverId])
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


