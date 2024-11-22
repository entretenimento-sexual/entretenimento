//src\app\chat-module\chat-rooms\chat-rooms.component.ts
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { CreateRoomModalComponent } from '../create-room-modal/create-room-modal.component';
import { InfoCriaSalaBpComponent } from 'src/app/core/textos-globais/info-cria-sala-bp/info-cria-sala-bp.component';
import { SubscriptionService } from 'src/app/core/services/subscriptions/subscription.service';
import { RoomCreationConfirmationModalComponent } from '../room-creation-confirmation-modal/room-creation-confirmation-modal.component';
import { RoomService } from 'src/app/core/services/batepapo/room.service';

@Component({
    selector: 'app-chat-rooms',
    templateUrl: './chat-rooms.component.html',
    styleUrls: ['./chat-rooms.component.css'],
    standalone: false
})

export class ChatRoomsComponent implements OnInit {
  @Output() roomSelected = new EventEmitter<string>();
  // Lista de salas de bate-papo
  chatRooms: any[] = [];
  currentUser: IUserDados | null = null;

constructor(private authService: AuthService,
            private subscriptionService: SubscriptionService,
            private roomService: RoomService,
            public dialog: MatDialog) { }

  ngOnInit(): void {
    this.authService.user$.subscribe(user => {
      this.currentUser = user;
      if (user?.uid) {
        this.roomService.getUserRooms(user.uid).subscribe(rooms => {
          this.chatRooms = rooms;
          console.log('Salas do usuário:', this.chatRooms);
        }, error => {
          console.error("Erro ao obter salas:", error);
        });
      }
    });
  }

  selectRoom(roomId: string): void {
    console.log(`Sala selecionada com ID: ${roomId}`);
    this.roomSelected.emit(roomId); // Emite o evento para o pai
  }


  openCreateRoomModal(): void {
    if (!this.currentUser) {
      alert('Você precisa estar logado para criar uma sala.');
      return;
    }

    this.roomService.countUserRooms(this.currentUser.uid).then(roomCount => {
      const MAX_ROOMS_ALLOWED = 1;
      if (roomCount >= MAX_ROOMS_ALLOWED) {
        alert('Você já possui uma sala criada.');
        return;
      }

      if (this.currentUser && (this.currentUser.isSubscriber || ['premium', 'vip'].includes(this.currentUser.role))) {
       const dialogRef = this.dialog.open(CreateRoomModalComponent, {
        width: '60vw',
        // Passar dados necessários, se houver
      });

      dialogRef.afterClosed().subscribe(result => {
        if (result && result.success) {
          if (result.action === 'created') {
            this.openRoomCreationConfirmationModal(result.roomId, false, result.roomCount, result.roomName, result.action);
          } else if (result.action === 'updated') {
            this.openRoomCreationConfirmationModal(result.roomId, false, result.roomCount, result.roomName, 'updated');
          }
        } else if (result && result.error) {
          alert(result.error); // Mostra a mensagem de erro (e.g., limite de salas atingido).
        }
      });
    } else {
      this.subscriptionService.promptSubscription({
        title: "Ação restrita",
        message: "Você precisa ser assinante ou ter um perfil premium/vip para criar salas. Gostaria de conhecer nossos planos?",
      });
    }
    }).catch(error => {
      console.error("Erro ao verificar o número de salas criadas pelo usuário: ", error);
    });
  }

  private openRoomCreationConfirmationModal(roomId: string, exceededLimit: boolean, roomCount: number, roomName: string, action: 'created' | 'updated'): void {
    this.dialog.open(RoomCreationConfirmationModalComponent, {
      data: {
        roomId,
        exceededLimit,
        roomCount,
        roomName,
        action
      },
    });
  }

  openInfoCriaSalaBpModal(event: Event): void {
    event.preventDefault();
    const dialogRef = this.dialog.open(InfoCriaSalaBpComponent, {
      width: '50vw',
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('O modal foi fechado');
    });
  }

  createRoom() {
    if (!this.currentUser) {
      alert('Você precisa estar logado para criar uma sala.');
      return;
    }

    const now = new Date();

    if (this.currentUser.isSubscriber) {
      // O usuário é assinante e pode criar salas livremente.
      this.createChatRoomWithExpiration(); // Substitua por lógica real de criação de sala sem expiração
    } else if (this.currentUser.singleRoomCreationRightExpires && now < new Date(this.currentUser.singleRoomCreationRightExpires)) {
      // O usuário tem direito a criar uma sala por um pagamento único, e o direito ainda não expirou.
      this.createChatRoomWithExpiration(new Date(this.currentUser.singleRoomCreationRightExpires));
    } else {
      // O usuário não é assinante e não tem direitos especiais.
      this.offerRoomCreationOptions();
    }
  }

  private offerRoomCreationOptions() {
    const createRoomForFee = confirm('Você não é um assinante. Deseja criar uma sala por R$ 1,99 válida por 1 mês?');
    if (createRoomForFee) {
      this.startPaymentProcess().then(paymentConfirmed => {
        if (paymentConfirmed) {
          this.createChatRoomWithExpiration();
        }
      }).catch(error => {
        console.error('Erro no processo de pagamento:', error);
        // Tratar erros do processo de pagamento
      });
    } else {
      // O usuário optou por não pagar, redirecione ou informe sobre as opções de assinatura
    }
  }

  private createChatRoomWithExpiration(expirationDate?: Date) {
    // A lógica para criar a sala de bate-papo no Firestore
    // Se expirationDate for fornecido, configure a sala para expirar nessa data
    // Caso contrário, a sala não tem data de expiração
    if (expirationDate) {
      // Configura a sala de bate-papo para expirar na 'expirationDate'
      console.log(`Criando sala com expiração em: ${expirationDate.toISOString()}`);
    } else {
      // Configura a sala de bate-papo sem expiração
      console.log("Criando sala sem expiração.");
    }
    // Aqui você implementaria a criação da sala de bate-papo no Firestore,
    // possivelmente adicionando um campo 'expirationDate' ao documento da sala se 'expirationDate' estiver definido.
  }

  private showSubscriptionOptions() {
    // Mostrar opções de assinatura ou pagamento único para não assinantes
    const subscribeOption = confirm('Você deseja se tornar um assinante?');
    if (subscribeOption) {
      // Redirecionar para a página de assinatura
    } else {
      const singlePaymentOption = confirm('Deseja pagar por uma sala única válida por um mês?');
      if (singlePaymentOption) {
        // Iniciar o processo de pagamento para uma sala única
      }
    }
  }

  private startPaymentProcess(): Promise<boolean> {
    // Implemente a lógica de pagamento aqui
    // Esta lógica deve ser capaz de lidar com pagamentos tanto de assinantes quanto de não assinantes
    // Retorne um Promise que resolve para true se o pagamento for confirmado
    return Promise.resolve(true); // provisório até a implantação do sistema de pagamento
  }

  inviteToRoom(roomId: string) {
    // Lógica para convidar usuários para a sala
  }

  openRoom(roomId: string) {
    // Lógica para abrir uma sala específica e visualizar as mensagens
  }
}

