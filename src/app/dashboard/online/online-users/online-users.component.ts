// src/app/dashboard/online/online-users/online-users.component.ts
// -----------------------------------------------------------------------------
// OnlineUsersComponent
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - exibir usuários online/próximos com base no estado já materializado pelo NgRx;
// - obter/atualizar a localização do usuário atual por gesto explícito ou permissão já concedida;
// - persistir localização privada em users/{uid};
// - persistir localização pública, já reduzida pela policy, em public_profiles/{uid};
// - aplicar raio visual/local e cálculo de distância;
// - NÃO decidir quem está online no Firestore diretamente.
//
// Fontes de verdade:
// - presence/{uid}: define presença/online/away.
// - public_profiles/{uid}: define card público e localização pública.
// - selectGlobalOnlineUsers: entrega ao componente a lista já combinada/hidratada.
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
  defer,
  firstValueFrom,
  from,
  interval,
  of,
} from 'rxjs';

import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
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

import { selectGlobalOnlineUsers } from 'src/app/store/selectors/selectors.user/online.selectors';
import {
  GeolocationError,
  GeolocationErrorCode,
  GeolocationService,
} from 'src/app/core/services/geolocation/geolocation.service';

import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';
import { environment } from 'src/environments/environment';

import {
  DEFAULT_DISCOVERY_MODE,
  DiscoveryMode,
  discoveryModeRequiresLocation,
  normalizeDiscoveryMode,
} from '../../discovery/models/discovery-mode.model';

import type {IUserWithDistance, UserLocation } from './models/online-users.model';
import { DiscoveryCardEnrichmentService } from '../../discovery/application/discovery-card-enrichment.service';

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
  ],
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css'],
})
export class OnlineUsersComponent implements OnInit {
  private static readonly UI_REFRESH_MS = 15_000;
  private static readonly DEFAULT_MAX_DISTANCE_KM = 20;
  private static readonly MIN_DISTANCE_KM = 1;
  private static readonly LAST_COORDS_TTL_MS = 15 * 60 * 1000;

  private readonly debug = !environment.production;
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
readonly locationAutoCheckDone = signal(false);

private readonly dist$ = new BehaviorSubject<number | null>(null);

  onlineUsers$: Observable<IUserWithDistance[]> = of([]);
  count$: Observable<number> = of(0);

  loading = false;
  userLocation: UserLocation | null = null;

  uiDistanceKm?: number;
  policyMaxDistanceKm = OnlineUsersComponent.DEFAULT_MAX_DISTANCE_KM;

  showProfileCompletionPrompt = false;

  private autoEnableUid: string | null = null;
  private autoEnableInFlight = false;
  private streamsReadyForUid: string | null = null;

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

/**
 * Lista preparada pelo NgRx para o modo Online.
 *
 * Fonte:
 * - selectGlobalOnlineUsers já entrega perfis públicos hidratados com presença.
 *
 * Esta lista ainda será enriquecida pela camada genérica de discovery para:
 * - distância;
 * - score;
 * - filtro por modo;
 * - ordenação;
 * - contrato único de card.
 */
private readonly onlineRaw$ = this.store.select(selectGlobalOnlineUsers).pipe(
  map((users) => (Array.isArray(users) ? (users as IUserDados[]) : [])),
  shareReplay({ bufferSize: 1, refCount: true })
);

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
  private readonly geolocationService: GeolocationService,
  private readonly cardEnrichment: DiscoveryCardEnrichmentService,
  private readonly errorNotificationService: ErrorNotificationService,
  private readonly globalErrorHandlerService: GlobalErrorHandlerService,
  private readonly geoTracking: GeolocationTrackingService,
  private readonly store: Store<AppState>,
  private readonly access: AccessControlService,
  private readonly router: Router
) {
    this.destroyRef.onDestroy(() => {
      this.geoTracking.stopTracking();
    });
  }

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
this.ensureStreamsAfterLocation(gate.user);

