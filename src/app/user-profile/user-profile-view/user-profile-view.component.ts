// src/app/user-profile/user-profile-view/user-profile-view.component.ts
// Objetivo: exibir perfil do usuário SEM depender de fontes paralelas.
// - UID “quem sou eu”: vem do AUTH (store -> selectCurrentUserUid)
// - Perfil “dados do usuário”: vem do usersMap (store -> selectUserByIdOrNull / selectCurrentUser)
// - Listener do usuário atual (users/{uid}) é controlado por AuthSessionSyncEffects.
// - Este componente NÃO inicia observeUserChanges() para não cancelar listener do usuário atual via switchMap.

import { Component, OnInit, OnDestroy, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable, of, combineLatest } from 'rxjs';
import {
  auditTime,
  catchError,
  distinctUntilChanged,
  filter,
  map,
  scan,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';

// ✅ agora usamos a “fonte única” do auth/store
import {
  selectCurrentUserUid,
  selectUserByIdOrNull,
  selectCurrentUserStatus,
  type CurrentUserStatus,
} from 'src/app/store/selectors/selectors.user/user.selectors';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SidebarService } from 'src/app/core/services/sidebar.service';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { SocialLinksAccordionComponent } from './user-social-links-accordion/user-social-links-accordion.component';
import { UserProfilePreferencesComponent } from './user-profile-preferences/user-profile-preferences.component';
import { UserPhotoManagerComponent } from '../user-photo-manager/user-photo-manager.component';
import { UserProfileSidebarComponent } from './user-profile-sidebar/user-profile-sidebar.component';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';
import { environment } from 'src/environments/environment';

enum SidebarState { CLOSED, OPEN }

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SocialLinksAccordionComponent,
    UserProfilePreferencesComponent,
    UserPhotoManagerComponent,
    UserProfileSidebarComponent,
    DateFormatPipe,
    CapitalizePipe,
  ],
})
export class UserProfileViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly sidebarService = inject(SidebarService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly errorNotification = inject(ErrorNotificationService);

  public isSidebarVisible = SidebarState.CLOSED;

  /** UID efetivo do perfil exibido (routeUid ?? authUid) */
  public uid: string | null = null;

  /** UID do usuário logado (AUTH) — usado p/ isOwner */
  private authUid: string | null = null;

  /** Status útil p/ debug e UX (boot/signed_out/loading_profile/ready) */
  public status$: Observable<CurrentUserStatus> = this.store.select(selectCurrentUserStatus);

  /** Stream do usuário exibido */
  public usuario$: Observable<IUserDados | null> = of(null);

  private dbg(...args: any[]) {
    if (!environment.production) console.log('[UserProfileView]', ...args);
  }

  ngOnInit(): void {
    // ---------------------------------------------------------------------
    // AUTH UID (fonte única)
    // ---------------------------------------------------------------------
    const authUid$ = this.store.select(selectCurrentUserUid).pipe(
      tap(uid => (this.authUid = uid ?? null)),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // ---------------------------------------------------------------------
    // UID vindo da rota (se existir /perfil/:uid, etc.)
    // ---------------------------------------------------------------------
    const routeUid$ = this.route.paramMap.pipe(
      map(p => (p.get('uid') ?? p.get('id'))?.trim() || null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // ---------------------------------------------------------------------
    // UID efetivo: routeUid (se existir) senão authUid
    // ---------------------------------------------------------------------
    const effectiveUid$ = combineLatest([routeUid$, authUid$]).pipe(
      map(([rid, auid]) => rid ?? auid ?? null),
      distinctUntilChanged(),
      tap(uid => (this.uid = uid)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // ---------------------------------------------------------------------
    // Stream puro do usuário para o template:
    // - NUNCA usa fallback (para não mascarar bugs)
    // - Se uid existe e usuário não existe no map, template recebe null (loading)
    // ---------------------------------------------------------------------
    this.usuario$ = effectiveUid$.pipe(
      switchMap(uid => (uid ? this.store.select(selectUserByIdOrNull(uid)) : of(null))),
      tap(user => {
        if (user) {
          this.isSidebarVisible = user.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
        }
      }),
      catchError(err => {
        this.globalError.handleError(err instanceof Error ? err : new Error('Erro ao carregar perfil'));
        this.errorNotification.showError(
          'Não foi possível carregar seu perfil no momento.',
          String((err as any)?.message ?? '')
        );
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Sidebar global (ok)
    this.sidebarService.isSidebarVisible$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(isVisible => {
        this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
      });

    // ---------------------------------------------------------------------
    // Debug de alta fidelidade (DEV)
    // ---------------------------------------------------------------------
    effectiveUid$
      .pipe(
        auditTime(500),
        tap(uid => this.dbg('effectiveUid$', uid)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.status$
      .pipe(
        auditTime(500),
        tap(s => this.dbg('currentUserStatus$', s)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.usuario$
      .pipe(
        filter(Boolean),
        scan((acc) => acc + 1, 0),
        auditTime(1000),
        tap(count => this.dbg('usuario$ emits/sec', count)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ===== Helpers de template =====

  objectKeys(obj: any): string[] {
    if (!obj) return [];
    return Object.keys(obj).filter(key => obj[key] && obj[key].value);
  }

  isCouple(gender: string | undefined): boolean {
    return !!gender && ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(gender);
  }

  getCoupleDescription(
    gender: string | undefined,
    partner1Orientation: string | undefined,
    partner2Orientation: string | undefined
  ): string {
    const o1 = this.getOrientationDescription(partner1Orientation);
    const o2 = this.getOrientationDescription(partner2Orientation);
    if (gender === 'casal-ele-ele') return `Ele ${o1} / Ele ${o2}`;
    if (gender === 'casal-ele-ela') return `Ele ${o1} / Ela ${o2}`;
    if (gender === 'casal-ela-ela') return `Ela ${o1} / Ela ${o2}`;
    return '';
  }

  getOrientationDescription(orientation: string | undefined): string {
    switch (orientation) {
      case 'bissexual': return 'bissexual';
      case 'homossexual': return 'homossexual';
      case 'heterossexual': return 'heterossexual';
      case 'pansexual': return 'pansexual';
      default: return '';
    }
  }

  /** Dono do perfil = uid exibido igual ao uid do AUTH */
  isOnOwnProfile(): boolean {
    return !!this.authUid && this.authUid === this.uid;
  }

  ngOnDestroy(): void {
    // takeUntilDestroyed já faz o cleanup
  }
}
