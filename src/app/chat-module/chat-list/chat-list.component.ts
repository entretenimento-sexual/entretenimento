//src\app\chat-module\chat-list\chat-list.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css']
})
export class ChatListComponent implements OnInit {
  chats: { id: number, lastMessage: { content: string } }[] = [];

  constructor(private authService: AuthService) { }

  ngOnInit() {
    if (this.authService.isUserAuthenticated()) {
      // Usuário autenticado, carregue a lista de chats
      // Implemente a lógica para carregar os chats aqui
    } else {
      // Usuário não autenticado, redirecione ou mostre uma mensagem
      // Por exemplo, redirecionar para a página de login:
      // this.router.navigate(['/login']);
    }

  }
}
