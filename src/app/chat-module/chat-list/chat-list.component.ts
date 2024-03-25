//src\app\chat-module\chat-list\chat-list.component.ts
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { Chat } from 'src/app/core/interfaces/chat.interface';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { RoomService } from 'src/app/core/services/batepapo/room.service';
import { CreateRoomModalComponent } from '../create-room-modal/create-room-modal.component';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css']
})
export class ChatListComponent implements OnInit {
  rooms: any[] = [];
  regularChats: Chat[] = [];
  @Output() chatSelected = new EventEmitter<string>();

  constructor(private authService: AuthService,
              private chatService: ChatService,
              private roomService: RoomService,
              public dialog: MatDialog,
              private router: Router) { }

  ngOnInit() {
    if (!this.authService.isUserAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    const currentUser = this.authService.currentUser;
    if (!currentUser?.uid) return;

    // Carrega apenas chats regulares
    this.chatService.getChats(currentUser.uid).subscribe(chats => {
      this.regularChats = chats.filter(chat => !chat.isRoom);
    });

    // Carrega salas de bate-papo
    this.roomService.getUserRooms(currentUser.uid).then(rooms => {
      console.log("Salas carregadas:", rooms);
      this.rooms = rooms.map(room => ({ id: room.roomId, ...room }));
    });
  }

  isRoom(item: any): boolean {
    return item.isRoom === true;
  }

  selectChat(chatId: string | undefined) {
    console.log('Selecionado chatId:', chatId); //linha 50
    this.chatSelected.emit(chatId);
  }

  // Verifica se o usuário atual é o dono da sala
  isOwner(room: any): boolean {
    return room.createdBy === this.authService.currentUser?.uid;
  }

  deleteRoom(roomId: string | undefined, event: MouseEvent) {
    if (!roomId) {
      console.error('ID da sala é undefined.');
      return;
    }
    event.stopPropagation();
    console.log('Solicitada a exclusão da sala com ID:', roomId);
    // Implemente a lógica de exclusão da sala aqui
  }

  inviteUsers(roomId: string | undefined, event: MouseEvent) {
    if (!roomId) {
      console.error('ID da sala é undefined.');
      return;
    }
    event.stopPropagation();
    console.log('Solicitado o envio de convites para a sala com ID:', roomId);
    // Implemente a lógica de envio de convites aqui
  }

  editRoom(roomId: string, event: MouseEvent) {
    event.stopPropagation();
    const roomData = this.rooms.find(room => room.id === roomId);
    if (!roomData) {
      console.error('Sala não encontrada:', roomId);
      return;
    }
    console.log(roomData)
    // Abre o modal de edição com os dados da sala
    const dialogRef = this.dialog.open(CreateRoomModalComponent, {
      width: '50%',
      data: { roomId: roomId, roomData: roomData, isEditing: true }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.success) {
        console.log('Sala editada com sucesso');
        // Atualize a lista de salas, se necessário
      }
    });
  }
}