if (!discoveryModeRequiresLocation(mode)) {
  /**
   * Em modos que não exigem localização, não existe checagem automática pendente.
   *
   * Isso evita que o template fique preso em estado visual de "verificando
   * localização" quando o usuário está apenas no modo "Todos" ou "Online".
   */
  this.locationAutoCheckDone.set(true);
  return EMPTY;
}

        if (this.autoEnableUid === gate.uid || this.autoEnableInFlight) {
          return EMPTY;
        }

        this.autoEnableUid = gate.uid;
        this.autoEnableInFlight = true;

        return defer(() => from(this.tryAutoEnableLocation(gate.user))).pipe(
          catchError((err) => {
            this.handleGeoError(err);
            return EMPTY;
          }),
          finalize(() => {
            this.autoEnableInFlight = false;
          })
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

    await this.enableLocationInternal({
      requireUserGesture: false,
      silent: false,
    });
  }

  continueWithoutLocation(): void {
    this.resetLocationPrompts();
  }

  goToFinishMinimumProfile(): void {
    this.resetLocationPrompts();

    const redirectTo = this.normalizeRedirectTarget(this.router.url);

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
    const max = Math.max(
      OnlineUsersComponent.MIN_DISTANCE_KM,
      this.policyMaxDistanceKm || OnlineUsersComponent.DEFAULT_MAX_DISTANCE_KM
    );

    const next = Math.min(
      max,
      Math.max(OnlineUsersComponent.MIN_DISTANCE_KM, Number(value) || max)
    );

    this.uiDistanceKm = next;
    this.dist$.next(next);

    this.log('raio alterado', {
      requested: value,
      applied: next,
      max,
    });
  }

  stepRange(delta: number): void {
    const max = Math.max(
      OnlineUsersComponent.MIN_DISTANCE_KM,
      this.policyMaxDistanceKm || OnlineUsersComponent.DEFAULT_MAX_DISTANCE_KM
    );

    const current = this.uiDistanceKm ?? max;
    const next = Math.min(
      max,
      Math.max(OnlineUsersComponent.MIN_DISTANCE_KM, current + delta)
    );

    this.onDistanceChange(next);
  }

  getRangeThumbPercent(value?: number | null): number {
    const min = OnlineUsersComponent.MIN_DISTANCE_KM;
    const max = Math.max(min, this.policyMaxDistanceKm || min);
    const safeValue = Math.min(max, Math.max(min, value ?? max));

    return ((safeValue - min) * 100) / (max - min || 1);
  }

  getRangeTrackBackground(value?: number | null): string {
    const percent = this.getRangeThumbPercent(value);

    return `linear-gradient(to right, var(--primary-color) ${percent}%, var(--range-track-color) ${percent}%)`;
  }

  // ---------------------------------------------------------------------------
  // Fluxo de localização
  // ---------------------------------------------------------------------------

  private async enableLocationInternal(opts: {
    requireUserGesture: boolean;
    silent: boolean;
  }): Promise<void> {
    if (this.loading) return;

    this.loading = true;

    try {
      const currentUser = await firstValueFrom(
        this.currentUserResolved$.pipe(
          filter((user): user is IUserDados => !!user?.uid),
          take(1)
        )
      );

      this.log('enableLocationInternal → user', currentUser.uid);

      const hadSnapshot = this.tryUseLastKnownSnapshot(currentUser);

      const raw = await firstValueFrom(
        this.geolocationService.currentPosition$({
          requireUserGesture: opts.requireUserGesture,
          enableHighAccuracy: false,
          maximumAge: 300_000,
          timeout: 20_000,
        })
      );

      const { coords: safe, policy } = this.geolocationService.applyRolePrivacy(
        raw,
        currentUser.role,
        !!currentUser.emailVerified
      );

      /**
       * Persistências separadas:
       * - raw: users/{uid}, dado privado/completo;
       * - safe: public_profiles/{uid}, dado público já reduzido pela policy.
       */
      await firstValueFrom(
        this.geoTracking.persistLocationOnce$(currentUser.uid, raw)
      );

      await firstValueFrom(
        this.geoTracking.persistPublicLocation$(currentUser.uid, safe)
      );

      this.userLocation = {
        latitude: safe.latitude,
        longitude: safe.longitude,
      };

      this.policyMaxDistanceKm =
        policy?.maxDistanceKm ?? OnlineUsersComponent.DEFAULT_MAX_DISTANCE_KM;

      this.clampUiDistanceToPolicy();

      this.ensureStreamsAfterLocation(currentUser);
      this.dist$.next(this.uiDistanceKm ?? this.policyMaxDistanceKm);

      this.geoTracking.startTracking(currentUser.uid);

      await this.maybePersistAlwaysAllow(opts);

      if (!opts.silent) {
        this.errorNotificationService.showSuccess(
          hadSnapshot
            ? 'Localização atualizada.'
            : 'Localização ativada e usuários carregados.'
        );
      }
    } catch (err) {
      if (err instanceof GeolocationError) {
        if (err.code === GeolocationErrorCode.TIMEOUT && this.userLocation) {
          this.log('Timeout ao refinar posição; mantendo última posição conhecida.');

          this.errorNotificationService.showInfo(
            'Não foi possível atualizar sua posição agora; usando a última conhecida.'
          );

          return;
        }

if (err.code === GeolocationErrorCode.PERMISSION_DENIED) {
  this.geoTracking.stopTracking();

  if (this.userLocation) {
    this.log('Permissão negada; mantendo última posição conhecida.');

    this.errorNotificationService.showInfo(
      'Permissão de localização negada. Mantendo a última posição conhecida.'
    );

    return;
  }
}
      }

      this.handleGeoError(err);
    } finally {
      this.loading = false;
    }
  }

  private tryUseLastKnownSnapshot(currentUser: IUserDados): boolean {
    const snap = this.geoTracking.getLastSnapshot(
      OnlineUsersComponent.LAST_COORDS_TTL_MS
    );

    if (snap?.latitude == null || snap?.longitude == null) {
      return false;
    }

    const { coords: safe, policy } = this.geolocationService.applyRolePrivacy(
      snap as any,
      currentUser.role,
      !!currentUser.emailVerified
    );

    this.userLocation = {
      latitude: safe.latitude,
      longitude: safe.longitude,
    };

    this.policyMaxDistanceKm =
      policy?.maxDistanceKm ?? OnlineUsersComponent.DEFAULT_MAX_DISTANCE_KM;

    this.clampUiDistanceToPolicy();

    this.ensureStreamsAfterLocation(currentUser);
    this.dist$.next(this.uiDistanceKm ?? this.policyMaxDistanceKm);

this.log('Usando snapshot local enquanto refinamos a posição', {
  userLocation: this.userLocation,
  policyMaxDistanceKm: this.policyMaxDistanceKm,
  uiDistanceKm: this.uiDistanceKm,
});

    return true;
  }

