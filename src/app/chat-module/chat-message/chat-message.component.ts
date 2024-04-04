// src\app\chat-module\chat-message\chat-message.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';

@Component({
  selector: 'app-chat-message',
  templateUrl: './chat-message.component.html',
  styleUrls: ['./chat-message.component.css']
})
export class ChatMessageComponent implements OnInit {
  @Input() message!: Message;
  senderName: string = '';
  currentUserUid: string | undefined;

  constructor (private usuarioService: UsuarioService,
                private authService: AuthService){}

  ngOnInit(): void {
    this.currentUserUid = this.authService.currentUser?.uid;

      if (this.message.senderId){
        this.usuarioService.getUsuario(this.message.senderId).subscribe(
          userData => {
            this.senderName = userData?.nickname ?? 'Usuário desconhecido';
          },
          error => console.error("Erro ao buscar nome do usuário", error)
        );

      }
  }
  isMessageSent(): boolean {
    return this.message.senderId === this.currentUserUid;
  }
}
