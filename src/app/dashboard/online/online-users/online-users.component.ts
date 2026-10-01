// src/app/dashboard/online/online-users/online-users.component.ts
// -----------------------------------------------------------------------------
// OnlineUsersComponent
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - exibir usuários online/próximos com base no estado já materializado pelo NgRx;
// - obter/atualizar a localização do usuário atual por gesto explícito ou permissão já concedida;
// - persistir localização privada em users/{uid};
// - consumir a localização pública derivada pelo backend em public_profiles/{uid};
// - aplicar raio visual/local e cálculo de distância;
// - NÃO decidir quem está online no Firestore diretamente.
//
// Fontes de verdade:
// - presence/{uid}: define presença/online/away.
// - public_profiles/{uid}: define card público e localização pública.
// - a lista de presença pública chega ao feed pela facade de enrichment.
//
// Separação de responsabilidades:
// - profileCompleted controla entrada na feature.
// - emailVerified não bloqueia localmente esta tela; entra como policy de privacidade
//   no GeolocationService.
//
// Observação:
// - Este componente não deve consultar Firestore diretamente.
// - Se inputTotal > 0 e outputTotal = 0, o console.table mostra exatamente
//   o motivo de rejeição de cada candidato.
import { Component, DestroyRef, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import {
  BehaviorSubject,
  EMPTY,
  Observable,
  combineLatest,
  firstValueFrom,
  from,
  of,
} from 'rxjs';

import {
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Store } from '@ngrx/store';

import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { selectCurrentUser, selectCurrentUserStatus
  } from 'src/app/store/selectors/selectors.user/user.selectors';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';

import {
  DEFAULT_DISCOVERY_MODE,
  DiscoveryMode,
  discoveryModeRequiresLocation,
  normalizeDiscoveryMode,
} from '../../discovery/models/discovery-mode.model';

import type { UserLocation } from './models/online-users.model';
import { OnlineUsersLocationFacade } from './application/online-users-location.facade';
import { OnlineUsersFeedFacade } from './application/online-users-feed.facade';

function shallowUserEqual(
  a: IUserDados | null,
  b: IUserDados | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.uid === b.uid &&
    a.emailVerified === b.emailVerified &&
    a.role === b.role &&
    a.profileCompleted === b.profileCompleted &&
    (a.municipio || '') === (b.municipio || '') &&
    (a.estado || '') === (b.estado || '')
  );
}

@Component({
  selector: 'app-online-users',
  standalone: true,
  imports: [
    CommonModule,
    AsyncPipe,
    FormsModule,
    RouterModule,
    UserCardComponent,
    ContentStateComponent,
  ],
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css'],
  providers: [OnlineUsersLocationFacade, OnlineUsersFeedFacade],
})
export class OnlineUsersComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  // ---------------------------------------------------------------------------
  // Estado local da UI
  // ---------------------------------------------------------------------------
readonly discoveryControlsOpen = signal(false);

/**
 * Controla a primeira tentativa automática de localização após refresh.
 *
 * Motivo:
 * - userLocation começa como null em todo refresh;
 * - sem este estado, o template mostra "Ativar localização" antes de terminar
 *   a consulta da permissão já concedida pelo navegador.
 */
