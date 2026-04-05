// src/app/user-profile/user-profile-view/user-profile-view.component.ts
// Objetivo: exibir perfil do usuário SEM depender de fontes paralelas.
// - UID “quem sou eu”: vem do AUTH (store -> selectCurrentUserUid)
// - Perfil “dados do usuário”: vem do usersMap (store -> selectUserByIdOrNull / selectCurrentUser)
// - Listener do usuário atual (users/{uid}) é controlado por AuthSessionSyncEffects.
// - Este componente NÃO inicia observeUserChanges() para não cancelar listener do usuário atual via switchMap.
//
// Ajuste desta revisão:
// - suprime a renderização do sidebar local do perfil
// - o sidebar autenticado passa a ser responsabilidade exclusiva do LayoutShellComponent
// - evita duplicidade visual em /perfil/:uid
// apreciar deixar mais ostensivo para o usuário o status da verificação de email e o a oferta deste
import { Component, OnInit, DestroyRef, inject } from '@angular/core';
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
import {
  selectCurrentUserUid,
  selectUserByIdOrNull,
  selectCurrentUserStatus,
  type CurrentUserStatus,
} from 'src/app/store/selectors/selectors.user/user.selectors';

import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import { SocialLinksAccordionComponent } from './user-social-links-accordion/user-social-links-accordion.component';
//import { UserProfilePreferencesComponent } from './user-profile-preferences/user-profile-preferences.component';
import { UserPhotoManagerComponent } from '../user-photo-manager/user-photo-manager.component';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SocialLinksAccordionComponent,
    //UserProfilePreferencesComponent,
    UserPhotoManagerComponent,
    DateFormatPipe,
    CapitalizePipe,
  ],
})
export class UserProfileViewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly destroyRef = inject(DestroyRef);

  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly errorNotification = inject(ErrorNotificationService);

  /** UID efetivo do perfil exibido (routeUid ?? authUid) */
  public uid: string | null = null;

  /** UID do usuário logado (AUTH) — usado p/ isOwner */
  private authUid: string | null = null;

  /** Status útil p/ debug e UX (boot/signed_out/loading_profile/ready) */
  public status$: Observable<CurrentUserStatus> = this.store.select(selectCurrentUserStatus);

  /** Stream do usuário exibido */
  public usuario$: Observable<IUserDados | null> = of(null);

  private dbg(...args: any[]) {
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.log('[UserProfileView]', ...args);
    }
  }

  ngOnInit(): void {
    const authUid$ = this.store.select(selectCurrentUserUid).pipe(
      tap((uid) => (this.authUid = uid ?? null)),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const routeUid$ = this.route.paramMap.pipe(
      map((p) => (p.get('uid') ?? p.get('id'))?.trim() || null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const effectiveUid$ = combineLatest([routeUid$, authUid$]).pipe(
      map(([rid, auid]) => rid ?? auid ?? null),
      distinctUntilChanged(),
      tap((uid) => (this.uid = uid)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.usuario$ = effectiveUid$.pipe(
      switchMap((uid) => (uid ? this.store.select(selectUserByIdOrNull(uid)) : of(null))),
      catchError((err) => {
        this.globalError.handleError(
          err instanceof Error ? err : new Error('Erro ao carregar perfil')
        );
        this.errorNotification.showError(
          'Não foi possível carregar seu perfil no momento.',
          String((err as any)?.message ?? '')
        );
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    effectiveUid$
      .pipe(
        auditTime(500),
        tap((uid) => this.dbg('effectiveUid$', uid)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.status$
      .pipe(
        auditTime(500),
        tap((s) => this.dbg('currentUserStatus$', s)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    this.usuario$
      .pipe(
        filter(Boolean),
        scan((acc) => acc + 1, 0),
        auditTime(1000),
        tap((count) => this.dbg('usuario$ emits/sec', count)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  objectKeys(obj: any): string[] {
    if (!obj) return [];
    return Object.keys(obj).filter((key) => obj[key] && obj[key].value);
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
      case 'bissexual':
        return 'bissexual';
      case 'homossexual':
        return 'homossexual';
      case 'heterossexual':
        return 'heterossexual';
      case 'pansexual':
        return 'pansexual';
      default:
        return '';
    }
  }

  /** Dono do perfil = uid exibido igual ao uid do AUTH */
  isOnOwnProfile(): boolean {
    return !!this.authUid && this.authUid === this.uid;
  }
}
