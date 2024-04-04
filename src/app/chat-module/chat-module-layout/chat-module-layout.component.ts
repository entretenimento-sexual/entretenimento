// src\app\chat-module\chat-module-layout\chat-module-layout.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from '@firebase/firestore';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { RoomService } from 'src/app/core/services/batepapo/room.service';

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
  selectedType: 'room' | 'chat' | undefined;

  constructor(private authService: AuthService,
              private chatService: ChatService,
              private roomService: RoomService) {
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

  onChatSelected(event: { id: string; type: 'room' | 'chat' }): void {
    this.selectedChatId = event.id;
    this.selectedType = event.type;
    this.currentChatId = event.id;
    console.log(`Selecionado ${event.type} com ID:`, event.id);

    if (event.type === 'chat') {
      // Aqui, você pode adicionar a lógica para lidar com a seleção de um chat individual
      console.log('Chat individual selecionado:', event.id);
    } else if (event.type === 'room') {
      // E aqui, a lógica para lidar com a seleção de uma sala
      console.log('Sala selecionada:', event.id);
    }
  }

  sendMessage() {
    console.log('Tentando enviar mensagem:', this.messageContent);
    if (!this.messageContent.trim()) {
      console.log('A mensagem está vazia.');
      return;
    }

    const senderId = this.authService.currentUser?.uid;
    if (!senderId) {
      console.error('Erro: Usuário não autenticado.');
      return;
    }

    const message: Message = {
      content: this.messageContent.trim(),
      senderId: senderId,
      timestamp: Timestamp.now(), // Ajuste de Timestamp.fromDate(new Date())
    };

    if (this.selectedType === 'chat' && this.selectedChatId) {

      this.chatService.sendMessage(this.selectedChatId, message).then(() => {
        console.log("Mensagem enviada com sucesso ao chat");
        this.messageContent = ''; // Limpa o campo de texto após o envio
      }).catch(error => console.error("Erro ao enviar mensagem ao chat:", error));

    } else if (this.selectedType === 'room' && this.selectedChatId) {

      this.roomService.sendMessageToRoom(this.selectedChatId, message).then(() => {
        console.log("Mensagem enviada com sucesso à sala");
        this.messageContent = ''; // Limpa o campo de texto após o envio
      }).catch(error => console.error("Erro ao enviar mensagem à sala:", error));
    }
  }
}

