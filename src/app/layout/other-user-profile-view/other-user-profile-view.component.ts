// src/app/layout/other-user-profile-view/other-user-profile-view.component.ts
// -----------------------------------------------------------------------------
// PERFIL VISITADO
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - Exibir outro usuário como vitrine de descoberta.
// - Priorizar mídia pública, identidade, afinidades e interação.
// - Consumir somente a projeção pública moderada.
// - Manter amizade, chat, erro global e debug fora da camada visual.

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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  map,
  of,
  shareReplay,
  switchMap,
  take,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
} from 'rxjs/operators';

import { ProfileOfficialCommunitiesComponent } from 'src/app/community/profile-official-communities/profile-official-communities.component';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { ProfileMediaShowcaseComponent } from 'src/app/media/shared/components/profile-media-showcase/profile-media-showcase.component';
import { SocialLinksAccordionComponent } from 'src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';
import { SharedModule } from '../../shared/shared.module';
import { ContentStateComponent } from '../../shared/content-state/content-state.component';
import {
  VisitedProfileFriendshipFacade,
  VisitedProfileFriendshipRelation,
} from './application/visited-profile-friendship.facade';
import { VisitedProfileInteractionOrchestrator } from './application/visited-profile-interaction.orchestrator';
import {
  VisitedProfileIntentContextFacade,
  VisitedProfileIntentContextVm,
} from './application/visited-profile-intent-context.facade';
import { VisitedProfileBootstrapOrchestrator } from './application/visited-profile-bootstrap.orchestrator';
import { VisitedProfileAffinityPresenter } from './application/visited-profile-affinity.presenter';

interface FriendshipInteractionState {
  isFriend: boolean;
  canSendFriendRequest: boolean;
  friendRequestIcon: string;
  friendRequestLabel: string;
  friendRequestAriaLabel: string;
  liveStatus: string;
}

const DEFAULT_PROFILE_PHOTO_URL = 'assets/imagem-padrao.webp';

