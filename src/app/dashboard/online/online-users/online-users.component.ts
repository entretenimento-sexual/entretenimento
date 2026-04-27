// src/app/dashboard/online/online-users/online-users.component.ts
//
// Objetivo:
// - renderizar perfis online com base na localização do usuário
// - manter UX de permissão por gesto explícito do usuário
// - exigir perfil mínimo para ativar localização nesta área
// - tratar e-mail não verificado como limitação de precisão/raio,
//   e não como bloqueio local desta ação
//
// Ajustes desta revisão:
// - removido prompt contextual de verificação de e-mail
// - removido bloqueio local por emailVerified dentro de enableLocation()
// - mantido prompt contextual apenas para perfil mínimo incompleto
//
// Supressões explícitas desta versão:
// 1) showEmailVerificationPrompt
// 2) goToEmailVerification()
// 3) uso de emailVerified$ como condição de bloqueio local em enableLocation()
//
// Motivo das supressões:
// o GeolocationService já aplica limitação por verificação de e-mail via policy.
// Manter limitação e bloqueio ao mesmo tempo gerava incoerência entre regra e interface.
// Referência: serviço e logs compartilhados pelo usuário. 

import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';

import {
  BehaviorSubject,
  Observable,
  firstValueFrom,
  combineLatest,
  interval,
  of,
  EMPTY,
  defer,
  from
} from 'rxjs';

import {
  map,
  startWith,
  filter,
  take,
  distinctUntilChanged,
  shareReplay,
  catchError,
  tap,
  switchMap
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  GeolocationService,
  GeolocationError,
  GeolocationErrorCode
} from 'src/app/core/services/geolocation/geolocation.service';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';
import { AppState } from 'src/app/store/states/app.state';
import { Store } from '@ngrx/store';
import {
  selectCurrentUser,
  selectCurrentUserStatus
} from 'src/app/store/selectors/selectors.user/user.selectors';
import { selectGlobalOnlineUsers } from 'src/app/store/selectors/selectors.user/online.selectors';
import { toEpochOrZero } from 'src/app/core/utils/epoch-utils';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';

type PermissionState = 'granted' | 'prompt' | 'denied';
type IUserWithDistance = IUserDados & { distanciaKm?: number };

function shallowUserEqual(a: IUserDados | null, b: IUserDados | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.uid === b.uid &&
    a.isOnline === b.isOnline &&
    a.emailVerified === b.emailVerified &&
    a.role === b.role &&
    (a.municipio || '') === (b.municipio || '')
  );
}

@Component({
  selector: 'app-online-users',
  standalone: true,
  imports: [CommonModule, AsyncPipe, FormsModule, UserCardComponent, RouterModule],
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css']
})
export class OnlineUsersComponent implements OnInit {
  private static readonly RECENT_WINDOW_MS = 2 * 60 * 1000;
  private static readonly UI_REFRESH_MS = 15_000;

  private readonly DEBUG = true;
  private log(...args: unknown[]) {
    if (this.DEBUG) console.log('[OnlineUsers]', ...args);
  }

  private readonly destroyRef = inject(DestroyRef);

  // ===========================================================================
  // Estado local da UI
  // ===========================================================================

  private readonly dist$ = new BehaviorSubject<number | null>(null);

  onlineUsers$?: Observable<IUserWithDistance[]>;
  count$!: Observable<number>;

  loading = false;
  userLocation: { latitude: number; longitude: number } | null = null;
  uiDistanceKm?: number;
  policyMaxDistanceKm = 20;

  /**
   * Prompt contextual:
   * aparece apenas quando o usuário clica em "Ativar localização"
   * mas ainda não concluiu o perfil mínimo.
   */
  showProfileCompletionPrompt = false;

  private readonly LS_ALWAYS_ALLOW = 'geo:alwaysAllow';
  private readonly LS_LAST_COORDS = 'geo:lastCoords';

  // ===========================================================================
  // Seletores / streams base
  // ===========================================================================

