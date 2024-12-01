// src/app/chat-module/chat-list/chat-list.component.ts
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { Chat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/batepapo/chat.service';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import { CreateRoomModalComponent } from '../create-room-modal/create-room-modal.component';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { Observable, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { selectAllChats } from 'src/app/store/selectors/selectors.chat/chat.selectors';
import { InviteUserModalComponent } from '../invite-user-modal/invite-user-modal.component';
import { InviteService } from 'src/app/core/services/batepapo/invite.service';
import { Timestamp } from '@firebase/firestore';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css'],
  standalone: false
})
export class ChatListComponent implements OnInit, OnDestroy {
  rooms: any[] = [];
  rooms$: Observable<any[]> | undefined;
  regularChats: Chat[] = [];
  userSubscription: Subscription | undefined;
  chatSubscription: Subscription | undefined;
  @Output() chatSelected = new EventEmitter<{ id: string, type: 'room' | 'chat' }>();

  constructor(private authService: AuthService,
    private chatService: ChatService,
    private roomService: RoomService,
    private roomManagement: RoomManagementService,
    private inviteService: InviteService,
    public dialog: MatDialog,
    private router: Router,
    private store: Store<AppState>) { }

  ngOnInit() {
    console.log('Iniciando ChatListComponent, carregando conversas do usuário.');

    this.userSubscription = this.authService.user$.pipe(
      switchMap(currentUser => {
        console.log('Usuário autenticado:', currentUser?.uid);
        if (!currentUser) {
          this.router.navigate(['/login']);
          return []; // Retorna uma lista vazia se não houver usuário
        }
        console.log('Carregando salas e chats para o usuário:', currentUser.uid);
        this.rooms$ = this.roomService.getUserRooms(currentUser.uid);

        // Adiciona a assinatura ao Observable rooms$
        this.rooms$.subscribe((rooms: any[]) => {
          this.rooms = rooms;
          console.log('Salas carregadas:', this.rooms);
        });

        return this.chatService.getChats(currentUser.uid);
      })
    ).subscribe(chats => {
      this.regularChats = chats.filter(chat => !chat.isRoom);
      console.log('Conversas carregadas e filtradas (regularChats):', this.regularChats);
      this.regularChats.forEach(chat => {
        console.log('Chat ID:', chat.id, 'Detalhes do outro participante:', chat.otherParticipantDetails);
        if (!chat.id) {
          console.warn('Atenção: Um dos chats está sem ID.', chat);
        }
      });
    });

    // Adiciona monitoramento do Store para atualizar a interface quando o estado dos chats mudar
    this.chatSubscription = this.store.select(selectAllChats).subscribe(chats => {
      console.log('Chats atualizados na interface:', chats);
      this.regularChats = chats; // Atualizando o estado local com os chats do Store
    });
  }

  inviteUsers(roomId: string | undefined, event: MouseEvent) {
    if (!roomId) {
      console.error('Erro: roomId está undefined.');
      return;
    }
    event.stopPropagation();

    const currentUserUID = this.authService.getLoggedUserUID();
    if (!currentUserUID) {
      console.error('Erro: UID do usuário não encontrado.');
      return;
    }

    const currentUser = this.authService['userSubject'].value;
    if (!currentUser || !currentUser.role) {
      console.error('Erro: Usuário não autenticado ou role não definido.');
      return;
    }

    const dialogRef = this.dialog.open(InviteUserModalComponent, {
      width: '60%',
      maxWidth: '500px',
      data: { roomId }
    });

    dialogRef.afterClosed().subscribe((selectedUsers: string[] | null) => {
      if (selectedUsers && selectedUsers.length > 0) {
        console.log('Usuários selecionados para convite:', selectedUsers);

        const currentTimestamp = new Date();

        // Envia convites para os usuários selecionados
        selectedUsers.forEach(userId => {
          this.inviteService
            .sendInvite(
              {
                roomId,
                receiverId: userId,
                senderId: currentUserUID,
                status: 'pending',
                sentAt: Timestamp.fromDate(currentTimestamp),
                expiresAt: Timestamp.fromDate(new Date(currentTimestamp.getTime() + 7 * 24 * 60 * 60 * 1000)) // Expira em 7 dias
              },
              'Nome da Sala', // Substitua pelo nome real da sala
              currentUser.role as 'visitante' | 'free' | 'basico' | 'premium' | 'vip'
            )
            .then(() => {
              console.log(`Convite enviado para o usuário com ID: ${userId}`);
            })
            .catch(error => {
              console.error(`Erro ao enviar convite para o usuário com ID: ${userId}`, error);
            });
        });
      }
    });
  }

  isRoom(item: any): boolean {
    return item.isRoom === true;
  }

  selectChat(chatId: string | undefined): void {
    if (!chatId) {
      console.error('Erro: ID do chat é undefined.');
      return;
    }
    console.log(`Chat selecionado com ID: ${chatId}`);
    this.chatSelected.emit({ id: chatId, type: 'chat' });
  }

  selectRoom(roomId: string | undefined): void {
    if (!roomId) {
      console.error('Erro: ID da sala é undefined.');
      return;
    }
    console.log(`Sala selecionada com ID: ${roomId}`);
    this.chatSelected.emit({ id: roomId, type: 'room' });
  }

  // Verifica se o usuário atual é o dono da sala
  isOwner(room: any): boolean {
    const currentUser = this.authService.getLoggedUserUID();
    return room.createdBy === currentUser;
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
        this.roomManagement.deleteRoom(roomId)
          .then(() => {
            console.log('Sala excluída com sucesso');
            // Atualizar a lista de salas, se necessário
          })
          .catch(error => {
            console.error('Erro ao excluir a sala:', error);
            // Tratar o erro de exclusão
          });
      }
    });
  }

  editRoom(roomId: string, event: MouseEvent) {
    event.stopPropagation();
    const roomData = this.rooms.find(room => room.roomId === roomId);
    if (!roomData) {
      console.error('Sala não encontrada:', roomId);
      return;
    }
    console.log(roomData);
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

  getOptimizedPhotoURL(originalURL: string | null | undefined): string {
    if (!originalURL) {
      return ''; // Retorna vazio se a URL original for undefined ou null
    }
    return `${originalURL}&w=10&h=10&fit=crop`;
  }

  ngOnDestroy() {
    // Desinscrever-se das assinaturas ao destruir o componente
    this.userSubscription?.unsubscribe();
    this.chatSubscription?.unsubscribe();
  }
}