@Component({
  selector: 'app-other-user-profile-view',
  templateUrl: './other-user-profile-view.component.html',
  styleUrls: ['./other-user-profile-view.component.css'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [VisitedProfileFriendshipFacade, VisitedProfileInteractionOrchestrator, VisitedProfileIntentContextFacade, VisitedProfileBootstrapOrchestrator, VisitedProfileAffinityPresenter],
  imports: [
    CommonModule,
    RouterModule,
    SharedModule,
    ProfileMediaShowcaseComponent,
    SocialLinksAccordionComponent,
    ProfileOfficialCommunitiesComponent,
    ContentStateComponent,
  ],
})
export class OtherUserProfileViewComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly viewedProfileUid$ = new BehaviorSubject<string | null>(null);

  readonly friendshipInteractionState$: Observable<FriendshipInteractionState>;
  readonly publicIntentContext$: Observable<VisitedProfileIntentContextVm | null>;

  uid: string | null = null;
  userProfile: IUserDados | null = null;
  isLoading = true;
  profilePhotoFailed = false;

  readonly friendRequestBusy$ = new BehaviorSubject<boolean>(false);
  readonly directChatBusy$ = new BehaviorSubject<boolean>(false);

  constructor(
    private readonly router: Router,
    private readonly authSession: AuthSessionService,
    private readonly bootstrapOrchestrator: VisitedProfileBootstrapOrchestrator,
    private readonly affinityPresenter: VisitedProfileAffinityPresenter,
    private readonly visitedFriendship: VisitedProfileFriendshipFacade,
    private readonly intentContextFacade: VisitedProfileIntentContextFacade,
    private readonly interactionOrchestrator: VisitedProfileInteractionOrchestrator,
    private readonly cdr: ChangeDetectorRef,
    private readonly applicationError: ApplicationErrorService,
    private readonly errorNotification: ErrorNotificationService
  ) {
    this.friendshipInteractionState$ = this.buildFriendshipInteractionStateStream();
    this.publicIntentContext$ = this.buildPublicIntentContextStream();
  }

  ngOnInit(): void {
    this.isLoading = true;
    this.profilePhotoFailed = false;
    this.markView();

    this.bootstrapOrchestrator
      .load$()
      .pipe(
        finalize(() => {
          this.isLoading = false;
          this.markView();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (result.kind === 'redirect-own-profile') {
          this.uid = result.targetUid;
          this.userProfile = null;
          return;
        }

        if (result.kind === 'missing') {
          this.uid = result.targetUid;
          this.userProfile = null;
          if (result.targetUid) {
            this.viewedProfileUid$.next(result.targetUid);
          }
          return;
        }

        this.uid = result.targetUid;
        this.userProfile = { ...result.profile };
        this.viewedProfileUid$.next(result.targetUid);

        this.debug('bootstrap loaded profile', {
          hasProfile: true,
          hasNickname: !!this.userProfile.nickname,
          hasPhoto: !!this.userProfile.photoURL,
        });
      });
  }

  ngOnDestroy(): void {
    this.viewedProfileUid$.complete();
    this.friendRequestBusy$.complete();
    this.directChatBusy$.complete();
  }

  get hasLocation(): boolean {
    return (
      !!this.userProfile?.municipio?.trim() &&
      !!this.userProfile?.estado?.trim()
    );
  }

  get hasDescription(): boolean {
    return !!this.userProfile?.descricao?.trim();
  }

  get displayName(): string {
    return this.userProfile?.nickname?.trim() || 'Perfil de usuário';
  }

  get profilePhotoUrl(): string {
    const photoUrl = this.userProfile?.photoURL?.trim() ?? '';

    return !this.profilePhotoFailed && photoUrl
      ? photoUrl
      : DEFAULT_PROFILE_PHOTO_URL;
  }

  get discoveryLink(): any[] {
    return ['/dashboard/explorar'];
  }

  goToDiscovery(): void {
    this.router.navigate(this.discoveryLink).catch((error) => {
      this.reportError(
        'Não foi possível voltar para a exploração.',
        { op: 'goToDiscovery' },
        error
      );
    });
  }

  get affinityVm() {
    return this.affinityPresenter.build(this.userProfile);
  }

  get hasPreferenceChips(): boolean {
    return this.affinityVm.preferenceChips.length > 0;
  }

  get preferenceChips(): readonly string[] {
    return this.affinityVm.preferenceChips;
  }

  get desireMatch() {
    return this.affinityVm.desireMatch;
  }

  onProfilePhotoError(): void {
    if (this.profilePhotoFailed) {
      return;
    }

    this.profilePhotoFailed = true;
    this.debug('profile photo failed; using local fallback', {
      hasConfiguredPhoto: !!this.userProfile?.photoURL,
    });
    this.markView();
  }

  sendFriendRequest(): void {
    const targetUid = (this.uid ?? '').trim();

    if (!targetUid || this.friendRequestBusy$.value) {
      return;
    }

    this.friendRequestBusy$.next(true);

    this.friendshipInteractionState$
      .pipe(
        take(1),
        switchMap((interactionState) =>
          this.interactionOrchestrator.sendInterest$(
            targetUid,
            interactionState.canSendFriendRequest,
            interactionState.liveStatus
          )
        ),
        finalize(() => {
          this.friendRequestBusy$.next(false);
          this.markView();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((sent) => {
        if (sent) {
          this.errorNotification.showSuccess('Interesse enviado.');
        }
      });
  }

  startDirectChat(): void {
    const targetUid = (this.uid ?? '').trim();

    if (!targetUid || this.directChatBusy$.value) {
      return;
    }

    this.directChatBusy$.next(true);

    this.interactionOrchestrator
      .prepareDirectChat$(targetUid)
      .pipe(
        finalize(() => {
          this.directChatBusy$.next(false);
          this.markView();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((chatId) => {
        if (!chatId) {
          return;
        }

        this.errorNotification.showSuccess(
          'Conversa disponível. Abrindo área de chats.'
        );

        this.router
          .navigate(['/chat'], {
            queryParams: {
              openChatId: chatId,
              withUser: targetUid,
            },
          })
          .catch((error) => {
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

  private buildPublicIntentContextStream(): Observable<VisitedProfileIntentContextVm | null> {
    const viewerUid$ = this.authSession.uid$.pipe(
      map((uid) => (uid ?? '').trim()),
      distinctUntilChanged()
    );

    const targetUid$ = this.viewedProfileUid$.pipe(
      map((uid) => (uid ?? '').trim()),
      distinctUntilChanged()
    );

    return this.intentContextFacade.observe$(viewerUid$, targetUid$);
  }

  private buildFriendshipInteractionStateStream(): Observable<FriendshipInteractionState> {
    const viewerUid$ = this.authSession.uid$.pipe(
      map((uid) => (uid ?? '').trim()),
      distinctUntilChanged()
    );

    const targetUid$ = this.viewedProfileUid$.pipe(
      map((uid) => (uid ?? '').trim()),
      distinctUntilChanged()
    );

    return this.visitedFriendship
      .observe$(viewerUid$, targetUid$)
      .pipe(
        map((relation) => this.buildFriendshipInteractionState(relation)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
  }

  private buildFriendshipInteractionState(
    relation: VisitedProfileFriendshipRelation
  ): FriendshipInteractionState {
    const safeTargetUid = (this.uid ?? '').trim();

    if (relation.isFriend) {
      return {
        isFriend: true,
        canSendFriendRequest: false,
        friendRequestIcon: 'fas fa-user-check',
        friendRequestLabel: 'Conectados',
        friendRequestAriaLabel: `${this.displayName} já está conectado com você.`,
        liveStatus: 'Vocês estão conectados. O chat está disponível.',
      };
    }

    if (relation.hasPendingOutboundRequest) {
      return {
        isFriend: false,
        canSendFriendRequest: false,
        friendRequestIcon: 'fas fa-clock',
        friendRequestLabel: 'Interesse enviado',
        friendRequestAriaLabel: `Interesse em ${this.displayName} já enviado.`,
        liveStatus: 'Seu interesse já foi enviado para este perfil.',
      };
    }

    return {
      isFriend: false,
      canSendFriendRequest: !!safeTargetUid,
      friendRequestIcon: 'fas fa-heart',
      friendRequestLabel: 'Mostrar interesse',
      friendRequestAriaLabel: `Mostrar interesse em ${this.displayName}`,
      liveStatus: 'Você pode demonstrar interesse neste perfil.',
    };
  }

  private markView(): void {
    this.cdr.markForCheck();
  }

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log(
      'profile',
      `OtherUserProfileView: ${message}`,
      extra
    );
  }

  private reportError(
    message: string,
    extra?: Readonly<Record<string, unknown>>,
    cause?: unknown
  ): void {
    this.applicationError.report(cause ?? new Error(message), {
      feature: 'profile-view',
      operation: String(extra?.['op'] ?? 'unknown'),
      fallbackMessage: message,
      metadata: {
        scope: 'OtherUserProfileViewComponent',
        hasUid: !!this.uid,
        ...(extra ?? {}),
      },
    });
  }
}