// src/app/user-profile/user-profile-view/user-profile-sidebar/user-profile-sidebar.component.ts
// ============================================================================
// USER PROFILE SIDEBAR COMPONENT
//
// Este componente mantém o nome legado para compatibilidade, mas atua somente
// como card contextual do perfil. A navegação estrutural pertence ao LayoutShell.
//
// SUPRESSÃO EXPLÍCITA:
// - criação de Salas foi removida desta superfície;
// - Salas estão em modo de compatibilidade e não aceitam novas criações;
// - Comunidades são a superfície coletiva canônica.
// ============================================================================
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import { Observable } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  tap,
} from 'rxjs/operators';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  AuthenticatedNavItem,
  AuthenticatedNavigationService,
  AuthenticatedNavigationVm,
} from '../../../core/services/navigation/authenticated-navigation.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-user-profile-sidebar',
  standalone: true,
  templateUrl: './user-profile-sidebar.component.html',
  styleUrls: ['./user-profile-sidebar.component.css'],
  imports: [CommonModule, RouterModule],
})
export class UserProfileSidebarComponent {
  private readonly navigation = inject(AuthenticatedNavigationService);

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
        subscriptionRole: vm.subscriptionRole,
        isSubscriber: vm.isSubscriber,
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

  readonly currentUid$ = this.vm$.pipe(
    map((vm) => vm.uid),
    distinctUntilChanged()
  );

  readonly usuario$ = this.vm$.pipe(
    map((vm) => vm.usuario as IUserDados | null),
    distinctUntilChanged()
  );

  readonly isSubscriber$ = this.vm$.pipe(
    map((vm) => vm.isSubscriber),
    distinctUntilChanged()
  );

  /**
   * Compatibilidade mantida: este card não controla o sidebar global.
   */
  toggleSidebar(): void {
    this.debug('toggleSidebar() suprimido: componente agora é card contextual');
  }

  /**
   * Compatibilidade mantida: clique em ação contextual não interfere no shell.
   */
  closeSidebar(): void {
    this.debug('closeSidebar() noop: card contextual não controla shell global');
  }
}