/**
 * Nome mantido para reduzir impacto da migração.
 *
 * Antes este stream só era criado depois da localização.
 * Agora ele também precisa funcionar no modo "Todos", sem localização.
 *
 * Regras:
 * - all: lista todos os perfis online recebidos do NgRx;
 * - nearby: exige localização e aplica raio;
 * - modos futuros podem reaproveitar este mesmo pipeline.
 */
private ensureStreamsAfterLocation(currentUser: IUserDados): void {
  if (this.streamsReadyForUid === currentUser.uid) {
    return;
  }

  this.streamsReadyForUid = currentUser.uid;

  const uiTick$ = interval(OnlineUsersComponent.UI_REFRESH_MS).pipe(
    startWith(0)
  );

  const km$ = this.dist$.pipe(
    startWith(this.uiDistanceKm ?? this.policyMaxDistanceKm)
  );

this.onlineUsers$ = combineLatest([
  this.mode$,
  km$,
  uiTick$,
  this.onlineRaw$,
  this.currentUserResolved$,
]).pipe(
  map(([mode, km, _tick, users, liveCurrentUser]) => {
    const effectiveCurrentUser = liveCurrentUser ?? currentUser;
    const cap = this.normalizeDistanceCap(km);
    const filteredByPrefs = this.applyUserPreferences(
      users,
      effectiveCurrentUser
    );

const enriched = this.cardEnrichment.buildCards({
  profiles: filteredByPrefs,
  currentUser: effectiveCurrentUser,
  currentUid: effectiveCurrentUser.uid,
  mode,
  capKm: cap,
  fallbackLocation: this.userLocation,
  applyVisibility: true,
});

this.log('onlineUsers enrichment result', {
  mode,
  inputTotal: filteredByPrefs.length,
  outputTotal: enriched.length,
  capKm: cap,
  hasFallbackLocation: !!this.userLocation,
});

return enriched as IUserWithDistance[];
  }),
    catchError((err) => {
      this.handleGeoError(err);
      return of([] as IUserWithDistance[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  this.count$ = this.onlineUsers$.pipe(
    map((list) => list.length),
    startWith(0),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}

  private normalizeDistanceCap(value: number | null | undefined): number {
    const max = Math.max(
      OnlineUsersComponent.MIN_DISTANCE_KM,
      this.policyMaxDistanceKm || OnlineUsersComponent.DEFAULT_MAX_DISTANCE_KM
    );

    return Math.min(
      max,
      Math.max(OnlineUsersComponent.MIN_DISTANCE_KM, Number(value ?? max) || max)
    );
  }

  private clampUiDistanceToPolicy(): void {
    const max = Math.max(
      OnlineUsersComponent.MIN_DISTANCE_KM,
      this.policyMaxDistanceKm || OnlineUsersComponent.DEFAULT_MAX_DISTANCE_KM
    );

    const current = this.uiDistanceKm ?? max;

    this.uiDistanceKm = Math.min(
      max,
      Math.max(OnlineUsersComponent.MIN_DISTANCE_KM, current)
    );
  }

  // ---------------------------------------------------------------------------
  // Processamento dos usuários online
  // ---------------------------------------------------------------------------

  private applyUserPreferences(
    users: IUserDados[],
    _currentUser: IUserDados
  ): IUserDados[] {
    /**
     * Ponto futuro:
     * - preferências de gênero/orientação;
     * - bloqueios;
     * - invisibilidade;
     * - idade;
     * - limites por assinatura.
     *
     * Por enquanto, não filtramos por preferência aqui.
     */
    return users;
  }

  // ---------------------------------------------------------------------------
  // Auto-enable / fallback local
  // ---------------------------------------------------------------------------
private async tryAutoEnableLocation(user: IUserDados | null): Promise<void> {
  this.locationAutoCheckDone.set(false);

  try {
    if (!user?.uid) {
      return;
    }

    /**
     * Primeiro tenta usar snapshot local.
     * Isso evita exibir o card "Ativar localização" enquanto o browser ainda
     * está refinando a posição atual.
     */
    const usedSnapshot = this.tryUseLastKnownSnapshot(user);

    const state = await this.geoTracking.queryPermission();

    this.log('auto-enable: permission state', {
      uid: user.uid,
      state,
      usedSnapshot,
    });

    if (state === 'granted') {
      await this.enableLocationInternal({
        requireUserGesture: false,
        silent: true,
      });

      if (this.userLocation) {
        this.log('auto-enable: localização carregada automaticamente', {
          uid: user.uid,
          hasLocation: true,
        });

        return;
      }
    }

    if (usedSnapshot) {
      return;
    }

    this.log('auto-enable: aguardando ação do usuário');
  } finally {
    this.locationAutoCheckDone.set(true);
  }
}

  // ---------------------------------------------------------------------------
  // LocalStorage
  // ---------------------------------------------------------------------------
private async maybePersistAlwaysAllow(ctx: {
  requireUserGesture: boolean;
  silent: boolean;
}): Promise<void> {
  if (ctx.silent) return;

  const state = await this.geoTracking.queryPermission();

  if (state === 'granted') {
    /**
     * A permissão já foi concedida pelo navegador.
     * Não fazemos segundo confirm interno.
     */
    return;
  }
}

  // ---------------------------------------------------------------------------
  // Estado / navegação / reset
  // ---------------------------------------------------------------------------
private resetRuntimeState(): void {
  this.autoEnableUid = null;
  this.autoEnableInFlight = false;
  this.streamsReadyForUid = null;
  this.locationAutoCheckDone.set(false);

  this.geoTracking.stopTracking();

  this.userLocation = null;
  this.uiDistanceKm = undefined;
  this.policyMaxDistanceKm = OnlineUsersComponent.DEFAULT_MAX_DISTANCE_KM;

  this.dist$.next(null);

  this.onlineUsers$ = of([]);
  this.count$ = of(0);

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

  // ---------------------------------------------------------------------------
  // Tratamento centralizado de erro
  // ---------------------------------------------------------------------------

  private handleGeoError(err: unknown): void {
    let msg = 'Falha ao obter a sua localização.';
    let isGestureOnly = false;

    if (err instanceof GeolocationError) {
      switch (err.code) {
        case GeolocationErrorCode.UNSUPPORTED:
          msg = 'Seu navegador não suporta geolocalização.';
          break;

        case GeolocationErrorCode.INSECURE_CONTEXT:
          msg = 'Ative HTTPS ou use localhost para permitir a geolocalização.';
          break;

        case GeolocationErrorCode.PERMISSION_DENIED:
          msg = 'Permissão de localização negada.';
          break;

        case GeolocationErrorCode.USER_GESTURE_REQUIRED:
          msg = 'Clique em “Ativar localização” para continuar.';
          isGestureOnly = true;
          break;

        case GeolocationErrorCode.POSITION_UNAVAILABLE:
          msg = 'Posição atual indisponível.';
          break;

        case GeolocationErrorCode.TIMEOUT:
          msg = 'Tempo esgotado ao tentar localizar você.';
          break;

        default:
          msg = 'Ocorreu um erro desconhecido ao obter localização.';
      }
    } else if (err instanceof Error) {
      msg = err.message || msg;
    }

    this.errorNotificationService.showError(msg);

    const expectedPermissionDenied =
      err instanceof GeolocationError &&
      err.code === GeolocationErrorCode.PERMISSION_DENIED;

    if (!isGestureOnly && !expectedPermissionDenied) {
      const e = err instanceof Error ? err : new Error(msg);

      (e as any).context = 'OnlineUsersComponent.handleGeoError';
      (e as any).original = err;
      (e as any).skipUserNotification = true;

      this.globalErrorHandlerService.handleError(e);
    }
  }

  private log(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[OnlineUsers] ${message}`, extra ?? '');
  } 
}// Linha 959, absurdamente grande para um componente, mas a maioria das linhas são tipos, estados e comentários detalhados. Refatorar para reduzir complexidade futura é recomendado, mas fora do escopo desta tarefa de migração.