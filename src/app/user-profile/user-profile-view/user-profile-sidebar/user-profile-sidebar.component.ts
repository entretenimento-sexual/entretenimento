// src/app/user-profile/user-profile-view/user-profile-sidebar/user-profile-sidebar.component.ts
// ============================================================================
// USER PROFILE SIDEBAR COMPONENT
//
// Fase atual da migração:
// - continua com o mesmo nome para não quebrar o projeto
// - deixa de ser um sidebar estrutural da aplicação
// - passa a atuar como card contextual do perfil
// - o drawer/sidebar global fica sob responsabilidade exclusiva do LayoutShellComponent
//
// Mantido de propósito:
// - createRoomIfSubscriber()
// - openDialog()
// - toggleSidebar()
// - closeSidebar()
//
// Suprimido de propósito nesta revisão:
// - enum SidebarState
// - assinatura em SidebarService.isSidebarVisible$
// - comportamento de drawer fixo/local
//
// Motivo da supressão:
// - havia competição visual com o sidebar universal do shell global
// - este componente deve ser contextual ao perfil, não estrutural da aplicação
// ============================================================================
import { Component, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Observable, EMPTY, combineLatest } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { RoomManagementService } from 'src/app/core/services/batepapo/room-services/room-management.service';
import {
  AuthenticatedNavItem,
  AuthenticatedNavigationService,
  AuthenticatedNavigationVm,
} from '../../../core/services/navigation/authenticated-navigation.service';

import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-user-profile-sidebar',
  standalone: true,
  templateUrl: './user-profile-sidebar.component.html',
  styleUrls: ['./user-profile-sidebar.component.css'],
  imports: [CommonModule, RouterModule, MatButtonModule],
})
export class UserProfileSidebarComponent {
  private readonly destroyRef = inject(DestroyRef);

  private readonly navigation = inject(AuthenticatedNavigationService);

  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly roomManagement = inject(RoomManagementService);
  private readonly dialog = inject(MatDialog);

  private readonly DEBUG =
    !environment.production &&
    localStorage.getItem('debug.user-profile-sidebar') === '1';

  private debug(msg: string, data?: unknown): void {
    if (!this.DEBUG) return;
    // eslint-disable-next-line no-console
    console.debug(`[UserProfileSidebar] ${msg}`, data ?? '');
  }

  /**
   * VM centralizado da navegação autenticada.
   */
  readonly vm$: Observable<AuthenticatedNavigationVm> = this.navigation.vm$.pipe(
    tap((vm) =>
      this.debug('vm$', {
        ready: vm.ready,
        uid: vm.uid,
        viewedUid: vm.viewedUid,
        isProfileRoute: vm.isProfileRoute,
        isOwnProfileRoute: vm.isOwnProfileRoute,
        hasUser: !!vm.usuario,
        currentUrl: vm.currentUrl,
      })
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Itens contextuais do perfil.
   * Mantidos via serviço central para não hardcodar ações em múltiplos lugares.
   */
  readonly navItems$: Observable<AuthenticatedNavItem[]> =
    this.navigation.items$.pipe(
      tap((items) => this.debug('navItems$', items.map((item) => item.id))),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Conveniências mantidas para o fluxo existente de criação de sala.
   */
  readonly currentUid$ = this.vm$.pipe(
    map((vm) => vm.uid),
    distinctUntilChanged()
  );

  readonly usuario$ = this.vm$.pipe(
    map((vm) => vm.usuario as IUserDados | null),
    distinctUntilChanged()
  );

  /**
   * Compatibilidade mantida.
   *
   * Este componente não controla mais o sidebar global.
   * Método preservado apenas para evitar quebra de template/chamadas legadas.
   */
  toggleSidebar(): void {
    this.debug('toggleSidebar() suprimido: componente agora é card contextual');
  }

  /**
   * Compatibilidade mantida.
   *
   * Antes fechava drawer local/global.
   * Agora é no-op deliberado, porque clique em ação contextual não deve
   * interferir no sidebar estrutural do shell.
   */
  closeSidebar(): void {
    this.debug('closeSidebar() noop: card contextual não controla shell global');
  }

  /**
   * Cria sala caso assinante; caso não seja, abre diálogo de upsell.
   * Mantido o nome do método.
   */
  createRoomIfSubscriber(): void {
    combineLatest([this.currentUid$, this.usuario$])
      .pipe(
        take(1),

        switchMap(([uid, user]) => {
          if (!uid) {
            this.errorNotifier.showError('Faça login para criar uma sala.');
            return EMPTY;
          }

          if (!user) {
            this.errorNotifier.showError(
              'Carregando seu perfil... tente novamente em instantes.'
            );
            return EMPTY;
          }

          const isSubscriber =
            !!(user as any)?.isSubscriber ||
            ['premium', 'vip'].includes(String((user as any)?.role ?? ''));

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
            tap(() =>
              this.errorNotifier.showSuccess('Sala criada com sucesso!')
            ),
            catchError((err) => {
              this.errorNotifier.showError(err);
              return EMPTY;
            })
          );
        }),

        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  openDialog(): void {
    this.dialog.open(ConfirmacaoDialogComponent, {
      data: {
        title: 'Assinatura necessária',
        message:
          'Assine para criar salas exclusivas e desbloquear recursos premium.',
      },
    });
  }
}
