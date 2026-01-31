// src/app/user-profile/user-profile-view/user-profile-view.component.ts
// Componente para exibir o perfil do usuário, incluindo informações pessoais, links sociais e preferências.
// Utiliza o estado global da aplicação para obter dados do usuário e gerenciar a visibilidade da sidebar.
// lógica para diferenciar entre o perfil do usuário logado e outros perfis.
// Não esqueça os comentários explicativos.
// Posicionar melhor esse componente na hierarquia da aplicação se necessário.
// Explicar pq não tem construtor.
import { Component, OnInit, OnDestroy, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable, of, combineLatest } from 'rxjs';
import { auditTime, catchError, distinctUntilChanged, filter, map, scan, shareReplay, switchMap, tap } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { AppState } from 'src/app/store/states/app.state';
import { selectUserById } from 'src/app/store/selectors/selectors.user/user.selectors';
import { observeUserChanges } from 'src/app/store/actions/actions.user/user.actions';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SidebarService } from 'src/app/core/services/sidebar.service';

// 🔄 Nova base de sessão/usuário (substitui anterior):
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { SocialLinksAccordionComponent } from './user-social-links-accordion/user-social-links-accordion.component';
import { UserProfilePreferencesComponent } from './user-profile-preferences/user-profile-preferences.component';
import { UserPhotoManagerComponent } from '../user-photo-manager/user-photo-manager.component';
import { UserProfileSidebarComponent } from './user-profile-sidebar/user-profile-sidebar.component';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly destroyRef = inject(DestroyRef);

  public isSidebarVisible = SidebarState.CLOSED;
  public uid: string | null = null;
  public currentUser: IUserDados | null = null;
  // Stream do usuário exibido (por uid efetivo)
  public usuario$: Observable<IUserDados | null> = of(null);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly errorNotification = inject(ErrorNotificationService);

  private dbg(...args: any[]) {
    if (!environment.production) console.log('[UserProfileView]', ...args);
  }

  ngOnInit(): void {
    const loggedUser$ = this.currentUserStore.user$.pipe(
      tap(u => (this.currentUser = u ?? null)),
      // ✅ evita recomputar combineLatest se o uid não mudou
      map(u => u?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const routeUid$ = this.route.paramMap.pipe(
      map(p => p.get('uid') ?? p.get('id')),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const effectiveUid$ = combineLatest([routeUid$, loggedUser$]).pipe(
      map(([rid, loggedUid]) => rid ?? loggedUid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // ✅ side-effect separado (dispatch idempotente), não acoplado ao template
    effectiveUid$.pipe(
      tap(uid => (this.uid = uid)),
      filter((uid): uid is string => !!uid),
      tap(uid => this.store.dispatch(observeUserChanges({ uid }))),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();

    // ✅ stream "puro" para o template
    this.usuario$ = effectiveUid$.pipe(
      switchMap(uid => (uid ? this.store.select(selectUserById(uid)) : of(null))),
      tap(user => {
        if (user) {
          this.isSidebarVisible = user.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
        }
      }),
      catchError(err => {
        this.globalError.handleError(err instanceof Error ? err : new Error('Erro ao carregar perfil'));
        // ✅ usa o método que existe
        this.errorNotification.showError('Não foi possível carregar seu perfil no momento.', String(err?.message ?? ''));
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Sidebar global (ok)
    this.sidebarService.isSidebarVisible$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(isVisible => {
      this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
    });

    // -------------------------
    // LOGS DE DIAGNÓSTICO (DEV) – alta fidelidade e pouco ruído
    // Remova depois que fechar o bug.
    // -------------------------
    effectiveUid$.pipe(
      auditTime(500),
      tap(uid => this.dbg('effectiveUid$', uid)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();

    this.usuario$.pipe(
      filter(Boolean),
      scan((acc) => acc + 1, 0),
      auditTime(1000),
      tap(count => this.dbg('usuario$ emits/sec', count)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
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
} // Linha 151
/*
PS C:\entretenimento\src\app\user-profile> tree /f
Listagem de caminhos de pasta para o volume Windows
O número de série do volume é 1C9B-11ED
C:.
│   user-profile-routing.module.ts
│   user-profile.module.ts
│
├───user-photo-manager
│       user-photo-manager.component.css
│       user-photo-manager.component.html
│       user-photo-manager.component.spec.ts
│       user-photo-manager.component.ts
│
├───user-profile-edit
│   ├───edit-preferences
│   │       edit-profile-preferences.component.css
│   │       edit-profile-preferences.component.html
│   │       edit-profile-preferences.component.spec.ts
│   │       edit-profile-preferences.component.ts
│   │
│   ├───edit-profile-social-links
│   │       edit-profile-social-links.component.css
│   │       edit-profile-social-links.component.html
│   │       edit-profile-social-links.component.spec.ts
│   │       edit-profile-social-links.component.ts
│   │
│   ├───edit-region
│   │       edit-profile-region.component.css
│   │       edit-profile-region.component.html
│   │       edit-profile-region.component.spec.ts
│   │       edit-profile-region.component.ts
│   │
│   ├───edit-user-profile
│   │       edit-user-profile.component.css
│   │       edit-user-profile.component.html
│   │       edit-user-profile.component.spec.ts
│   │       edit-user-profile.component.ts
│   │
│   └───user-privacy-settings
│           user-privacy-settings.component.css
│           user-privacy-settings.component.html
│           user-privacy-settings.component.spec.ts
│           user-privacy-settings.component.ts
│
└───user-profile-view
    │   user-profile-view.component.css
    │   user-profile-view.component.html
    │   user-profile-view.component.spec.ts
    │   user-profile-view.component.ts
    │
    ├───user-activity-feed
    │       user-activity-feed.component.css
    │       user-activity-feed.component.html
    │       user-activity-feed.component.spec.ts
    │       user-activity-feed.component.ts
    │
    ├───user-profile-preferences
    │       user-profile-preferences.component.css
    │       user-profile-preferences.component.html
    │       user-profile-preferences.component.spec.ts
    │       user-profile-preferences.component.ts
    │
    ├───user-profile-sidebar
    │       user-profile-sidebar.component.css
    │       user-profile-sidebar.component.html
    │       user-profile-sidebar.component.spec.ts
    │       user-profile-sidebar.component.ts
    │
    └───user-social-links-accordion
            user-social-links-accordion.component.css
            user-social-links-accordion.component.html
            user-social-links-accordion.component.spec.ts
            user-social-links-accordion.component.ts

PS C:\entretenimento\src\app\user-profile>
*/
