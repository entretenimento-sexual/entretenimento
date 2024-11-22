//src\app\chat-module\room-interaction\room-interaction.component.ts
import { Component, Input, OnInit, OnDestroy, SimpleChanges, OnChanges } from '@angular/core';
import { RoomService } from 'src/app/core/services/batepapo/room.service';
import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { Subscription } from 'rxjs';
import { Timestamp } from '@firebase/firestore';

@Component({
    selector: 'app-room-interaction',
    templateUrl: './room-interaction.component.html',
    styleUrls: ['./room-interaction.component.css'],
    standalone: false
})
export class RoomInteractionComponent implements OnInit, OnChanges, OnDestroy {
  // Lista de participantes da sala
  participants: { nickname: string; photoURL?: string }[] = [];

  // ID da sala recebido como entrada do componente pai
  @Input() roomId!: string | undefined;

  // Lista de mensagens da sala
  messages: Message[] = [];

  // Conteúdo da mensagem atual a ser enviada
  messageContent: string = '';

  // Subscrições para evitar vazamentos de memória
  private messageSubscription?: Subscription;
  private participantSubscription?: Subscription;

  constructor(private roomService: RoomService) { }

  ngOnInit(): void {
    console.log('RoomInteractionComponent iniciado.');

    // Verifica se há um `roomId` válido e carrega os dados da sala
    if (!this.roomId) {
      console.error('Erro: RoomInteractionComponent precisa de um roomId válido.');
      return;
    }

    // Carrega as mensagens da sala
    this.loadMessages(this.roomId);

    // Carrega os participantes da sala
    this.loadParticipants(this.roomId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Detecta alterações no `roomId` e recarrega mensagens e participantes
    if (changes['roomId'] && changes['roomId'].currentValue) {
      console.log('RoomInteractionComponent recebeu novo roomId:', changes['roomId'].currentValue);
      const newRoomId = changes['roomId'].currentValue;
      this.loadMessages(newRoomId);
      this.loadParticipants(newRoomId);
    }
  }

  private loadMessages(roomId: string): void {
    console.log(`Carregando mensagens para o roomId: ${roomId}`);

    // Cancela a assinatura anterior, se existir
    this.messageSubscription?.unsubscribe();

    // Obtém as mensagens da sala em tempo real
    this.messageSubscription = this.roomService.getRoomMessages(roomId, true).subscribe({
      next: (messages) => {
        this.messages = messages;
        console.log('Mensagens carregadas:', this.messages);
      },
      error: (err) => {
        console.error('Erro ao carregar mensagens:', err);
      }
    });
  }

  private loadParticipants(roomId: string): void {
    console.log(`Carregando participantes para o roomId: ${roomId}`);

    // Cancela a assinatura anterior, se existir
    this.participantSubscription?.unsubscribe();

    // Obtém a lista de participantes em tempo real
    this.participantSubscription = this.roomService.getRoomParticipants(roomId).subscribe({
      next: (participants: { nickname: string; photoURL?: string }[]) => {
        this.participants = participants;
        console.log('Participantes carregados:', this.participants);
      },
      error: (err) => {
        console.error('Erro ao carregar participantes:', err);
      }
    });
  }

  sendMessage(): void {
    // Validações antes de enviar a mensagem
    if (!this.messageContent.trim()) {
      console.log('Mensagem vazia. Não será enviada.');
      return;
    }

    if (!this.roomId) {
      console.error('Erro: roomId está undefined.');
      return;
    }

    // Criação da mensagem com o conteúdo atual
    const newMessage: Message = {
      content: this.messageContent.trim(),
      senderId: '', // O ID do usuário será adicionado pelo serviço
      timestamp: Timestamp.fromDate(new Date())
    };

    // Envia a mensagem usando o serviço
    this.roomService
      .sendMessageToRoom(this.roomId, newMessage)
      .then(() => {
        console.log('Mensagem enviada com sucesso.');
        this.messageContent = ''; // Limpa o campo de entrada de mensagem
      })
      .catch((err) => console.error('Erro ao enviar mensagem:', err));
  }

  ngOnDestroy(): void {
    // Cancela todas as assinaturas ao destruir o componente
    this.messageSubscription?.unsubscribe();
    this.participantSubscription?.unsubscribe();
    console.log('RoomInteractionComponent destruído.');
  }
}