readonly locationAutoCheckDone = this.locationFacade.autoCheckDone;

  get loading(): boolean {
    return this.locationFacade.loading();
  }

  get userLocation(): UserLocation | null {
    return this.locationFacade.location();
  }

  set userLocation(value: UserLocation | null) {
    this.locationFacade.location.set(value);
  }

  get uiDistanceKm(): number | undefined {
    return this.locationFacade.uiDistanceKm();
  }

  set uiDistanceKm(value: number | undefined) {
    this.locationFacade.uiDistanceKm.set(value);
  }

  get policyMaxDistanceKm(): number {
    return this.locationFacade.policyMaxDistanceKm();
  }

  showProfileCompletionPrompt = false;


  // ---------------------------------------------------------------------------
  // Seletores / streams base
  // ---------------------------------------------------------------------------

  readonly currentUserStatus$ = this.store.select(selectCurrentUserStatus);

  readonly currentUserResolved$ = this.store.select(selectCurrentUser).pipe(
    startWith(undefined as IUserDados | null | undefined),
    filter((user): user is IUserDados | null => user !== undefined),
    distinctUntilChanged((a, b) => shallowUserEqual(a, b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  toggleDiscoveryControls(): void {
  this.discoveryControlsOpen.update((open) => !open);
}

private readonly modeSubject = new BehaviorSubject<DiscoveryMode>(
  DEFAULT_DISCOVERY_MODE
);

readonly mode$: Observable<DiscoveryMode> = this.modeSubject.pipe(
  distinctUntilChanged(),
  shareReplay({ bufferSize: 1, refCount: true })
);

@Input()
set mode(value: DiscoveryMode | null | undefined) {
  this.modeSubject.next(normalizeDiscoveryMode(value));
}

get mode(): DiscoveryMode {
  return this.modeSubject.value;
}

readonly onlineUsers$ = this.feedFacade.observe$(this.mode$);
readonly count$ = this.feedFacade.count$(this.onlineUsers$);

/**
 * Lista preparada pelo NgRx para o modo Online.
 *
 * Fonte:
 * A composição da lista e o enrichment vivem em OnlineUsersFeedFacade.
 */
  private readonly authUid$ = this.access.authUid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly canRunOnlineUsers$ = this.access.canRunOnlineUsers$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly gate$: Observable<{
    canStart: boolean;
    uid: string | null;
    user: IUserDados | null;
  }> = combineLatest([
    this.canRunOnlineUsers$,
    this.authUid$,
    this.currentUserResolved$,
  ]).pipe(
    map(([canRunFeature, uid, user]) => {
      const hasOperationalUser = !!user?.uid;

      return {
        canStart: canRunFeature === true && !!uid && hasOperationalUser,
        uid,
        user: hasOperationalUser ? user : null,
      };
    }),
    distinctUntilChanged(
      (a, b) =>
        a.canStart === b.canStart &&
        a.uid === b.uid &&
        shallowUserEqual(a.user, b.user)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

constructor(
  private readonly errorNotificationService: ErrorNotificationService,
  private readonly store: Store<AppState>,
  private readonly access: AccessControlService,
  private readonly router: Router,
  private readonly locationFacade: OnlineUsersLocationFacade,
  private readonly feedFacade: OnlineUsersFeedFacade,
  private readonly privacyDebug: PrivacyDebugLoggerService
) {}

ngOnInit(): void {
  combineLatest([this.gate$, this.mode$])
    .pipe(
      tap(([gate, mode]) =>
        this.log('gate/mode', {
          canStart: gate.canStart,
          uid: gate.uid,
          mode,
        })
      ),

      switchMap(([gate, mode]) => {
        if (!gate.canStart || !gate.uid || !gate.user) {
          this.resetRuntimeState();
          return EMPTY;
        }

        /**
         * Importante:
         * - no modo "Todos", a lista deve existir sem localização;
         * - no modo "Perto", a localização entra como filtro adicional.
         */
if (!discoveryModeRequiresLocation(mode)) {
  /**
   * Em modos que não exigem localização, não existe checagem automática pendente.
   *
   * Isso evita que o template fique preso em estado visual de "verificando
   * localização" quando o usuário está apenas no modo "Todos" ou "Online".
   */
  this.locationFacade.markAutoCheckDone();
  return EMPTY;
}

        return from(
          this.locationFacade.tryAutoEnable(gate.user)
        );
      }),

      takeUntilDestroyed(this.destroyRef)
    )
    .subscribe();
}

/**
 * Informa se o modo atual depende de GPS.
 *
 * Exemplo:
 * - all: false
 * - online: false
 * - nearby: true
 */
get currentModeRequiresLocation(): boolean {
  return discoveryModeRequiresLocation(this.mode);
}

/**
 * Mostra o card de ativação apenas quando o modo realmente precisa de localização.
 */
get shouldShowLocationRequest(): boolean {
  return (
    this.currentModeRequiresLocation &&
    this.locationAutoCheckDone() &&
    !this.userLocation &&
    !this.loading
  );
}

/**
 * Mostra estado de carregamento de localização apenas quando o modo precisa dela.
 */
get shouldShowLocationLoading(): boolean {
  return (
    this.currentModeRequiresLocation &&
    !this.locationAutoCheckDone()
  );
}

/**
 * Mostra controles de raio apenas quando localização for relevante e existir.
 */
get shouldShowDistanceControls(): boolean {
  return (
    this.currentModeRequiresLocation &&
    !!this.userLocation
  );
}

/**
 * Texto contextual para vazio da lista.
 */
get emptyTitle(): string {
  if (this.currentModeRequiresLocation) {
    return 'Nenhum perfil no raio atual';
  }

  return 'Nenhum perfil disponível agora';
}

/**
 * Texto contextual para vazio da lista.
 */
get emptyText(): string {
  if (this.currentModeRequiresLocation) {
    return 'Tente aumentar a distância ou atualizar sua posição.';
  }

  return 'Assim que houver perfis disponíveis, eles aparecerão aqui.';
}

/**
 * Rótulo acessível da lista.
 */
get listAriaLabel(): string {
  if (this.mode === 'all') return 'Lista geral de perfis';
  if (this.mode === 'online') return 'Lista de perfis online';
  if (this.mode === 'nearby') return 'Lista de perfis próximos';

  return 'Lista de perfis';
}

  // ---------------------------------------------------------------------------
  // Ações públicas usadas pelo template
  // ---------------------------------------------------------------------------

  async enableLocation(): Promise<void> {
    const [canRun, profileOk, currentUser] = await firstValueFrom(
      combineLatest([
        this.access.canRunOnlineUsers$,
        this.access.profileEligible$,
        this.currentUserResolved$.pipe(take(1)),
      ]).pipe(take(1))
    );

    if (!currentUser?.uid) {
      this.errorNotificationService.showError(
        'Entre na sua conta para ativar a localização.'
      );
      return;
    }

    this.resetLocationPrompts();

    if (!profileOk) {
      this.showProfileCompletionPrompt = true;
      return;
    }

    if (!canRun) {
      this.errorNotificationService.showError(
        'Perfis online indisponível no momento.'
      );
      return;
    }

    await this.locationFacade.enable(currentUser, {
      requireUserGesture: false,
      silent: false,
    });
  }

  continueWithoutLocation(): void {
    this.resetLocationPrompts();
  }

  async goToFinishMinimumProfile(): Promise<void> {
    this.resetLocationPrompts();

    const redirectTo = this.normalizeRedirectTarget(this.router.url);
    const currentUser = await firstValueFrom(
      this.currentUserResolved$.pipe(take(1))
    ).catch(() => null);

    if (currentUser?.emailVerified !== true) {
      this.router
        .navigate(['/register/welcome'], {
          queryParams: {
            autocheck: '1',
            reason: 'email_unverified',
            redirectTo,
          },
        })
        .catch(() => {});
      return;
    }

    this.router
      .navigate(['/register/finalizar-cadastro'], {
        queryParams: {
          reason: 'profile_incomplete',
          redirectTo,
        },
      })
      .catch(() => {});
  }

  onDistanceChange(value: number): void {
    this.locationFacade.setUiDistance(value);
  }

  stepRange(delta: number): void {
    this.locationFacade.stepRange(delta);
  }

  getRangeThumbPercent(value?: number | null): number {
    return this.locationFacade.getRangeThumbPercent(value);
  }

  getRangeTrackBackground(value?: number | null): string {
    return this.locationFacade.getRangeTrackBackground(value);
  }

  // ---------------------------------------------------------------------------
  // Estado / navegação / reset
  // ---------------------------------------------------------------------------
private resetRuntimeState(): void {
  this.locationFacade.reset();

  this.resetLocationPrompts();
}

  private resetLocationPrompts(): void {
    this.showProfileCompletionPrompt = false;
  }

private normalizeRedirectTarget(url: string | null | undefined): string {
  const clean = (url ?? '').trim();

  if (!clean) return '/dashboard/explorar';
  if (!clean.startsWith('/') || clean.startsWith('//')) {
    return '/dashboard/explorar';
  }

  return clean;
}

  private log(message: string, extra?: unknown): void {
    this.privacyDebug.log(
      'online-users',
      `OnlineUsersComponent: ${message}`,
      extra
    );
  }
}
