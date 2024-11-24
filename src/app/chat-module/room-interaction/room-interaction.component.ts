//src\app\chat-module\room-interaction\room-interaction.component.ts
import { Component, Input, OnInit, OnDestroy, SimpleChanges, OnChanges } from '@angular/core';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Subscription } from 'rxjs';
import { Timestamp } from '@firebase/firestore';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { RoomParticipantsService } from 'src/app/core/services/batepapo/room-services/room-participants.service';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';

@Component({
  selector: 'app-room-interaction',
  templateUrl: './room-interaction.component.html',
  styleUrls: ['./room-interaction.component.css'],
  standalone: false
})
export class RoomInteractionComponent implements OnInit, OnChanges, OnDestroy {
  @Input() roomId!: string | undefined;

  participants: { nickname: string; photoURL?: string; isCreator?: boolean }[] = [];
  creatorDetails: IUserDados | null = null;
  messages: Message[] = [];
  messageContent: string = '';
  private messageSubscription?: Subscription;
  private participantSubscription?: Subscription;
  private creatorSubscription?: Subscription;

  constructor(
    private roomService: RoomService,
    private roomParticipants:RoomParticipantsService,
    private roomMessages:RoomMessagesService,
    private errorNotifier: ErrorNotificationService
  ) { }

  ngOnInit(): void {
    if (!this.roomId) {
      this.errorNotifier.showError('ID da sala não fornecido.');
      return;
    }

    this.loadMessages(this.roomId);
    this.loadParticipants(this.roomId);
    this.loadRoomCreator(this.roomId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['roomId']?.currentValue) {
      const newRoomId = changes['roomId'].currentValue;
      this.loadMessages(newRoomId);
      this.loadParticipants(newRoomId);
      this.loadRoomCreator(newRoomId);
    }
  }

  private loadMessages(roomId: string): void {
    this.messageSubscription?.unsubscribe();
    this.messageSubscription = this.roomMessages.getRoomMessages(roomId).subscribe({
      next: (messages) => {
        this.messages = messages;
      },
      error: (err: any) => {
        this.errorNotifier.showError('Erro ao carregar mensagens.');
        console.error(err);
      }
    });
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
      (p) => p.nickname === this.creatorDetails?.nickname
    );

    if (!creatorAlreadyAdded) {
      this.participants.unshift({
        nickname: this.creatorDetails.nickname || 'Criador',
        photoURL: this.creatorDetails.photoURL || 'assets/default-avatar.png',
        isCreator: true,
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

    const newMessage: Message = {
      content: this.messageContent.trim(),
      senderId: 'currentUserUID', // Substitua pelo ID do usuário autenticado
      timestamp: Timestamp.fromDate(new Date())
    };

    this.roomMessages.sendMessageToRoom(this.roomId, newMessage)
      .then(() => {
        this.messageContent = '';
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
