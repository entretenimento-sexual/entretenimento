// src/app/chat-module/room-interaction/room-interaction.component.ts
import { Component, Input, OnInit, OnDestroy, SimpleChanges, OnChanges, ViewChild, ElementRef } from '@angular/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { Timestamp } from '@firebase/firestore';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { RoomParticipantsService } from 'src/app/core/services/batepapo/room-services/room-participants.service';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';

@Component({
  selector: 'app-room-interaction',
  templateUrl: './room-interaction.component.html',
  styleUrls: ['./room-interaction.component.css'],
  standalone: false
})
export class RoomInteractionComponent implements OnInit, OnChanges, OnDestroy {
  @Input() roomId!: string | undefined;
  @Input() roomName?: string;
  @ViewChild('messagesContainerRef', { static: false }) private messagesContainer?: ElementRef;

  participants: { uid: string; nickname: string; photoURL?: string; isCreator?: boolean; isOnline?: boolean; gender?: string; municipio?: string }[] = [];
  creatorDetails: IUserDados | null = null;
  messages: Message[] = [];
  messageContent: string = '';
  currentUser: { uid: string, nickname: string } | null = null;

  private messageSubscription?: Subscription;
  private participantSubscription?: Subscription;
  private creatorSubscription?: Subscription;
  private roomSubscription?: Subscription;

  constructor(
    private userProfile: UserProfileService,
    private roomParticipants: RoomParticipantsService,
    private roomMessages: RoomMessagesService,
    private roomService: RoomService,
    private firestoreQuery: FirestoreQueryService,
    private errorNotifier: ErrorNotificationService
  ) { }

  ngOnInit(): void {
    if (!this.roomId) {
      this.errorNotifier.showError('ID da sala não fornecido.');
      return;
    }
    this.loadRoomName(this.roomId);
    this.loadMessages(this.roomId);
    this.loadParticipants(this.roomId);
    this.loadRoomCreator(this.roomId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roomId']?.currentValue) {
      const newRoomId = changes['roomId'].currentValue;
      this.loadRoomName(newRoomId);
      this.loadMessages(newRoomId);
      this.loadParticipants(newRoomId);
      this.loadRoomCreator(newRoomId);
    }
  }

  private loadRoomName(roomId: string): void {
    this.roomSubscription?.unsubscribe(); // Desinscrever para evitar múltiplas assinaturas
    this.roomSubscription = this.roomService.getRoomById(roomId).subscribe({
      next: (room) => {
        this.roomName = room?.roomName || 'Sala de Bate-papo'; // Atualiza o roomName
      },
      error: (err) => {
        this.errorNotifier.showError('Erro ao carregar informações da sala.');
        console.error(err);
      }
    });
  }

  private async loadMessages(roomId: string): Promise<void> {
    this.messageSubscription?.unsubscribe();
    this.messageSubscription = this.roomMessages.getRoomMessages(roomId).subscribe({
      next: async (messages) => {
        // Aguarda a resolução de todas as promessas para obter os nicknames
        const updatedMessages = await Promise.all(
          messages.map(async (msg) => {
            let user: IUserDados | null = null;

            try {
              // Tente obter o usuário do estado
              const userFromState = await firstValueFrom(this.firestoreQuery.getUserFromState(msg.senderId));
              user = userFromState ? userFromState : null; // Garante que user nunca seja undefined
            } catch (error) {
              console.warn(`Erro ao buscar usuário do estado com UID ${msg.senderId}`, error);
            }

            if (!user) {
              try {
                // Se não encontrou no estado, tente obter do Firestore
                user = await firstValueFrom(this.firestoreQuery.getUser(msg.senderId));
              } catch (error) {
                console.error(`Erro ao buscar usuário com UID ${msg.senderId} no Firestore:`, error);
                this.errorNotifier.showError(`Erro ao buscar usuário com UID ${msg.senderId}`);
              }
            }

            return {
              ...msg,
              nickname: user?.nickname || `Usuário não encontrado (${msg.senderId})`
            };
          })
        );
        // Atualiza a lista de mensagens com os nicknames corretos
        this.messages = updatedMessages;
        this.scrollToBottom();
      },
      error: (err: any) => {
        this.errorNotifier.showError('Erro ao carregar mensagens.');
        console.error(err);
      }
    });
  }

  private scrollToBottom(): void {
    if (this.messagesContainer) {
      try {
        this.messagesContainer.nativeElement.scrollTop = this.messagesContainer.nativeElement.scrollHeight;
      } catch (err) {
        console.error('Erro ao rolar para a última mensagem:', err);
      }
    }
  }

  openParticipantOptions(participant: any): void {
    // Abra um modal ou uma caixa de opções para o participante
    console.log('Opções para o participante:', participant);
  }

  private loadParticipants(roomId: string): void {
    this.participantSubscription?.unsubscribe();
    this.participantSubscription = this.roomParticipants.getParticipants(roomId).subscribe({
      next: (participants) => {
        this.participants = participants;
        if (this.creatorDetails) {
          this.addCreatorToParticipants();
        }
      },
      error: (err: any) => {
        this.errorNotifier.showError('Erro ao carregar participantes.');
        console.error(err);
      }
    });
  }

  private loadRoomCreator(roomId: string): void {
    this.creatorSubscription?.unsubscribe();
    this.creatorSubscription = this.roomParticipants.getRoomCreator(roomId).subscribe({
      next: (creator) => {
        this.creatorDetails = creator;
        this.addCreatorToParticipants();
      },
      error: (err) => {
        this.errorNotifier.showError('Erro ao carregar informações do criador da sala.');
        console.error(err);
      }
    });
  }

  private addCreatorToParticipants(): void {
    if (!this.creatorDetails) return;

    const creatorAlreadyAdded = this.participants.some(
      (p) => p.uid === this.creatorDetails?.uid // Verifica pelo UID do criador para evitar duplicação
    );

    if (!creatorAlreadyAdded) {
      this.participants.unshift({
        nickname: this.creatorDetails.nickname || 'Criador',
        photoURL: this.creatorDetails.photoURL || 'assets/default-avatar.png',
        isCreator: true,
        isOnline: this.creatorDetails.isOnline,
        gender: this.creatorDetails.gender,
        municipio: this.creatorDetails.municipio,
        uid: this.creatorDetails.uid // Inclui o UID para verificação futura
      });
    }
  }

  sendMessage(): void {
    if (!this.messageContent.trim()) {
      this.errorNotifier.showWarning('Mensagem vazia. Não será enviada.');
      return;
    }

    if (!this.roomId) {
      this.errorNotifier.showError('Erro: ID da sala não definido.');
      return;
    }

    if (!this.currentUser?.uid) {
      this.errorNotifier.showError('Erro: Usuário não encontrado.');
      return;
    }

    const user = this.currentUser; // Obtenha diretamente do estado.
    const nickname = user.nickname || 'Usuário não identificado';

    const newMessage: Message = {
      content: this.messageContent.trim(),
      senderId: user.uid,
      nickname: nickname,
      timestamp: Timestamp.fromDate(new Date())
    };

    this.roomMessages.sendMessageToRoom(this.roomId, newMessage)
      .then(() => {
        this.messageContent = '';
        this.scrollToBottom();
      })
      .catch((err) => {
        this.errorNotifier.showError('Erro ao enviar mensagem.');
        console.error(err);
      });
  }

  ngOnDestroy(): void {
    this.messageSubscription?.unsubscribe();
    this.participantSubscription?.unsubscribe();
    this.creatorSubscription?.unsubscribe();
  }
}
