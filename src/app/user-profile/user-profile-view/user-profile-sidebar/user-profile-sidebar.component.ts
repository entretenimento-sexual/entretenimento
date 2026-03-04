// src/app/user-profile/user-profile-view/user-profile-sidebar/user-profile-sidebar.component.ts
// Mantém debug e melhora a consistência de sessão no refresh (fonte única: AuthSessionService).
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Observable, of, EMPTY, combineLatest } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, switchMap, take, tap, catchError } from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';

import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';

enum SidebarState { CLOSED, OPEN }

type SidebarVm = {
  ready: boolean;
  uid: string | null;
  usuario: IUserDados | null;
  viewedUid: string | null;
  isOwnProfile: boolean;
};

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
  private readonly route = inject(ActivatedRoute);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly session = inject(AuthSessionService);

  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly roomManagement = inject(RoomManagementService);
  private readonly dialog = inject(MatDialog);

  // ===== Debug (simples e controlado)
  private readonly DEBUG = true;
  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[UserProfileSidebar] ${msg}`, data ?? '');
  }

  // ===== UI state
  public readonly SidebarState = SidebarState;
  public isSidebarVisible: SidebarState = SidebarState.CLOSED;

  /**
   * ✅ Fonte única de sessão (uid/ready):
   * - UID vem do Firebase Auth (AuthSessionService), não do store.
   * - Evita “flash de guest” no refresh quando o store ainda não hidratou.
   */
  private readonly sessionUid$ = combineLatest([this.session.ready$, this.session.uid$]).pipe(
    map(([ready, uid]) => (ready ? uid : null)),
    distinctUntilChanged(),
    tap(uid => this.debug('sessionUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Dados do usuário (store):
   * - Pode chegar depois do uid (hidratação via effects).
   * - Mantém “fonte única” de dados do usuário = store.
   */
  private readonly usuarioStore$ = this.currentUserStore.user$.pipe(
    distinctUntilChanged((a, b) =>
      (a?.uid ?? null) === (b?.uid ?? null) &&
      (a?.nickname ?? null) === (b?.nickname ?? null) &&
      (a?.photoURL ?? null) === (b?.photoURL ?? null)
    ),
    tap(user => this.debug('usuarioStore$', { hasUser: !!user, uid: user?.uid })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * UID em rota (/perfil/:uid ou /perfil):
   * - Mantém compatibilidade com :uid e :id (você tem ambos no routing hoje).
   */
  private readonly routeUid$ = this.route.paramMap.pipe(
    map(pm => pm.get('uid') ?? pm.get('id') ?? null),
    distinctUntilChanged(),
    tap(uid => this.debug('routeUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * ✅ VM único para template:
   * - 1 async pipe só -> elimina estado “quebrado” por múltiplos subscriptions.
   * - `uid` é da sessão (firebase).
   * - `usuario` vem do store, mas só é aceito se bater com o uid atual.
   */
  readonly vm$: Observable<SidebarVm> = combineLatest([
    this.session.ready$,
    this.sessionUid$,
    this.usuarioStore$,
    this.routeUid$,
  ]).pipe(
    map(([ready, uid, usuario, routeUid]) => {
      const viewedUid = routeUid ?? uid;

      // Evita “stale user” (ex.: store com usuário antigo vs uid atual)
      const safeUsuario = uid && usuario?.uid === uid ? usuario : null;

      const isOwnProfile = !!uid && !!viewedUid && uid === viewedUid;

      return { ready, uid, usuario: safeUsuario, viewedUid, isOwnProfile };
    }),
    distinctUntilChanged((a, b) =>
      a.ready === b.ready &&
      a.uid === b.uid &&
      a.viewedUid === b.viewedUid &&
      a.isOwnProfile === b.isOwnProfile &&
      (a.usuario?.uid ?? null) === (b.usuario?.uid ?? null)
    ),
    tap(vm => this.debug('vm$', {
      ready: vm.ready,
      uid: vm.uid,
      viewedUid: vm.viewedUid,
      isOwnProfile: vm.isOwnProfile,
      hasUser: !!vm.usuario,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // Conveniências mantidas (se você preferir continuar usando no TS)
  readonly currentUid$ = this.vm$.pipe(map(vm => vm.uid), distinctUntilChanged());
  readonly usuario$ = this.vm$.pipe(map(vm => vm.usuario), distinctUntilChanged());
  readonly isOwnProfile$ = this.vm$.pipe(map(vm => vm.isOwnProfile), distinctUntilChanged());

  ngOnInit(): void {
    this.debug('init');
  }

  toggleSidebar(): void {
    this.isSidebarVisible =
      this.isSidebarVisible === SidebarState.OPEN ? SidebarState.CLOSED : SidebarState.OPEN;
  }

  closeSidebar(): void {
    this.isSidebarVisible = SidebarState.CLOSED;
  }

  /**
   * Cria sala caso assinante; caso não seja, abre diálogo de upsell.
   * Mantido o nome do método.
   */
  createRoomIfSubscriber(): void {
    combineLatest([this.currentUid$, this.usuario$]).pipe(
      take(1),

      switchMap(([uid, user]) => {
        if (!uid) {
          this.errorNotifier.showError('Faça login para criar uma sala.');
          return EMPTY;
        }

        // Se o perfil ainda não chegou do store, evita decisão errada.
        if (!user) {
          this.errorNotifier.showError('Carregando seu perfil... tente novamente em instantes.');
          return EMPTY;
        }

        const isSubscriber =
          !!(user as any)?.isSubscriber || ['premium', 'vip'].includes(String((user as any)?.role ?? ''));

        if (!isSubscriber) {
          this.openDialog();
          return EMPTY;
        }

        const roomDetails = {
          roomName: 'Minha nova sala',
          description: 'Bem-vindo(a)!',
          isPrivate: true,
        };

        return this.roomManagement.createRoom(roomDetails, uid).pipe(
          tap(() => this.errorNotifier.showSuccess('Sala criada com sucesso!')),
          catchError((err) => {
            this.errorNotifier.showError(err);
            return EMPTY;
          })
        );
      }),

      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  openDialog(): void {
    this.dialog.open(ConfirmacaoDialogComponent, {
      data: {
        title: 'Assinatura necessária',
        message: 'Assine para criar salas exclusivas e desbloquear recursos premium.',
      },
    });
  }
} // Linha 208, fim do UserProfileSidebarComponent
// - Derivar um estado único de acesso a partir de:
//   (1) AuthSessionService (verdade do Firebase Auth: uid, emailVerified, ready$)
//   (2) CurrentUserStoreService (verdade do app: role, profileCompleted, etc.)
//   (3) AuthAppBlockService (verdade do bloqueio do app: TerminateReason | null)
//   (4) Router (estado de navegação e rotas “sensíveis” para gating)
// - Evitar múltiplos subscriptions e estados “quebrados” no template usando um único vm$ combinado.
// - Manter o debug simples e controlado, focado em mudanças de estado relevantes (ex.: sessão, usuário, rota).
