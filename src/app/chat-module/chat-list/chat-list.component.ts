// src/app/chat-module/chat-list/chat-list.component.ts
// Este componente é responsável por exibir a lista de conversas (chats 1:1 e salas) do usuário, permitindo que ele selecione uma conversa para abrir, crie novas salas, convide usuários para salas existentes e gerencie suas conversas. Ele se integra com os serviços de autenticação, chat, sala e notificações para fornecer uma experiência de bate-papo completa.
// Não esquecer de incluir comentários explicativos e ferramentas de debug para garantir que a funcionalidade de chat esteja funcionando corretamente e que os dados do usuário sejam carregados e exibidos como esperado.
import { Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { combineLatest, Observable, of, Subscription } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { selectAllChats } from 'src/app/store/selectors/selectors.chat/chat.selectors';
import { InviteUserModalComponent } from '../modals/invite-user-modal/invite-user-modal.component';
import { Timestamp } from '@firebase/firestore';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { InviteService } from 'src/app/core/services/batepapo/invite-service/invite.service';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { CreateRoomModalComponent } from '../modals/create-room-modal/create-room-modal.component';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';

@Component({
  selector: 'app-chat-list',
  templateUrl: './chat-list.component.html',
  styleUrls: ['./chat-list.component.css'],
  standalone: false
})

export class ChatListComponent implements OnInit, OnDestroy {
  rooms: IRoom[] = [];
  rooms$: Observable<IRoom[]> | undefined;
  regularChats: IChat[] = [];
  userSubscription: Subscription | undefined;
  chatSubscription: Subscription | undefined;
  @Output() chatSelected = new EventEmitter<{ id: string, type: 'room' | 'chat' }>();
  selectedChatId: string | undefined;
  private currentUserUid: string | null = null;

  constructor(private authService: AuthService,
              private chatService: ChatService,
              private roomService: RoomService,
              private roomMessages: RoomMessagesService,
              private chatnotification: ChatNotificationService,
              private roomManagement: RoomManagementService,
              private inviteService: InviteService,
              public dialog: MatDialog,
              private router: Router,
              private store: Store<AppState>) { }

  ngOnInit() {
    console.log('Iniciando ChatListComponent, carregando conversas do usuário.');

    // guarda UID para uso sincrônico (ex.: isOwner)
    this.authService.getLoggedUserUID$().pipe(take(1)).subscribe(uid => this.currentUserUid = uid);

    this.userSubscription = this.authService.user$.pipe(
      take(1),
      switchMap(currentUser => {
        console.log('Usuário autenticado:', currentUser?.uid);
        if (!currentUser) {
          this.router.navigate(['/login']);
          return of<IChat[]>([]);
        }

        console.log('Carregando salas e chats para o usuário:', currentUser.uid);
        this.rooms$ = this.roomService.getUserRooms(currentUser.uid).pipe(
          map((rooms: IRoom[]) =>
            rooms.sort((a, b) => {
              const timeA =
                a.lastMessage?.timestamp?.toDate?.().getTime?.() ??
                (a.lastActivity instanceof Date ? a.lastActivity.getTime() : (a.lastActivity as any)?.toDate?.().getTime?.() ?? 0) ??
                (a.creationTime instanceof Date ? a.creationTime.getTime() : (a.creationTime as any)?.toDate?.().getTime?.() ?? 0) ??
                0;
              const timeB =
                b.lastMessage?.timestamp?.toDate?.().getTime?.() ??
                (b.lastActivity instanceof Date ? b.lastActivity.getTime() : (b.lastActivity as any)?.toDate?.().getTime?.() ?? 0) ??
                (b.creationTime instanceof Date ? b.creationTime.getTime() : (b.creationTime as any)?.toDate?.().getTime?.() ?? 0) ??
                0;
              return timeB - timeA;
            })
          )
        );

        this.rooms$.subscribe((rooms: IRoom[]) => {
          this.rooms = rooms;
          console.log('Salas carregadas:', this.rooms);
        });


        // CHATS 1:1 (IChat[])
        return this.chatService.getChats(currentUser.uid).pipe(
          switchMap((chats: IChat[]) => {
            if (!chats.length) return of<IChat[]>([]);
            const chatDetailsObservables = chats.map(chat => {
              if (!chat.otherParticipantDetails) {
                const otherParticipantUid = chat.participants.find((uid: string) => uid !== this.authService.currentUser?.uid); // 👈 tipado
                return this.chatService
                  .fetchAndPersistParticipantDetails(chat.id!, otherParticipantUid!)
                  .pipe(map(details => ({ ...chat, otherParticipantDetails: details } as IChat)));
              }
              return of(chat);
            });
            return combineLatest(chatDetailsObservables);
          }),
          map((chatsWithDetails: IChat[]) =>
            chatsWithDetails.sort((a, b) => {
              const timeA = a.lastMessage?.timestamp ? a.lastMessage.timestamp.toDate().getTime() : 0;
              const timeB = b.lastMessage?.timestamp ? b.lastMessage.timestamp.toDate().getTime() : 0;
              return timeB - timeA;
            })
          )
        );
      })
    ).subscribe(chats => {
      this.regularChats = chats.filter(chat => !chat.isRoom);
      console.log('Conversas carregadas e filtradas (regularChats):', this.regularChats);
      this.regularChats.forEach(chat => {
        console.log('Chat ID:', chat.id, 'Detalhes do outro participante:', chat.otherParticipantDetails);
        if (!chat.id) {
          console.log('Atenção: Um dos chats está sem ID.', chat);
        }
      });
    });

    this.chatSubscription = this.store.select(selectAllChats).subscribe(chats => {
      console.log('Chats atualizados na interface:', chats);
      this.regularChats = chats;
    });
  }


  sendInvite(roomId: string | undefined, event: MouseEvent): void {
    if (!roomId) {
      console.log('Erro: roomId está undefined.');
      return;
    }
    event.stopPropagation();

    // Resolve o UID do usuário atual
    this.authService.getLoggedUserUID$().pipe(
      take(1) // Garante que assinamos apenas uma vez
    ).subscribe({
      next: (currentUserUID) => {
        if (!currentUserUID) {
          console.log('Erro: UID do usuário não encontrado.');
          return;
        }
        const currentUser = this.authService['userSubject'].value;
        if (!currentUser || !currentUser.role) {
          console.log('Erro: Usuário não autenticado ou role não definido.');
          return;
        }

        const dialogRef = this.dialog.open(InviteUserModalComponent, {
          width: '60%',
          maxWidth: '500px',
          data: { roomId },
        });

        dialogRef.afterClosed().subscribe((selectedUsers: string[] | null) => {
          if (selectedUsers && selectedUsers.length > 0) {
            console.log('Usuários selecionados para convite:', selectedUsers);

            const currentTimestamp = new Date();

            selectedUsers.forEach((userId) => {
              const invite: Invite = {
                roomId,
                roomName: '',
                receiverId: userId,
                senderId: currentUserUID,
                status: 'pending',
                sentAt: Timestamp.fromDate(new Date()),
                expiresAt: Timestamp.fromDate(new Date(currentTimestamp.getTime() + 7 * 24 * 60 * 60 * 1000)), // Expira em 7 dias
              };

              this.inviteService
                .sendInviteToRoom(roomId, invite)
                .subscribe({
                  next: () => console.log(`Convite enviado para o usuário com ID: ${userId}`),
                  error: (error) => console.log(`Erro ao enviar convite para o usuário com ID: ${userId}`, error),
                });
            });
          }
        });
      },
      error: (error) => {
        console.log('Erro ao resolver UID do usuário:', error);
      }
    });
  }


  isRoom(item: any): boolean {
    return item.isRoom === true;
  }

  selectChat(chatId: string | undefined): void {
    if (!chatId) {
      console.log('Erro: ID do chat é undefined.');
      return;
    }
    this.selectedChatId = chatId;
    this.chatSelected.emit({ id: chatId, type: 'chat' });

    this.chatService.refreshParticipantDetailsIfNeeded(chatId);

    const chatSubscription = this.chatService.monitorChat(chatId).subscribe({
      next: (messages) => {
        messages.filter(msg => msg.status === 'delivered' && msg.senderId !== this.authService.currentUser?.uid)
          .forEach(msg => {
            this.chatService.updateMessageStatus(chatId, msg.id!, 'read').subscribe({
              next: () => this.chatnotification.decrementUnreadMessages(),
              error: (error) => console.log('Erro ao atualizar status da mensagem:', error),
            });
          });
      },
      error: (error) => console.log(`Erro ao monitorar mensagens do chat ${chatId}:`, error),
    });

    this.chatSubscription?.unsubscribe();
    this.chatSubscription = chatSubscription;
  }

  selectRoom(roomId: string | undefined): void {
    if (!roomId) {
      console.log('Erro: ID da sala é undefined.');
      return;
    }

    this.selectedChatId = roomId;
    this.chatSelected.emit({ id: roomId, type: 'room' });

    // Monitora as mensagens da sala
    const roomSubscription = this.roomMessages.getRoomMessages(roomId).subscribe({
      next: (messages) => {
        messages.filter((msg) =>msg.status === 'delivered' &&
              msg.senderId !== this.authService.currentUser?.uid
          )
          .forEach((msg) => {
            this.roomMessages
              .updateMessageStatus(roomId, msg.id!, 'read')
              .subscribe({
              next: () => this.chatnotification.decrementUnreadMessages(),
              error: (error: unknown) =>
              console.log('Erro ao atualizar status da mensagem:', error),
            });
          });
        },
      error: (error: unknown) =>
      console.log(`Erro ao monitorar mensagens da sala ${roomId}:`, error),
    });

    // Cancela assinaturas anteriores se houver
    this.chatSubscription?.unsubscribe();
    this.chatSubscription = roomSubscription;
  }

  // Verifica se o usuário atual é o dono da sala
  isOwner(room: IRoom): boolean {
    return !!this.currentUserUid && room.createdBy === this.currentUserUid;
  }

  deleteRoom(roomId: string | undefined, event: MouseEvent) {
    event.stopPropagation();
    if (!roomId) {
      console.log('ID da sala é indefinido.');
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
            console.log('Erro ao excluir a sala:', error);
            // Tratar o erro de exclusão
          });
      }
    });
  }

  editRoom(roomId: string, event: MouseEvent) {
    event.stopPropagation();
    const roomData = this.rooms.find(room => room.id === roomId);
    if (!roomData) {
      console.log('Sala não encontrada:', roomId);
      return;
    }
    console.log(roomData);
    // Abre o modal de edição com os dados da sala
    const dialogRef = this.dialog.open(CreateRoomModalComponent, {
      width: '50%',
      data: { roomId, roomData, isEditing: true }
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
