// src\app\user-profile\user-profile-view\user-profile-sidebar\user-profile-sidebar.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { tap } from 'rxjs/operators';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FirestoreQueryService } from 'src/app/core/services/autentication/firestore-query.service';

enum SidebarState { CLOSED, OPEN }

@Component({
    selector: 'app-user-profile-sidebar',
    templateUrl: './user-profile-sidebar.component.html',
    styleUrls: ['./user-profile-sidebar.component.css'],
    standalone: false
})

export class UserProfileSidebarComponent implements OnInit, OnDestroy {
  private sidebarSubscription?: Subscription;
  public isSidebarVisible = SidebarState.CLOSED;
  public usuario$!: Observable<IUserDados | null>;
  public uid: string | null = null;
  private userSubscription?: Subscription;

  constructor(
    private authService: AuthService,
    private usuarioService: UsuarioService,
    private firestoreQuery: FirestoreQueryService,
    private errorNotifier: ErrorNotificationService,
    private roomManagement:RoomManagementService,
    private dialog: MatDialog
  ) { }

  ngOnInit(): void {
    // Assina o observable user$ e armazena o uid do usuário autenticado
    this.userSubscription = this.authService.user$.pipe(
      tap((currentUser) => {
        if (currentUser) {
          this.uid = currentUser.uid;
          // Obter os dados do usuário
          this.usuario$ = this.firestoreQuery.getUser(currentUser.uid);
        } else {
          this.uid = null;
        }
      })
    ).subscribe();
  }

  // Método para verificar se o usuário está em seu próprio perfil
  isOnOwnProfile(): boolean {
    // Verifica se o usuário autenticado e o perfil atual são iguais
    return this.uid !== null;
  }

  // Criar sala se o usuário for assinante
  createRoomIfSubscriber() {
    const roomDetails = {
      roomName: 'Nome da Sala', // Aqui você deve definir os detalhes necessários da sala
      description: 'Descrição da Sala', // Ajuste conforme as informações necessárias
      isPrivate: true // ou false, conforme o tipo de sala
    };

    if (this.uid) {
      this.roomManagement.createRoom(roomDetails, this.uid).subscribe({
        next: (result) => {
          console.log('Sala criada com sucesso:', result);
          // Redirecionar para a sala ou mostrar confirmação
        },
        error: (error) => {
          this.errorNotifier.showError(error);
        }
      });
    }
  }

  // Abrir um diálogo para informar a necessidade de assinatura
  openDialog(): void {
    this.dialog.open(ConfirmacaoDialogComponent, {
      data: {
        title: "Assinatura Necessária",
        message: "Você deseja se tornar um assinante para criar salas?"
      }
    });
  }

  ngOnDestroy(): void {
    // Cancela a assinatura quando o componente for destruído
    this.userSubscription?.unsubscribe();
    this.sidebarSubscription?.unsubscribe();
  }
}
