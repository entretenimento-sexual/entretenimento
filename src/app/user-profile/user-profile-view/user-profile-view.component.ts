// src/app/user-profile/user-profile-view/user-profile-view.component.ts
// -----------------------------------------------------------------------------
// PERFIL PRÓPRIO
// -----------------------------------------------------------------------------
//
// Este componente deve exibir SOMENTE o perfil do usuário autenticado.
//
// Regra definitiva:
// - /perfil               -> meu perfil
// - /perfil/:meuUid       -> meu perfil
// - /perfil/:uidDeOutro   -> redireciona para /outro-perfil/:uidDeOutro
//
// Motivo:
// - Perfil próprio pode usar selectCurrentUser, pois vem do estado autenticado.
// - Perfil alheio deve usar projeção pública.
// - Isso evita tela travada em "Carregando..." quando o outro usuário não está
//   previamente hidratado no usersMap do NgRx.
//
// Supressão explícita:
// - Este componente NÃO usa selectUserByIdOrNull.
// - Este componente NÃO busca public_profiles.
// - Este componente NÃO renderiza edição/social/fotos se detectar perfil alheio.
// - Perfil alheio pertence ao OtherUserProfileViewComponent.
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Observable } from 'rxjs';
import { ProfileMyCommunitiesComponent } from 'src/app/community/profile-my-communities/profile-my-communities.component';
import { ProfileOfficialCommunitiesComponent } from 'src/app/community/profile-official-communities/profile-official-communities.component';
import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';
import { CapitalizePipe } from 'src/app/shared/pipes/capitalize.pipe';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { SocialLinksAccordionComponent } from './user-social-links-accordion/user-social-links-accordion.component';
import { UserPhotoManagerComponent } from '../user-photo-manager/user-photo-manager.component';
import {
  OwnProfileContextFacade,
  OwnProfileContentStateVm,
} from './application/own-profile-context.facade';

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css'],
  standalone: true,
  providers: [OwnProfileContextFacade],
  imports: [
    CommonModule,
    RouterModule,
    ContentStateComponent,
    UserPhotoManagerComponent,
    SocialLinksAccordionComponent,
    ProfileMyCommunitiesComponent,
    ProfileOfficialCommunitiesComponent,
    DateFormatPipe,
    CapitalizePipe,
  ],
})
export class UserProfileViewComponent implements OnInit {
  private readonly contextFacade = inject(OwnProfileContextFacade);

  public uid: string | null = null;
  private authUid: string | null = null;

  public readonly status$ = this.contextFacade.status$;
  public readonly usuario$ = this.contextFacade.user$;
  public readonly profileContentState$: Observable<OwnProfileContentStateVm | null> =
    this.contextFacade.contentState$;
  public redirectingToOtherProfile = false;

  ngOnInit(): void {
    const authUid$ = this.store.select(selectCurrentUserUid).pipe(
      map((uid) => (uid ?? '').trim() || null),
      tap((uid) => {
        this.authUid = uid;
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    const routeUid$ = this.route.paramMap.pipe(
      map((params) => {
        const uid = params.get('uid') ?? params.get('id');
        return uid?.trim() || null;
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  ngOnInit(): void {
    this.contextFacade.init();

    this.contextFacade.context$.subscribe((context) => {
      this.uid = context.uid;
      this.authUid = context.authUid;
      this.redirectingToOtherProfile = context.redirectingToOtherProfile;
    });
  }

  retryProfile(): void {
    this.contextFacade.retryProfile(this.authUid);
  }

  onAvatarImageError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) return;

    const fallback = 'assets/imagem-padrao.webp';

    if (!image.src.endsWith(fallback)) {
      image.src = fallback;
    }
  }

  isCouple(gender: string | undefined): boolean {
    return !!gender &&
      ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(gender);
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

  isOnOwnProfile(): boolean {
    return !!this.authUid &&
      !!this.uid &&
      this.authUid === this.uid &&
      !this.redirectingToOtherProfile;
  }


}
