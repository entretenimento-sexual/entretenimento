// src/app/user-profile/user-profile-view/user-profile-view.component.ts
import { Component, OnInit, OnDestroy, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable, of, combineLatest } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, switchMap, tap } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { AppState } from 'src/app/store/states/app.state';
import { selectUserById } from 'src/app/store/selectors/selectors.user/user.selectors';
import { observeUserChanges } from 'src/app/store/actions/actions.user/user.actions';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SidebarService } from 'src/app/core/services/sidebar.service';

// 🔄 Nova base de sessão/usuário (substitui anterior):
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';

import { SocialLinksAccordionComponent } from './user-social-links-accordion/user-social-links-accordion.component';
import { UserProfilePreferencesComponent } from './user-profile-preferences/user-profile-preferences.component';
import { UserPhotoManagerComponent } from '../user-photo-manager/user-photo-manager.component';
import { UserProfileSidebarComponent } from './user-profile-sidebar/user-profile-sidebar.component';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';

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
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly session = inject(AuthSessionService);
  private readonly destroyRef = inject(DestroyRef);

  public isSidebarVisible = SidebarState.CLOSED;
  public uid: string | null = null;
  public currentUser: IUserDados | null = null;

  // Stream do usuário exibido (por uid efetivo)
  public usuario$: Observable<IUserDados | null> = of(null);

  ngOnInit(): void {
    // 1) Usuário logado (store da app)
    const loggedUser$ = this.currentUserStore.user$.pipe(
      tap(u => (this.currentUser = u ?? null))
    );

    // 2) UID vindo da rota (ou do logado, como fallback)
    const routeUid$ = this.route.paramMap.pipe(
      map(p => p.get('id')),
      distinctUntilChanged()
    );

    // 3) UID efetivo (rota > logado)
    const effectiveUid$ = combineLatest([routeUid$, loggedUser$]).pipe(
      map(([rid, appUser]) => rid ?? appUser?.uid ?? null),
      distinctUntilChanged()
    );

    // 4) Seleciona usuário pelo uid efetivo e observa mudanças
    this.usuario$ = effectiveUid$.pipe(
      tap(uid => {
        this.uid = uid;
        if (uid) this.store.dispatch(observeUserChanges({ uid }));
      }),
      switchMap(uid => (uid ? this.store.select(selectUserById(uid)) : of(null))),
      tap(user => {
        if (user) {
          // espelha estado da sidebar do usuário (quando existir)
          this.isSidebarVisible = user.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
        }
      }),
      catchError(err => {
        console.error('[UserProfileView] Erro ao carregar usuário:', err);
        return of(null);
      })
    );

    // 5) Estado global da sidebar (UI)
    this.sidebarService.isSidebarVisible$.subscribe(isVisible => {
      this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
    });
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

  isOnOwnProfile(): boolean {
    return !!this.currentUser?.uid && this.currentUser.uid === this.uid;
  }

  ngOnDestroy(): void {
    // subscriptions automáticas já foram simplificadas; nada extra aqui.
  }
}
