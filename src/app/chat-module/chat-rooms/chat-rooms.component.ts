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

  private canCreateRoomBasedOnRole(role: string): boolean {
    // Substitua esta lógica conforme as regras de negócio
    const allowedRoles = ['animando', 'decidido', 'articulador', 'extase'];
    return allowedRoles.includes(role);
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

