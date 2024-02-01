//src\app\chat-module\chat-rooms\chat-rooms.component.ts
import { Component, OnInit } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-chat-rooms',
  templateUrl: './chat-rooms.component.html',
  styleUrls: ['./chat-rooms.component.css']
})

export class ChatRoomsComponent implements OnInit {
  // Lista de salas de bate-papo
  chatRooms: any[] = [];
  currentUser: IUserDados | null = null;

  isModalOpen = false;

  constructor(private authService: AuthService) { }

  ngOnInit(): void {
    this.authService.user$.subscribe(user => {
      this.currentUser = user;
    });
    // Aqui você pode carregar as salas de bate-papo do usuário
  }

  createRoom() {
    if (!this.currentUser) {
      alert('Você precisa estar logado para criar uma sala.');
      return;
    }

    if (this.currentUser.role === 'extase' /* Substitua pelo role de assinante */) {
      this.createChatRoomWithExpiration(); // Usuário já é um assinante
    } else {
      this.offerRoomCreationOptions(); // Usuário não é assinante
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

  private canCreateRoomBasedOnRole(role: string): boolean {
    // Substitua esta lógica conforme as regras de negócio
    const allowedRoles = ['animando', 'decidido', 'articulador', 'extase'];
    return allowedRoles.includes(role);
  }

  private createChatRoomWithExpiration() {
    const expirationDate = new Date();
    expirationDate.setMonth(expirationDate.getMonth() + 1); // Um mês a partir de agora

    // Implemente a lógica para criar a sala de bate-papo no Firestore com a data de expiração
    // ...
  }

  private showSubscriptionOptions() {
    // Mostrar opções de assinatura ou pagamento único para não assinantes
    const subscribeOption = confirm('Deseja se tornar um assinante?');
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

  openModal(event: Event) {
    event.preventDefault();
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
  }

  navigateToSubscription() {
    // Implementar navegação para a página de assinatura
  }

  startSinglePaymentProcess() {
    // Implementar lógica para iniciar o processo de pagamento único
  }
}

