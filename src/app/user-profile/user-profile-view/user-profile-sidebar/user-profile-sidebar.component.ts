// src/app/user-profile/user-profile-view/user-profile-sidebar/user-profile-sidebar.component.ts
import { Component, DestroyRef, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';

import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import { distinctUntilChanged, map, switchMap, take, tap } from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';

// 🔄 Nova base (substitui AuthService)
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
export class UserProfileSidebarComponent implements OnInit, OnDestroy {
  // ===== Injeções
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreUserQuery = inject(FirestoreUserQueryService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly roomManagement = inject(RoomManagementService);
  private readonly dialog = inject(MatDialog);

  // ===== UI state
  public isSidebarVisible = SidebarState.CLOSED;

  // ===== Streams base
  /** UID do usuário logado */
  readonly currentUid$ = this.currentUserStore.user$.pipe(
    map(u => u?.uid ?? null),
    distinctUntilChanged()
  );

  /** Dados do usuário logado (para foto/nickname da lateral) */
  readonly usuario$: Observable<IUserDados | null> = this.currentUid$.pipe(
    switchMap(uid => (uid ? this.firestoreUserQuery.getUser(uid) : of(null)))
  );

  /** UID do perfil em visualização (= param 'id' da rota) */
  readonly viewedUid$ = this.route.paramMap.pipe(
    map(p => p.get('id')),
    distinctUntilChanged()
  );

  /** Está no próprio perfil? (para esconder o link “Meu perfil”) */
  readonly isOwnProfile$ = combineLatest([this.currentUid$, this.viewedUid$]).pipe(
    map(([cur, viewed]) => !!cur && !!viewed && cur === viewed),
    distinctUntilChanged()
  );

  /** UID atual em memória (para bindings não assíncronos de routerLink) */
  private _uidSnapshot$ = new BehaviorSubject<string | null>(null);
  get uid(): string | null { return this._uidSnapshot$.value; }

  ngOnInit(): void {
    // espelha o UID atual para facilitar links no template
    this.currentUid$.pipe(take(1)).subscribe(uid => this._uidSnapshot$.next(uid));
  }

  ngOnDestroy(): void {
    // Nada a limpar manualmente — usamos pipes finitos / async no template.
  }

  /** Cria sala caso assinante; caso não seja, abre diálogo de upsell */
  createRoomIfSubscriber(): void {
    this.currentUserStore.user$.pipe(take(1)).subscribe(user => {
      const isSubscriber =
        !!user?.isSubscriber || ['premium', 'vip'].includes((user as any)?.role ?? '');

      if (!user?.uid) {
        this.errorNotifier.showError('Faça login para criar uma sala.');
        return;
      }
      if (!isSubscriber) {
        this.openDialog();
        return;
      }

      const roomDetails = {
        roomName: 'Minha nova sala',
        description: 'Bem-vindo(a)!',
        isPrivate: true,
      };

      this.roomManagement.createRoom(roomDetails, user.uid).subscribe({
        next: () => {
          // (Opcional) navegar/confirmar
          // this.router.navigate(['/chat', roomId]);
          this.errorNotifier.showSuccess('Sala criada com sucesso!');
        },
        error: (err) => this.errorNotifier.showError(err),
      });
    });
  }

  /** Upsell: convite à assinatura */
  openDialog(): void {
    this.dialog.open(ConfirmacaoDialogComponent, {
      data: {
        title: 'Assinatura necessária',
        message: 'Assine para criar salas exclusivas e desbloquear recursos premium.',
        // (Opcional) botões extras podem ser tratados dentro do dialog.
      },
    });
  }
}
