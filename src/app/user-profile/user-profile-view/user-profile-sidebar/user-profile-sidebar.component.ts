// src\app\user-profile\user-profile-view\user-profile-sidebar\user-profile-sidebar.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { RoomService } from 'src/app/core/services/batepapo/room.service';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { MatDialog } from '@angular/material/dialog';

enum SidebarState { CLOSED, OPEN }

@Component({
  selector: 'app-user-profile-sidebar',
  templateUrl: './user-profile-sidebar.component.html',
  styleUrls: ['./user-profile-sidebar.component.css']
})

export class UserProfileSidebarComponent implements OnInit {
  private sidebarSubscription?: Subscription;
  public isSidebarVisible = SidebarState.CLOSED;
  public usuario$!: Observable<IUserDados | null>;
  public uid!: string | null;

  constructor(private authService: AuthService,
              private usuarioService: UsuarioService,
              private roomService: RoomService,
              private dialog: MatDialog) { }

  ngOnInit(): void {
    const userId = this.authService.currentUser?.uid || ''; // Garante que userId seja uma string
    this.usuario$ = this.usuarioService.getUsuario(userId);
    this.uid = this.authService.currentUser?.uid || null; // Garante que uid seja string ou null
  }

  isOnOwnProfile(): boolean {
    return this.uid === this.authService.currentUser?.uid;
  }

  createRoomIfSubscriber() {
    this.roomService.createRoom({ /* detalhes da sala */ }).subscribe({
      next: (result) => {
        console.log('Sala criada com sucesso:', result);
        // Redirecionar para a sala ou mostrar confirmação
      },
      error: (error) => {
        console.error(error.message);
        // Já tratado pelo prompt de assinatura no RoomService
      }
    });
  }

  openDialog(): void {
    this.dialog.open(ConfirmacaoDialogComponent, {
      data: { title: "Assinatura Necessária",
      message: "Você deseja se tornar um assinante para criar salas?" }
    });
  }
}
