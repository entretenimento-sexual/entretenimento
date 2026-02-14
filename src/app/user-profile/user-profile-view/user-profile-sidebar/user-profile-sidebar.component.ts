// src/app/user-profile/user-profile-view/user-profile-sidebar/user-profile-sidebar.component.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';

import { Observable, of, EMPTY, combineLatest } from 'rxjs';
import { distinctUntilChanged, map, switchMap, take, tap, catchError } from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';

import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';

enum SidebarState { CLOSED, OPEN }

@Component({
  selector: 'app-user-profile-sidebar',
  standalone: true,
  templateUrl: './user-profile-sidebar.component.html',
  styleUrls: ['./user-profile-sidebar.component.css'],
  imports: [CommonModule, RouterModule, MatButtonModule],
})
export class UserProfileSidebarComponent implements OnInit {
  // ===== Injeções
  private readonly destroyRef = inject(DestroyRef);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly session = inject(AuthSessionService); // Mantido: útil p/ debug e evolução do gate
  private readonly firestoreUserQuery = inject(FirestoreUserQueryService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly roomManagement = inject(RoomManagementService);
  private readonly dialog = inject(MatDialog);

  // ===== Debug (simples e controlado)
  // Dica: se você já tem um "DebugService", dá pra centralizar isso depois.
  private readonly DEBUG = true;
  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[UserProfileSidebar] ${msg}`, data ?? '');
  }

  // ===== UI state
  public readonly SidebarState = SidebarState;
  public isSidebarVisible: SidebarState = SidebarState.CLOSED;

  /** UID do usuário logado */
  readonly currentUid$ = this.currentUserStore.user$.pipe(
    map(u => u?.uid ?? null),
    distinctUntilChanged(),
    tap(uid => this.debug('currentUid$', uid))
  );

  /** Dados do usuário logado (para foto/nickname da lateral) */
  readonly usuario$: Observable<IUserDados | null> = this.currentUid$.pipe(
    switchMap(uid => (uid ? this.firestoreUserQuery.getUser(uid) : of(null))),
    tap(user => this.debug('usuario$', { hasUser: !!user, uid: user?.uid }))
  );

  /**
   * UID do perfil em visualização:
   * - Você pode trocar isso para ActivatedRoute paramMap quando quiser voltar ao modo “perfil de terceiros”.
   * - Por enquanto, este sidebar fica com comportamento “meu perfil” mais estável.
   */
  readonly viewedUid$ = this.currentUid$.pipe(distinctUntilChanged());

  /** Está no próprio perfil? (baseado em UID logado vs UID em visualização) */
  readonly isOwnProfile$ = combineLatest([this.currentUid$, this.viewedUid$]).pipe(
    map(([cur, viewed]) => !!cur && !!viewed && cur === viewed),
    distinctUntilChanged(),
    tap(isOwn => this.debug('isOwnProfile$', isOwn))
  );

  ngOnInit(): void {
    // Apenas para marcar o ciclo do componente no console.
    this.debug('init');
  }

  /** Alterna sidebar (útil p/ mobile). */
  toggleSidebar(): void {
    this.isSidebarVisible =
      this.isSidebarVisible === SidebarState.OPEN ? SidebarState.CLOSED : SidebarState.OPEN;
  }

  /** Fecha sidebar (útil após clique em links no mobile). */
  closeSidebar(): void {
    this.isSidebarVisible = SidebarState.CLOSED;
  }

  /** Cria sala caso assinante; caso não seja, abre diálogo de upsell */
  createRoomIfSubscriber(): void {
    this.currentUserStore.user$.pipe(
      take(1),
      switchMap(user => {
        if (!user?.uid) {
          this.errorNotifier.showError('Faça login para criar uma sala.');
          return EMPTY;
        }

        const isSubscriber =
          !!user.isSubscriber || ['premium', 'vip'].includes((user as any)?.role ?? '');

        if (!isSubscriber) {
          this.openDialog();
          return EMPTY;
        }

        const roomDetails = {
          roomName: 'Minha nova sala',
          description: 'Bem-vindo(a)!',
          isPrivate: true,
        };

        // Mantém o fluxo reativo + tratamento centralizado via ErrorNotificationService.
        return this.roomManagement.createRoom(roomDetails, user.uid).pipe(
          tap(() => this.errorNotifier.showSuccess('Sala criada com sucesso!')),
          catchError((err) => {
            this.errorNotifier.showError(err);
            return EMPTY;
          })
        );
      })
    ).subscribe();
  }

  /** Upsell: convite à assinatura */
  openDialog(): void {
    this.dialog.open(ConfirmacaoDialogComponent, {
      data: {
        title: 'Assinatura necessária',
        message: 'Assine para criar salas exclusivas e desbloquear recursos premium.',
      },
    });
  }
}
