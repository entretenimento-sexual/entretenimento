//src\app\chat-module\chat-list\chat-list.component.ts
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { RoomService } from 'src/app/core/services/batepapo/room.service';
import { CreateRoomModalComponent } from '../create-room-modal/create-room-modal.component';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css']
})
export class ChatListComponent implements OnInit {
  rooms: any[] = [];
  rooms$: Observable<any[]> | undefined;
  regularChats: Chat[] = [];
  @Output() chatSelected = new EventEmitter<{ id: string, type: 'room' | 'chat' }>();

  constructor(private authService: AuthService,
              private chatService: ChatService,
              private roomService: RoomService,
              public dialog: MatDialog,
              private router: Router) { }

  ngOnInit() {
    this.authService.getUserAuthenticated().subscribe(currentUser => {
      if (!currentUser) {
        this.router.navigate(['/login']);
        return;
      }

      this.rooms$ = this.roomService.getUserRooms(currentUser.uid);

      // Carrega apenas chats regulares
      this.chatService.getChats(currentUser.uid).subscribe(chats => {
        this.regularChats = chats.filter(chat => !chat.isRoom);
      });

      // Carrega salas de bate-papo
      this.roomService.getUserRooms(currentUser.uid).subscribe({
        next: (rooms) => {
          console.log("Salas atualizadas:", rooms);
          this.rooms = rooms;
        },
        error: (error) => console.error("Erro ao obter salas:", error)
      });
    });
  }
  isRoom(item: any): boolean {
    return item.isRoom === true;
  }

  selectChat(chatId: string | undefined) {
  if(!chatId) {
       console.error('Erro: ID do chat é undefined.');
    return;
  }
      this.chatSelected.emit({ id: chatId, type: 'chat' });
  }

  selectRoom(roomId: string | undefined) {
    if (!roomId) {
      console.error('Erro: ID da sala é undefined.');
      return;
    }
      this.chatSelected.emit({ id: roomId, type: 'room' });
  }

  // Verifica se o usuário atual é o dono da sala
  isOwner(room: any): boolean {
    let isOwner = false;
    this.authService.getUserAuthenticated().subscribe(currentUser => {
      if (currentUser) {
        isOwner = room.createdBy === currentUser.uid;
      }
    });
    return isOwner;
  }

  deleteRoom(roomId: string | undefined, event: MouseEvent) {
    event.stopPropagation();
      if (!roomId) {
        console.error('ID da sala é indefinido.');
        return;
      }
    const dialogRef = this.dialog.open(ConfirmacaoDialogComponent, {
      width: '400px',
      data: {
        title: 'Confirmar Exclusão',
        message: 'Tem certeza que deseja excluir esta sala? Esta ação irá remover permanentemente a sala, todos os perfis adicionados e todas as mensagens trocadas.'
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.roomService.deleteRoom(roomId)
          .then(() => {
            console.log('Sala excluída com sucesso');
            // Código para atualizar a lista de salas, se necessário
          })
          .catch(error => {
            console.error('Erro ao excluir a sala:', error);
            // Código para tratar o erro de exclusão
          });
      }
    });
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
    const roomData = this.rooms.find(room => room.roomId === roomId);
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
