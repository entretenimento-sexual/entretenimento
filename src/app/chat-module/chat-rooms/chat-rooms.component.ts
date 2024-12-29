// src\app\chat-module\chat-rooms\chat-rooms.component.ts
import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { InfoCriaSalaBpComponent } from 'src/app/core/textos-globais/info-cria-sala-bp/info-cria-sala-bp.component';
import { SubscriptionService } from 'src/app/core/services/subscriptions/subscription.service';
import { RoomCreationConfirmationModalComponent } from '../modals/room-create-confirm-modal/room-creation-confirmation-modal.component';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { CreateRoomModalComponent } from '../modals/create-room-modal/create-room-modal.component';

@Component({
  selector: 'app-chat-rooms',
  templateUrl: './chat-rooms.component.html',
  styleUrls: ['./chat-rooms.component.css'],
  standalone: false
})
export class ChatRoomsComponent implements OnInit {
  @Output() roomSelected = new EventEmitter<string>();
  chatRooms: any[] = []; // Lista de salas de bate-papo
  currentUser: IUserDados | null = null; // Usuário autenticado

  constructor(
    private authService: AuthService,
    private subscriptionService: SubscriptionService,
    private roomService: RoomService,
    private roomManagement: RoomManagementService,
    private errorNotifier: ErrorNotificationService,
    public dialog: MatDialog
  ) { }

  ngOnInit(): void {
    // Assina o observable do usuário atual para obter o usuário autenticado
    this.authService.user$.subscribe(
      (user) => {
        this.currentUser = user;
        if (user?.uid) {
          this.loadUserRooms(user.uid);
        }
      },
      (error) => {
        this.errorNotifier.showError('Erro ao carregar informações do usuário.');
      }
    );
  }

  /**
   * Carrega as salas do usuário autenticado.
   * @param userId ID do usuário.
   */
  loadUserRooms(userId: string): void {
    this.roomService.getUserRooms(userId).subscribe(
      (rooms) => {
        this.chatRooms = rooms;
        console.log('Salas carregadas:', this.chatRooms);
      },
      (error) => {
        this.errorNotifier.showError('Erro ao carregar salas.');
        console.error('Erro ao buscar salas:', error);
      }
    );
  }

  /**
   * Seleciona uma sala para interação.
   * @param roomId ID da sala selecionada.
   */
  selectRoom(roomId: string): void {
    console.log(`Sala selecionada: ${roomId}`);
    this.roomSelected.emit(roomId);
  }

  /**
   * Abre o modal para criar uma sala.
   */
  openCreateRoomModal(): void {
    if (!this.currentUser) {
      this.errorNotifier.showWarning('Você precisa estar logado para criar uma sala.');
      return;
    }

    const creatorId = this.currentUser.uid;

    this.roomService.countUserRooms(creatorId).then((roomCount) => {
      const MAX_ROOMS_ALLOWED = 1;

      if (roomCount >= MAX_ROOMS_ALLOWED) {
        this.errorNotifier.showInfo('Você já atingiu o limite de salas criadas.');
        return;
      }

      if (this.currentUser?.isSubscriber || ['premium', 'vip'].includes(this.currentUser?.role || '')) {
        const dialogRef = this.dialog.open(CreateRoomModalComponent, {
          width: '60vw',
        });

        // Aguarda o fechamento do modal antes de abrir outro
        dialogRef.afterClosed().subscribe((result: { success?: boolean; roomId?: string; roomName?: string; action?: 'created' | 'updated'; error?: string, roomDetails?: any }) => {
          if (result?.success && result.roomDetails) {
            this.roomManagement.createRoom(result.roomDetails, creatorId).subscribe({
              next: (response: any) => {
                // Garantindo que o tipo da resposta seja tratado como esperado
                if (response && typeof response === 'object') {
                  this.openRoomCreationConfirmationModal(
                    response.roomId,
                    false,
                    1,
                    response.roomName,
                    response.action
                  );
                }
              },
              error: (error) => this.errorNotifier.showError(error),
            });
          } else if (result?.error) {
            this.errorNotifier.showError(result.error);
          }
        });

      } else {
        this.subscriptionService.promptSubscription({
          title: 'Permissão necessária',
          message: 'Você precisa ser assinante ou ter um perfil premium/vip para criar salas.',
        });
      }
    });
  }

  /**
   * Abre o modal de confirmação após criar/atualizar uma sala.
   * @param roomId ID da sala criada.
   * @param exceededLimit Se o limite foi excedido.
   * @param roomCount Contagem de salas do usuário.
   * @param roomName Nome da sala.
   * @param action Ação realizada (criada/atualizada).
   */
  private openRoomCreationConfirmationModal(
    roomId: string,
    exceededLimit: boolean,
    roomCount: number,
    roomName: string,
    action: 'created' | 'updated'
  ): void {
    this.dialog.open(RoomCreationConfirmationModalComponent, {
      data: { roomId, exceededLimit, roomCount, roomName, action },
    });
  }

  /**
   * Abre um modal com informações adicionais sobre a criação de salas.
   * @param event Evento de clique.
   */
  openInfoCriaSalaBpModal(event: Event): void {
    event.preventDefault();
    this.dialog.open(InfoCriaSalaBpComponent, {
      width: '50vw',
    });
  }
}
