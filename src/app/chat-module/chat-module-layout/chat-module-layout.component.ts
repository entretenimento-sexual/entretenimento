// src\app\chat-module\chat-module-layout\chat-module-layout.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/chat.service';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from '@firebase/firestore';

@Component({
  selector: 'app-chat-module-layout',
  templateUrl: './chat-module-layout.component.html',
  styleUrls: ['./chat-module-layout.component.css']
})
export class ChatModuleLayoutComponent implements OnInit {
  usuario$: Observable<IUserDados | null> | undefined;
  messageContent: string = '';
  currentChatId: string = ''; // Você precisa definir isso de acordo com a lógica do seu chat

  constructor(private authService: AuthService,
              private chatService: ChatService) { }

  ngOnInit(): void {
    this.usuario$ = this.authService.user$;
    // Aqui você também pode definir o currentChatId com base na lógica do seu chat

    this.usuario$.subscribe(data => {
      console.log('Dados do usuário:', data);
    });
  }

  sendMessage() {
    const senderId = this.authService.currentUser?.uid;

    if (this.messageContent.trim() && this.currentChatId && senderId) {
      const message = {
        content: this.messageContent,
        senderId: senderId,
        timestamp: Timestamp.fromDate(new Date())
      };
      this.chatService.sendMessage(this.currentChatId, message)
        .then(() => {
          console.log("Mensagem enviada com sucesso");
          this.messageContent = '';
        })
        .catch(error => console.error("Erro ao enviar mensagem:", error));
    }
  }
}

