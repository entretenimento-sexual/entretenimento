//src\app\chat-module\chat-rooms\chat-rooms.component.ts
import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-chat-rooms',
  templateUrl: './chat-rooms.component.html',
  styleUrls: ['./chat-rooms.component.css']
})

export class ChatRoomsComponent implements OnInit {
  // Lista de salas de bate-papo
  chatRooms: any[] = [];

  constructor() { }

  ngOnInit(): void {
    // Aqui você pode carregar as salas de bate-papo do usuário
  }

  createRoom() {
    // Lógica para criar uma nova sala
  }

  inviteToRoom(roomId: string) {
    // Lógica para convidar usuários para a sala
  }

  openRoom(roomId: string) {
    // Lógica para abrir uma sala específica e visualizar as mensagens
  }
}