  readonly currentUserStatus$ = this.store.select(selectCurrentUserStatus);

  readonly currentUserResolved$ = this.store.select(selectCurrentUser).pipe(
    startWith(undefined as IUserDados | null | undefined),
    filter((u): u is IUserDados | null => u !== undefined),
    distinctUntilChanged((a, b) => shallowUserEqual(a, b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly onlineRaw$ = this.store.select(selectGlobalOnlineUsers).pipe(
    map((users) => Array.isArray(users) ? (users as IUserDados[]) : []),
    distinctUntilChanged((a, b) => a === b),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly authUid$ = this.access.authUid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Gate central da feature.
   * Este componente respeita essa capacidade,
   * mas a UX local da ativação da localização foi suavizada.
   */
  private readonly canRunOnlineUsers$ = this.access.canRunOnlineUsers$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Gate operacional do componente:
   * só começa auto-enable / listeners quando a feature e o usuário estão aptos.
   */
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
        canStart: canRunFeature && !!uid && hasOperationalUser,
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

  private autoEnableUid: string | null = null;

  constructor(
    private readonly geolocationService: GeolocationService,
    private readonly distanceService: DistanceCalculationService,
    private readonly errorNotificationService: ErrorNotificationService,
    private readonly globalErrorHandlerService: GlobalErrorHandlerService,
    private readonly geoTracking: GeolocationTrackingService,
    private readonly store: Store<AppState>,
    private readonly access: AccessControlService,
    private readonly router: Router,
  ) {
    this.destroyRef.onDestroy(() => {
      this.geoTracking.stopTracking();
    });
  }

  ngOnInit(): void {
    this.gate$
      .pipe(
        tap((g) => this.log('gate', { canStart: g.canStart, uid: g.uid })),
        switchMap((g) => {
          if (!g.canStart || !g.uid || !g.user) {
            this.autoEnableUid = null;
            this.geoTracking.stopTracking();

            this.userLocation = null;
            this.uiDistanceKm = undefined;
            this.policyMaxDistanceKm = 20;
            this.dist$.next(null);

            this.onlineUsers$ = of([] as IUserWithDistance[]);
            this.count$ = of(0);

            return EMPTY;
          }

          if (this.autoEnableUid === g.uid) {
            return EMPTY;
          }

          this.autoEnableUid = g.uid;

          return defer(() => from(this.tryAutoEnableLocation(g.user))).pipe(
            catchError((err) => {
              this.handleGeoError(err);
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ===========================================================================
  // UX da ativação de localização
  // ===========================================================================

  /**
   * Política desta versão:
   * - perfil mínimo incompleto => prompt contextual
   * - e-mail não verificado => não bloqueia localmente este clique
   * - capacidade geral da feature => ainda respeitada por canRunOnlineUsers$
   *
   * Observação importante:
   * Se o AccessControlService ainda estiver negando canRunOnlineUsers por e-mail
   * não verificado, a regra central precisará ser ajustada lá também.
   */
  async enableLocation(): Promise<void> {
    const [can, profileOk, user] = await firstValueFrom(
      combineLatest([
        this.access.canRunOnlineUsers$,
        this.access.profileEligible$,
        this.currentUserResolved$.pipe(take(1)),
      ]).pipe(take(1))
    );

    if (!user?.uid) {
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

    if (!can) {
      this.errorNotificationService.showError(
        'Perfis Online indisponível no momento.'
      );
      return;
    }

    await this.enableLocationInternal({
      requireUserGesture: false,
      silent: false
    });
  }

  /**
   * Usuário opta por permanecer na área sem ativar localização.
   */
  continueWithoutLocation(): void {
    this.resetLocationPrompts();
  }

  /**
   * Redireciona para a etapa que conclui o perfil mínimo.
   */
  goToFinishMinimumProfile(): void {
    this.resetLocationPrompts();

    const redirectTo = this.normalizeRedirectTarget(this.router.url);

    this.router.navigate(
      ['/register/finalizar-cadastro'],
      { queryParams: { redirectTo } }
    ).catch(() => {});
  }

  private resetLocationPrompts(): void {
    this.showProfileCompletionPrompt = false;
  }

  private normalizeRedirectTarget(url: string | null | undefined): string {
    const clean = (url ?? '').trim();

    if (!clean) return '/dashboard/online';
    if (!clean.startsWith('/') || clean.startsWith('//')) {
      return '/dashboard/online';
    }

    return clean;
  }

  // ===========================================================================
  // Fluxo real de localização
  // ===========================================================================

  private async enableLocationInternal(opts: { requireUserGesture: boolean; silent: boolean }): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    try {
      const currentUser = await firstValueFrom(
        this.currentUserResolved$.pipe(
          filter((u): u is IUserDados => !!u?.uid),
          take(1)
        )
      );

      this.log('enableLocationInternal → user:', currentUser.uid);

      const snap = this.geoTracking.getLastSnapshot(3 * 60 * 1000);
      let hadSnapshot = false;

      if (snap?.latitude != null && snap?.longitude != null) {
        this.userLocation = { latitude: snap.latitude, longitude: snap.longitude };
        this.policyMaxDistanceKm = this.policyMaxDistanceKm || 20;
        this.uiDistanceKm = this.uiDistanceKm ?? this.policyMaxDistanceKm;
        this.setupStreamsAfterLocation(currentUser);
        this.dist$.next(this.uiDistanceKm);
        hadSnapshot = true;
        this.log('Usando snapshot local enquanto refinamos a posição...');
      }

      const raw = await firstValueFrom(
        this.geolocationService.currentPosition$({
          requireUserGesture: opts.requireUserGesture,
          enableHighAccuracy: false,
          maximumAge: 300_000,
          timeout: 20_000
        })
      );

      /**
       * Aqui a policy por role + emailVerified continua válida.
       * Se o e-mail não estiver verificado, a geolocalização continua possível,
       * mas com precisão/raio mais restritos.
       */
      const { coords: safe, policy } = this.geolocationService.applyRolePrivacy(
        raw,
        currentUser.role,
        !!currentUser.emailVerified
      );

      this.userLocation = { latitude: safe.latitude, longitude: safe.longitude };
      this.policyMaxDistanceKm = policy?.maxDistanceKm ?? 20;
      this.uiDistanceKm = this.uiDistanceKm ?? this.policyMaxDistanceKm;

      if (!hadSnapshot) {
        this.setupStreamsAfterLocation(currentUser);
        this.dist$.next(this.uiDistanceKm);
      }

      this.persistLastCoords(this.userLocation);
      this.geoTracking.startTracking(currentUser.uid);

      await this.maybePersistAlwaysAllow(opts);

      if (!opts.silent) {
        this.errorNotificationService.showSuccess(
          'Localização ativada e usuários carregados.'
        );
      }
    } catch (err) {
      if (err instanceof GeolocationError && err.code === GeolocationErrorCode.TIMEOUT) {
        if (this.userLocation) {
          this.log('Timeout ao refinar posição; mantendo snapshot.');
          this.errorNotificationService.showInfo(
            'Não foi possível atualizar sua posição agora; usando a última conhecida.'
          );
          this.loading = false;
          return;
        }
      }

      this.handleGeoError(err);
    } finally {
      this.loading = false;
    }
  }

  private setupStreamsAfterLocation(currentUser: IUserDados): void {
    const uiTick$ = interval(OnlineUsersComponent.UI_REFRESH_MS).pipe(startWith(0));
    const km$ = this.dist$.pipe(startWith(this.uiDistanceKm ?? this.policyMaxDistanceKm));

    this.onlineUsers$ = combineLatest([km$, uiTick$, this.onlineRaw$]).pipe(
      map(([km, _tick, users]) => {
        const cap = Math.min(km ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm);
        const filteredByPrefs = this.applyUserPreferences(users, currentUser);
        return this.processOnlineUsers(filteredByPrefs, currentUser.uid, cap);
      }),
      catchError((err) => {
        this.handleGeoError(err);
        return of([] as IUserWithDistance[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.count$ = this.onlineUsers$.pipe(
      map((list) => list.length),
      startWith(0)
    );
  }

  onDistanceChange(v: number): void {
    const cap = Math.min(v ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm);
    this.log('raio alterado:', v, '→ cap:', cap);
    this.dist$.next(cap);
  }

  private applyUserPreferences(users: IUserDados[], _currentUser: IUserDados): IUserDados[] {
    return users;
  }

  private processOnlineUsers(
    users: IUserDados[],
    loggedUID: string,
    capKm: number
  ): IUserWithDistance[] {
    if (!this.userLocation) return [];

    const now = Date.now();
    const recentMs = OnlineUsersComponent.RECENT_WINDOW_MS;

    return (users || [])
      .filter((u) => (u as any)?.isOnline === true || this.isRecent((u as any)?.lastSeen, now, recentMs))
      .filter((u) => u.latitude != null && u.longitude != null && u.uid !== loggedUID)
      .map((u) => {
        if (u.latitude == null || u.longitude == null || !this.userLocation) {
          return { ...u, distanciaKm: undefined as number | undefined };
        }

        const d = this.distanceService.calculateDistanceInKm(
          this.userLocation.latitude,
          this.userLocation.longitude,
          u.latitude,
          u.longitude
        );

        return { ...u, distanciaKm: d ?? undefined };
      })
      .filter((u) => u.uid !== loggedUID && (u.distanciaKm == null || u.distanciaKm <= capKm))
      .sort((a, b) => this.compareUsersStable(a, b));
  }

  private compareUsersStable(a: IUserDados, b: IUserDados): number {
    const rolePriority: Record<string, number> = {
      vip: 1,
      premium: 2,
      basic: 3,
      free: 4
    };

    const ra = rolePriority[(a.role || 'free').toLowerCase()] ?? 4;
    const rb = rolePriority[(b.role || 'free').toLowerCase()] ?? 4;

    if (ra !== rb) return ra - rb;
    if (!a.photoURL && b.photoURL) return 1;
    if (a.photoURL && !b.photoURL) return -1;

    const m = (a.municipio?.toLowerCase() || '').localeCompare(b.municipio?.toLowerCase() || '');
    if (m !== 0) return m;

    const aLast = typeof a.lastLogin === 'number' ? a.lastLogin : 0;
    const bLast = typeof b.lastLogin === 'number' ? b.lastLogin : 0;

    return bLast - aLast;
  }

  private isRecent(lastSeen: unknown, nowMs: number, windowMs: number): boolean {
    const ms = toEpochOrZero(lastSeen as any);
    return ms > 0 && (nowMs - ms) <= windowMs;
  }

  /**
   * Auto-enable:
   * tenta reaproveitar permissão já concedida e snapshot local
   * sem pedir prompt novo em background.
   */
  private async tryAutoEnableLocation(user: IUserDados | null): Promise<void> {
    if (!user?.uid) return;

    if (!this.readAlwaysAllow()) {
      this.log('auto-enable: alwaysAllow = false');
      return;
    }

    const state = await this.getPermissionStateSafe();
    this.log('auto-enable: permission state =', state);

    const canTrySilently = state === 'granted';

    if (canTrySilently) {
      try {
        await this.enableLocationInternal({ requireUserGesture: true, silent: true });

        if (this.userLocation) {
          this.errorNotificationService.showSuccess(
            'Localização reativada automaticamente.'
          );
          return;
        }
      } catch (err) {
        if (!(err instanceof GeolocationError) || err.code !== GeolocationErrorCode.USER_GESTURE_REQUIRED) {
          this.handleGeoError(err);
        }
      }
    }

    const last = this.readLastCoords();
    if (last) {
      this.userLocation = { latitude: last.lat, longitude: last.lng };
      this.policyMaxDistanceKm = this.policyMaxDistanceKm || 20;
      this.uiDistanceKm = this.uiDistanceKm ?? this.policyMaxDistanceKm;

      this.setupStreamsAfterLocation(user);
      this.dist$.next(this.uiDistanceKm);

      const when = new Date(last.ts).toLocaleString();
      this.errorNotificationService.showSuccess(
        `Usando sua última posição salva (${when}). Toque em “Atualizar minha posição” quando quiser.`
      );
      this.log('fallback LS → coords:', this.userLocation);
    } else {
      this.log('fallback LS → não há coords salvas');
    }
  }

  // ===========================================================================
  // Persistência leve local
  // ===========================================================================

  private persistLastCoords(pos: { latitude: number; longitude: number }): void {
    try {
      localStorage.setItem(this.LS_LAST_COORDS, JSON.stringify({
        lat: pos.latitude,
        lng: pos.longitude,
        ts: Date.now()
      }));
    } catch {}
  }

  private readLastCoords(): { lat: number; lng: number; ts: number } | null {
    try {
      const raw = localStorage.getItem(this.LS_LAST_COORDS);
      if (!raw) return null;

      const v = JSON.parse(raw);
      if (v && typeof v.lat === 'number' && typeof v.lng === 'number') {
        return v;
      }

      return null;
    } catch {
      return null;
    }
  }

  private readAlwaysAllow(): boolean {
    try {
      return localStorage.getItem(this.LS_ALWAYS_ALLOW) === 'true';
    } catch {
      return false;
    }
  }

  private async maybePersistAlwaysAllow(
    ctx: { requireUserGesture: boolean; silent: boolean }
  ): Promise<void> {
    if (ctx.silent) return;
    if (this.readAlwaysAllow()) return;

    const state = await this.getPermissionStateSafe();
    if (state !== 'granted') return;

    const ok = window.confirm(
      'Deseja manter sua localização ativada automaticamente neste navegador?'
    );

    try {
      localStorage.setItem(this.LS_ALWAYS_ALLOW, ok ? 'true' : 'false');
    } catch {}
  }

  private async getPermissionStateSafe(): Promise<PermissionState | null> {
    try {
      if (typeof navigator === 'undefined' || !('permissions' in navigator)) return null;
      const status = await (navigator as any).permissions.query({ name: 'geolocation' as any });
      return status?.state ?? null;
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Helpers visuais
  // ===========================================================================

  getRangeThumbPercent(v?: number | null): number {
    const min = 1;
    const max = this.policyMaxDistanceKm || 1;
    const val = Math.min(max, Math.max(min, v ?? max));
    return ((val - min) * 100) / (max - min || 1);
  }

  getRangeTrackBackground(v?: number | null): string {
    const p = this.getRangeThumbPercent(v);
    return `linear-gradient(to right, var(--primary-color) ${p}%, var(--range-track-color) ${p}%)`;
  }

  stepRange(delta: number): void {
    const min = 1;
    const max = this.policyMaxDistanceKm || 1;
    const next = Math.min(max, Math.max(min, (this.uiDistanceKm ?? max) + delta));
    this.uiDistanceKm = next;
    this.onDistanceChange(next);
  }

  // ===========================================================================
  // Tratamento centralizado de erro
  // ===========================================================================

  private handleGeoError(err: unknown): void {
    let msg = 'Falha ao obter a sua localização.';
    let isGestureOnly = false;

    if (err instanceof GeolocationError) {
      switch (err.code) {
        case GeolocationErrorCode.UNSUPPORTED:
          msg = 'Seu navegador não suporta geolocalização.';
          break;
        case GeolocationErrorCode.INSECURE_CONTEXT:
          msg = 'Ative HTTPS (ou use localhost) para permitir a geolocalização.';
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

    if (!isGestureOnly) {
      const e = err instanceof Error ? err : new Error(msg);
      (e as any).context = 'OnlineUsersComponent.handleGeoError';
      (e as any).original = err;
      (e as any).skipUserNotification = true;
      this.globalErrorHandlerService.handleError(e);
    }
  }
} // Linha 712