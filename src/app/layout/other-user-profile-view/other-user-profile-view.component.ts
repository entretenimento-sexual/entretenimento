// src/app/layout/other-user-profile-view/other-user-profile-view.component.ts
// -----------------------------------------------------------------------------
// PERFIL VISITADO
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - Exibir o perfil de outro usuário como vitrine de descoberta.
// - Priorizar mídia pública aprovada, afinidades e ações de interação.
// - Não ler dados privados de users/{uid}; o carregamento vem da projeção pública.
// - Não permitir edição de dados de outro usuário.
// - Manter segurança real fora do HTML: Firestore Rules, Cloud Functions,
//   projeções públicas moderadas e validação backend.
//
// Segurança:
// - A prévia de fotos usa MediaPublicQueryService, que lê apenas
//   public_profiles/{uid}/public_photos.
// - O serviço já filtra visibility == PUBLIC e moderationStatus == APPROVED.
// - O frontend apenas apresenta dados já considerados públicos/moderados.
//
// Monetização:
// - O plano do visitante melhora contexto e experiência.
// - O plano do dono do perfil deve aumentar alcance/controle, não reduzir exposição.
// - A UI pode mostrar teaser/atalho, mas dado sensível ou premium real deve vir
//   protegido por Rules/Functions.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Store } from '@ngrx/store';
import {
  BehaviorSubject,
  map,
  of,
  shareReplay,
  switchMap,
  take,
  throwError,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { SharedModule } from '../../shared/shared.module';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { SocialLinksAccordionComponent } from 'src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';

interface ProfileSignalItem {
  icon: string;
  label: string;
  value: string;
  tone: 'strong' | 'neutral' | 'muted';
}

interface ViewerAccessState {
  tier: string;
  isSubscriber: boolean;
  premiumLabel: string;
}

@Component({
  selector: 'app-other-user-profile-view',
  templateUrl: './other-user-profile-view.component.html',
  styleUrls: ['./other-user-profile-view.component.css'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    SharedModule,
    SocialLinksAccordionComponent,
  ],
})
export class OtherUserProfileViewComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly store = inject(Store);
  private readonly mediaPublicQuery = inject(MediaPublicQueryService);

  private readonly viewedProfileUid$ = new BehaviorSubject<string | null>(null);

  /**
   * Estado reativo do visitante logado.
   *
   * Uso:
   * - melhora a experiência visual conforme plano/role do visitante;
   * - não autoriza acesso sensível sozinho;
   * - segurança real continua no backend/rules.
   */
  readonly viewerAccess$ = this.store.select(selectCurrentUser).pipe(
    map((viewer) => this.buildViewerAccess(viewer)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Prévia real da galeria pública.
   *
   * Segurança:
   * - não acessa coleção privada;
   * - usa serviço de projeção pública;
   * - limita a 4 itens para manter performance e visual limpo.
   */
  readonly publicPhotoPreview$ = this.viewedProfileUid$.pipe(
    map((uid) => (uid ?? '').trim()),
    distinctUntilChanged(),
    switchMap((uid) => {
      if (!uid) {
        return of([] as IPublicPhotoItem[]);
      }

      return this.mediaPublicQuery.getProfilePublicPhotos$(uid).pipe(
        map((photos) => photos.slice(0, 4)),
        catchError((error) => {
          this.reportError(
            'Não foi possível carregar a prévia da galeria.',
            {
              op: 'publicPhotoPreview$',
              hasUid: !!uid,
            },
            error
          );

          return of([] as IPublicPhotoItem[]);
        })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  uid: string | null = null;
  userProfile: IUserDados | null = null;

  isLoading = true;

  readonly friendRequestBusy$ = new BehaviorSubject<boolean>(false);
  readonly directChatBusy$ = new BehaviorSubject<boolean>(false);

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly authSession: AuthSessionService,
    private readonly friendshipService: FriendshipService,
    private readonly directChatService: DirectChatService,
    private readonly cdr: ChangeDetectorRef,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotification: ErrorNotificationService
  ) {}

  ngOnInit(): void {
    this.uid = this.getUidFromRoute();

    if (!this.uid) {
      this.reportError('UID não encontrado na rota.', {
        op: 'ngOnInit',
      });

      this.isLoading = false;
      this.markView();
      return;
    }

    this.authSession.uid$
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((authUid) => {
        const safeAuthUid = (authUid ?? '').trim();
        const targetUid = (this.uid ?? '').trim();

        if (safeAuthUid && targetUid && safeAuthUid === targetUid) {
          this.debug('own profile opened here; redirecting to /perfil', {
            hasUid: true,
          });

          this.isLoading = false;
          this.markView();

          this.router.navigate(['/perfil'], { replaceUrl: true }).catch((error) => {
            this.reportError(
              'Não foi possível redirecionar para seu perfil.',
              { op: 'redirectOwnProfile' },
              error
            );
          });

          return;
        }

        this.viewedProfileUid$.next(targetUid);
        this.loadUserProfile(targetUid);
      });
  }

  ngOnDestroy(): void {
    this.viewedProfileUid$.complete();
    this.friendRequestBusy$.complete();
    this.directChatBusy$.complete();
  }

  get hasProfile(): boolean {
    return !!this.userProfile;
  }

  get hasLocation(): boolean {
    return !!this.userProfile?.municipio?.trim() && !!this.userProfile?.estado?.trim();
  }

  get hasDescription(): boolean {
    return !!this.userProfile?.descricao?.trim();
  }

  get displayName(): string {
    return this.userProfile?.nickname?.trim() || 'Perfil de usuário';
  }

  get discoveryLink(): any[] {
    return ['/dashboard/explorar'];
  }

  get photosLink(): any[] | null {
    return this.uid ? ['/media', 'perfil', this.uid, 'fotos-publicas'] : null;
  }

  get subscriptionLink(): any[] {
    return ['/subscription-plan'];
  }

  get hasPreferenceChips(): boolean {
    return this.preferenceChips.length > 0;
  }

  get preferenceChips(): string[] {
    return (this.userProfile?.preferences ?? [])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  /**
   * Indica que o dono do perfil tem algum nível de acesso pago/elevado.
   *
   * Não libera dado sensível.
   * Serve apenas para sinal visual discreto de destaque.
   */
  get ownerIsSubscriber(): boolean {
    return this.hasElevatedAccess(this.userProfile);
  }

  get activitySignal(): ProfileSignalItem {
    const profile = this.userProfile;

    if (profile?.isOnline) {
      return {
        icon: 'fas fa-circle',
        label: 'Atividade',
        value: 'Online agora',
        tone: 'strong',
      };
    }

    if (this.wasRecentlyActive(profile?.lastSeen)) {
      return {
        icon: 'fas fa-clock',
        label: 'Atividade',
        value: 'Ativo recentemente',
        tone: 'neutral',
      };
    }

    return {
      icon: 'fas fa-moon',
      label: 'Atividade',
      value: 'Atividade não informada',
      tone: 'muted',
    };
  }

  get locationSignal(): ProfileSignalItem {
    const distance = this.userProfile?.distanciaKm;

    if (typeof distance === 'number' && Number.isFinite(distance)) {
      return {
        icon: 'fas fa-location-dot',
        label: 'Proximidade',
        value: `${Math.max(0, Math.round(distance))} km de distância`,
        tone: 'strong',
      };
    }

    if (this.hasLocation) {
      return {
        icon: 'fas fa-map-marker-alt',
        label: 'Proximidade',
        value: 'Região informada',
        tone: 'neutral',
      };
    }

    return {
      icon: 'fas fa-map',
      label: 'Proximidade',
      value: 'Região não informada',
      tone: 'muted',
    };
  }

  get profileSignals(): ProfileSignalItem[] {
    return [
      this.activitySignal,
      this.locationSignal,
    ];
  }

  trackPhotoById(_index: number, photo: IPublicPhotoItem): string {
    return photo.id;
  }

  loadUserProfile(uid: string): void {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      this.reportError('UID inválido para carregar perfil.', {
        op: 'loadUserProfile',
      });

      this.isLoading = false;
      this.markView();
      return;
    }

    this.isLoading = true;
    this.markView();

    this.debug('loadUserProfile start', {
      hasUid: true,
    });

    this.firestoreUserQuery.getPublicUserById$(safeUid)
      .pipe(
        catchError((error: unknown) => {
          this.reportError(
            'Falha ao carregar perfil do usuário.',
            {
              op: 'loadUserProfile',
              hasUid: true,
            },
            error
          );

          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
          this.markView();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((profile: IUserDados | null) => {
        if (!profile) {
          this.userProfile = null;

          this.reportError('Usuário não encontrado ou indisponível.', {
            op: 'loadUserProfile.empty',
            hasUid: true,
          });

          this.markView();
          return;
        }

        this.userProfile = {
          ...profile,
          preferences: Array.isArray(profile.preferences) ? profile.preferences : [],
        };

        this.debug('loadUserProfile success', {
          hasProfile: true,
          hasNickname: !!this.userProfile.nickname,
          hasPhoto: !!this.userProfile.photoURL,
        });

        this.markView();
      });
  }

  sendFriendRequest(): void {
    const targetUid = (this.uid ?? '').trim();

    if (!targetUid || this.friendRequestBusy$.value) {
      return;
    }

    this.friendRequestBusy$.next(true);

    this.authSession.uid$
      .pipe(
        take(1),
        switchMap((requesterUid) => {
          const safeRequesterUid = (requesterUid ?? '').trim();

          if (!safeRequesterUid) {
            return throwError(() => new Error('Sessão não identificada para solicitar amizade.'));
          }

          if (safeRequesterUid === targetUid) {
            return throwError(() => new Error('Você não pode enviar solicitação para si mesmo.'));
          }

          return this.friendshipService.sendRequest(
            safeRequesterUid,
            targetUid,
            `Olá! Gostaria de adicionar ${this.displayName}.`
          );
        }),
        finalize(() => {
          this.friendRequestBusy$.next(false);
          this.markView();
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível enviar a solicitação de amizade.',
            {
              op: 'sendFriendRequest',
              hasTargetUid: !!targetUid,
            },
            error
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (result === null) {
          return;
        }

        this.errorNotification.showSuccess('Solicitação de amizade enviada.');
      });
  }

  startDirectChat(): void {
    const targetUid = (this.uid ?? '').trim();

    if (!targetUid || this.directChatBusy$.value) {
      return;
    }

    this.directChatBusy$.next(true);

    this.directChatService
      .ensureDirectChatIdWithUser$(targetUid)
      .pipe(
        take(1),
        finalize(() => {
          this.directChatBusy$.next(false);
          this.markView();
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível preparar a conversa.',
            {
              op: 'startDirectChat',
              hasTargetUid: !!targetUid,
            },
            error
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((chatId) => {
        if (!chatId) {
          return;
        }

        this.errorNotification.showSuccess('Conversa disponível. Abrindo área de chats.');

        this.router.navigate(['/chat'], {
          queryParams: {
            openChatId: chatId,
            withUser: targetUid,
          },
        }).catch((error) => {
          this.reportError(
            'A conversa foi aberta, mas a navegação para chats falhou.',
            {
              op: 'navigateToChat',
              hasChatId: !!chatId,
              hasTargetUid: !!targetUid,
            },
            error
          );
        });
      });
  }

  private buildViewerAccess(viewer: IUserDados | null): ViewerAccessState {
    const tier = String(viewer?.tier ?? viewer?.role ?? 'free').trim().toLowerCase();
    const isSubscriber = this.hasElevatedAccess(viewer);

    return {
      tier,
      isSubscriber,
      premiumLabel: this.resolvePremiumLabel(tier, isSubscriber),
    };
  }

  private hasElevatedAccess(user: IUserDados | null): boolean {
    const tier = String(user?.tier ?? user?.role ?? 'free').trim().toLowerCase();

    return (
      user?.isSubscriber === true ||
      user?.monthlyPayer === true ||
      user?.subscriptionStatus === 'active' ||
      ['basic', 'premium', 'vip', 'admin'].includes(tier)
    );
  }

  private resolvePremiumLabel(tier: string, isSubscriber: boolean): string {
    if (['vip', 'admin'].includes(tier)) {
      return 'Acesso VIP';
    }

    if (tier === 'premium') {
      return 'Acesso premium';
    }

    if (isSubscriber) {
      return 'Assinante';
    }

    return 'Conta free';
  }

  private wasRecentlyActive(lastSeen: number | null | undefined): boolean {
    if (typeof lastSeen !== 'number' || !Number.isFinite(lastSeen)) {
      return false;
    }

    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    return Date.now() - lastSeen <= twentyFourHoursMs;
  }

  private getUidFromRoute(): string | null {
    const uid =
      this.route.snapshot.paramMap.get('uid') ??
      this.route.snapshot.paramMap.get('id');

    return uid?.trim() || null;
  }

  private markView(): void {
    this.cdr.markForCheck();
  }

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log('profile', `OtherUserProfileView: ${message}`, extra);
  }

  private reportError(
    message: string,
    extra?: Record<string, unknown>,
    cause?: unknown
  ): void {
    const err = new Error(message);

    (err as any).context = {
      scope: 'OtherUserProfileViewComponent',
      hasUid: !!this.uid,
      ...(extra ?? {}),
    };

    if (cause !== undefined) {
      (err as any).cause = cause;
      (err as any).original = cause;
    }

    (err as any).skipUserNotification = true;

    try {
      this.globalErrorHandler.handleError(err);
    } catch {
      // noop
    }

    try {
      this.errorNotification.showError(message);
    } catch {
      // noop
    }
  }
} // Fim de OtherUserProfileViewComponent, que é responsável por exibir o perfil de outro usuário, priorizando dados públicos e mantendo a segurança real no backend.
// O componente é projetado para ser seguro por design, evitando acesso a dados privados e confiando em serviços de projeção pública e regras de segurança do Firestore para proteger informações sensíveis. Ele também inclui tratamento de erros robusto para garantir que falhas sejam registradas e notificadas adequadamente, sem expor detalhes técnicos ao usuário final.
// O teste associado, OtherUserProfileViewComponent.spec.ts, é um teste mínimo que verifica a criação do componente e a navegação correta quando o perfil do próprio usuário é acessado. Ele utiliza mocks para os serviços injetados e garante que o componente se comporte conforme esperado sem depender de implementações reais desses serviços, mantendo o teste isolado e focado no comportamento do componente.
// O teste é projetado para ser mínimo e focado, garantindo que o componente seja criado corretamente e que a navegação funcione como esperado quando o perfil do próprio usuário é acessado. Ele utiliza mocks para os serviços injetados, evitando dependências reais de Firebase/Firestore/Functions durante o teste, o que torna o teste mais rápido e confiável. O teste também corrige a ausência de imports de describe/beforeEach/it/expect no Vitest e inclui os providers necessários para o standalone component.
// line 621
