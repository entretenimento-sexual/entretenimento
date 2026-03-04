// src/app/dashboard/online-users/online-users.component.ts
// Componente para exibir usuários online próximos com base na localização
// Não esquecer os comentários explicativos e de debug
import { Component, DestroyRef, OnInit, inject, input } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { BehaviorSubject, Observable, firstValueFrom, combineLatest, interval, of, EMPTY, defer, from } from 'rxjs';
import { map, startWith, filter, take, distinctUntilChanged, shareReplay, catchError, tap, switchMap } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { GeolocationService, GeolocationError, GeolocationErrorCode } from 'src/app/core/services/geolocation/geolocation.service';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';
import { AppState } from 'src/app/store/states/app.state';
import { Store } from '@ngrx/store';
import { selectCurrentUser, selectCurrentUserStatus } from 'src/app/store/selectors/selectors.user/user.selectors';
import { selectGlobalOnlineUsers } from 'src/app/store/selectors/selectors.user/online.selectors';
import { toEpochOrZero } from 'src/app/core/utils/epoch-utils';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';

type PermissionState = 'granted' | 'prompt' | 'denied';
type IUserWithDistance = IUserDados & { distanciaKm?: number };

/** shallow compare estável para memorizar usuário atual */
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
  /** Fonte primária do usuário (via input). Store é fallback. */
  currentUser = input<IUserDados | null | undefined>(undefined);

  // ================= Config/UX =================
  private static readonly RECENT_WINDOW_MS = 2 * 60 * 1000; // 2 min
  private static readonly UI_REFRESH_MS = 15_000;           // 15s

  // ================= Debug =================
  private readonly DEBUG = true;
  private log(...args: unknown[]) { if (this.DEBUG) console.log('[OnlineUsers]', ...args); }

  // ================= Estado =================
  private readonly dist$ = new BehaviorSubject<number | null>(null); // raio (km)
  onlineUsers$?: Observable<IUserWithDistance[]>;
  count$!: Observable<number>; // opcional: Perfis Online ({{ count$ | async }})

  loading = false;
  userLocation: { latitude: number; longitude: number } | null = null;
  uiDistanceKm?: number;
  policyMaxDistanceKm = 20;

  private readonly onlineRaw$ = this.store.select(selectGlobalOnlineUsers).pipe(
    map((users) => Array.isArray(users) ? (users as IUserDados[]) : []),
    distinctUntilChanged((a, b) => a === b), // cheap ref check (NgRx geralmente preserva ref quando não muda)
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly LS_ALWAYS_ALLOW = 'geo:alwaysAllow';
  private readonly LS_LAST_COORDS = 'geo:lastCoords';
  readonly currentUserStatus$ = this.store.select(selectCurrentUserStatus);
  readonly currentUserResolved$!: Observable<IUserDados | null>;
  private readonly currentUserFromStore$ = this.store.select(selectCurrentUser).pipe(startWith(undefined as any));
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly geolocationService: GeolocationService,
    private readonly distanceService: DistanceCalculationService,
    private readonly errorNotificationService: ErrorNotificationService,
    private readonly globalErrorHandlerService: GlobalErrorHandlerService,
    private readonly geoTracking: GeolocationTrackingService,
    private readonly store: Store<AppState>,
    private readonly access: AccessControlService,
  ) {
    // Unifica Input + Store (fallback)
    this.currentUserResolved$ = combineLatest([
      toObservable(this.currentUser),
      this.currentUserFromStore$,
    ]).pipe(
      map(([fromInput, fromStore]) => (fromInput !== undefined ? fromInput : fromStore)),
      filter((u): u is IUserDados | null => u !== undefined),
      distinctUntilChanged((a, b) => shallowUserEqual(a, b)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.gate$ = combineLatest([
      this.canRunOnlineUsers$,
      this.authUid$,
      this.currentUserResolved$,
    ]).pipe(
      map(([can, uid, user]) => {
        const userUid = (user as any)?.uid ? String((user as any).uid).trim() : null;

        const canStart = can === true && !!uid && !!userUid && userUid === uid;

        return { canStart, uid, user: canStart ? (user as IUserDados) : null };
      }),
      distinctUntilChanged((a, b) => a.canStart === b.canStart && a.uid === b.uid),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.destroyRef.onDestroy(() => {
      this.geoTracking.stopTracking();
    });
  }

  // evita auto-enable repetido por uid (spam de toast / re-run)
  private autoEnableUid: string | null = null;

  private readonly authUid$ = this.access.authUid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly canRunOnlineUsers$ = this.access.canRunOnlineUsers$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly gate$: Observable<{ canStart: boolean; uid: string | null; user: IUserDados | null }>;

  ngOnInit(): void {
    this.gate$
      .pipe(
        tap((g) => this.log('gate', { canStart: g.canStart, uid: g.uid })),

        switchMap((g) => {
          // ✅ Gate caiu: STOP determinístico
          if (!g.canStart || !g.uid || !g.user) {
            this.autoEnableUid = null;
            this.geoTracking.stopTracking();

            // opcional: limpar UI/streams para não “parecer” ativo
            this.userLocation = null;
            this.uiDistanceKm = undefined;
            this.policyMaxDistanceKm = 20;
            this.dist$.next(null);

            this.onlineUsers$ = of([] as IUserWithDistance[]);
            this.count$ = of(0);

            return EMPTY;
          }

          // ✅ evita re-run por mesmo uid
          if (this.autoEnableUid === g.uid) return EMPTY;
          this.autoEnableUid = g.uid;

          // ✅ auto-enable (sem prompt) agora respeita policy
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

  // ================= Ações =================

  /**
   * Clique do usuário: queremos que o browser mostre o prompt.
   * Por isso passamos `requireUserGesture: false` aqui — assim o `preflight`
   * não barra antes do prompt nativo.
   */
  async enableLocation(): Promise<void> {
    const [can, emailOk, profileOk] = await firstValueFrom(
      combineLatest([
        this.access.canRunOnlineUsers$,
        this.access.emailVerified$,
        this.access.profileEligible$,
      ]).pipe(take(1))
    );

    if (!can) {
      if (!emailOk) {
        this.errorNotificationService.showError('Verifique seu e-mail para usar usuários online.');
        return;
      }
      if (!profileOk) {
        this.errorNotificationService.showError('Complete seu perfil (gênero/estado/município) para usar usuários online.');
        return;
      }
      this.errorNotificationService.showError('Acesso a usuários online indisponível no momento.');
      return;
    }

    await this.enableLocationInternal({ requireUserGesture: false, silent: false });
  }

  /**
   * Fluxo interno de ativação. Em modo `silent` ignoramos USER_GESTURE_REQUIRED.
   */
  private async enableLocationInternal(opts: { requireUserGesture: boolean; silent: boolean }): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    try {
      const currentUser = await firstValueFrom(
        this.currentUserResolved$.pipe(filter((u): u is IUserDados => !!u?.uid), take(1))
      );
      this.log('enableLocationInternal → user:', currentUser.uid);

      // ⬇️ 2.1) Snapshot recente (até 3 min) para montar a UI já
      const snap = this.geoTracking.getLastSnapshot(3 * 60 * 1000);
      let hadSnapshot = false;
      if (snap?.latitude != null && snap?.longitude != null) {
        this.userLocation = { latitude: snap.latitude, longitude: snap.longitude };
        this.policyMaxDistanceKm = this.policyMaxDistanceKm || 20;
        this.uiDistanceKm = this.uiDistanceKm ?? this.policyMaxDistanceKm;
        this.setupStreamsAfterLocation(currentUser);
        this.dist$.next(this.uiDistanceKm!);
        hadSnapshot = true;
        this.log('Usando snapshot local enquanto refinamos a posição...');
      }

      // ⬇️ 2.2) Tenta obter posição atual com parâmetros mais “perdoados”
      // maximumAge > 0 permite o navegador devolver fix recente (reduz TIMEOUT)
      const raw = await firstValueFrom(
        this.geolocationService.currentPosition$({
          requireUserGesture: opts.requireUserGesture,
          enableHighAccuracy: false,
          maximumAge: 300_000,   // 5 min
          timeout: 20_000        // 20s
        })
      );

      // sucesso → aplica política e atualiza UI
      const { coords: safe, policy } = this.geolocationService.applyRolePrivacy(
        raw, currentUser.role, !!currentUser.emailVerified
      );
      this.userLocation = { latitude: safe.latitude, longitude: safe.longitude };
      this.policyMaxDistanceKm = policy?.maxDistanceKm ?? 20;
      this.uiDistanceKm = this.uiDistanceKm ?? this.policyMaxDistanceKm;

      // se viemos só com snapshot antes, agora os streams já estão montados;
      // o próximo tick recalcula distâncias com a posição “refinada”.
      if (!hadSnapshot) {
        this.setupStreamsAfterLocation(currentUser);
        this.dist$.next(this.uiDistanceKm!);
      }

      this.persistLastCoords(this.userLocation);

      // ⬇️ inicie o watch para manter a posição fresca sem novos prompts
      this.geoTracking.startTracking(currentUser.uid);

      await this.maybePersistAlwaysAllow(opts);

      if (!opts.silent) {
        this.errorNotificationService.showSuccess('Localização ativada e usuários carregados.');
      }
    } catch (err) {
      // Se deu TIMEOUT mas a UI já está em pé via snapshot, só avise leve e não “quebre”
      if (err instanceof GeolocationError && err.code === GeolocationErrorCode.TIMEOUT) {
        if (this.userLocation) {
          this.log('Timeout ao refinar posição; mantendo snapshot.');
          this.errorNotificationService.showInfo('Não foi possível atualizar sua posição agora; usando a última conhecida.');
          this.loading = false;
          return;
        }
      }
      // Demais casos seguem para o handler padrão
      this.handleGeoError(err);
    } finally {
      this.loading = false;
    }
  }

  /** Após termos posição do usuário, montamos os streams de listagem/contagem. */
  private setupStreamsAfterLocation(currentUser: IUserDados): void {
    const uiTick$ = interval(OnlineUsersComponent.UI_REFRESH_MS).pipe(startWith(0));
    const km$ = this.dist$.pipe(startWith(this.uiDistanceKm ?? this.policyMaxDistanceKm));

    this.onlineUsers$ = combineLatest([km$, uiTick$, this.onlineRaw$]).pipe(
      map(([km, _tick, users]) => {
        const cap = Math.min(km ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm);

        const filteredByPrefs = this.applyUserPreferences(users, currentUser);
        const processed = this.processOnlineUsers(filteredByPrefs, currentUser.uid, cap);

        return processed;
      }),
      catchError(err => {
        this.handleGeoError(err);
        return of([] as IUserWithDistance[]);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.count$ = this.onlineUsers$.pipe(map(list => list.length), startWith(0));
  }

  // ================= Slider =================
  onDistanceChange(v: number): void {
    const cap = Math.min(v ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm);
    this.log('raio alterado:', v, '→ cap:', cap);
    this.dist$.next(cap);
  }

  // ================= Preferências (no-op por enquanto) =================
  private applyUserPreferences(users: IUserDados[], _currentUser: IUserDados): IUserDados[] {
    // TODO: aplicar filtros conforme preferências do currentUser (idade, gênero, etc.)
    return users;
  }

  // ================= Processamento =================
  private processOnlineUsers(users: IUserDados[], loggedUID: string, capKm: number): IUserWithDistance[] {
    if (!this.userLocation) return [];

    const now = Date.now();
    const recentMs = OnlineUsersComponent.RECENT_WINDOW_MS;

    return (users || [])
      // 0) “recentes”
      .filter(u => (u as any)?.isOnline === true || this.isRecent((u as any)?.lastSeen, now, recentMs))
      // 1) precisa ter coords e não ser o próprio usuário
      .filter(u => u.latitude != null && u.longitude != null && u.uid !== loggedUID)
      // 2) distância (pode ficar undefined se faltar coords válidas)
      .map(u => {
        if (u.latitude == null || u.longitude == null || !this.userLocation) {
          return { ...u, distanciaKm: undefined as number | undefined };
        }
        const d = this.distanceService.calculateDistanceInKm(
          this.userLocation.latitude, this.userLocation.longitude,
          u.latitude!, u.longitude!
        );
        return { ...u, distanciaKm: d ?? undefined };
      })
      // 3) filtra pelo raio apenas quem tem distância calculada
      .filter(u => u.uid !== loggedUID && (u.distanciaKm == null || u.distanciaKm <= capKm))
      // 4) ordenação estável
      .sort((a, b) => this.compareUsersStable(a, b));
  }

  private compareUsersStable(a: IUserDados, b: IUserDados): number {
    const rolePriority: Record<string, number> = { vip: 1, premium: 2, basic: 3, free: 4 };
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

  // ================= Auto-ativação =================

  /**
   * Reativa silenciosamente se:
   *  - usuário marcou "sempre permitir" (LS)
   *  - permissão atual é "granted" (ou Permissions API indisponível → null)
   * Se falhar por USER_GESTURE_REQUIRED (não granted), silencia e cai no fallback.
   */
  private async tryAutoEnableLocation(user: IUserDados | null): Promise<void> {
    if (!user?.uid) return;
    if (!this.readAlwaysAllow()) { this.log('auto-enable: alwaysAllow = false'); return; }

    const state = await this.getPermissionStateSafe();
    this.log('auto-enable: permission state =', state);

    const canTrySilently = (state === 'granted');
    if (canTrySilently) {
      try {
        // 🚫 Sem abrir prompt: travamos no service se não estiver "granted"
        await this.enableLocationInternal({ requireUserGesture: true, silent: true });

        // Só sinaliza sucesso se realmente obteve coords
        if (this.userLocation) {
          this.errorNotificationService.showSuccess('Localização reativada automaticamente.');
          return;
        }
      } catch (err) {
        if (!(err instanceof GeolocationError) || err.code !== GeolocationErrorCode.USER_GESTURE_REQUIRED) {
          this.handleGeoError(err);
        }
      }
    }

    // 🔁 Fallback: últimas coords salvas no navegador
    const last = this.readLastCoords();
    if (last) {
      this.userLocation = { latitude: last.lat, longitude: last.lng };
      this.policyMaxDistanceKm = this.policyMaxDistanceKm || 20;
      this.uiDistanceKm = this.uiDistanceKm ?? this.policyMaxDistanceKm;

      this.setupStreamsAfterLocation(user);
      this.dist$.next(this.uiDistanceKm!);

      const when = new Date(last.ts).toLocaleString();
      this.errorNotificationService.showSuccess(`Usando sua última posição salva (${when}). Toque em “Atualizar minha posição” quando quiser.`);
      this.log('fallback LS → coords:', this.userLocation);
    } else {
      this.log('fallback LS → não há coords salvas');
    }
  }

  // ================= Persistência simples (LS) =================
  private persistLastCoords(pos: { latitude: number; longitude: number }): void {
    try {
      localStorage.setItem(this.LS_LAST_COORDS, JSON.stringify({ lat: pos.latitude, lng: pos.longitude, ts: Date.now() }));
      this.log('LS: lastCoords salvo.');
    } catch { /* no-op */ }
  }

  private readLastCoords(): { lat: number; lng: number; ts: number } | null {
    try {
      const raw = localStorage.getItem(this.LS_LAST_COORDS);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (v && typeof v.lat === 'number' && typeof v.lng === 'number') return v;
      return null;
    } catch { return null; }
  }

  private readAlwaysAllow(): boolean {
    try { return localStorage.getItem(this.LS_ALWAYS_ALLOW) === 'true'; } catch { return false; }
  }

  private async maybePersistAlwaysAllow(ctx: { requireUserGesture: boolean; silent: boolean }): Promise<void> {
    // Só pergunta quando NÃO for silencioso (ou seja, veio de um clique)
    if (ctx.silent) return;
    if (this.readAlwaysAllow()) return;

    const state = await this.getPermissionStateSafe();
    if (state !== 'granted') return;

    const ok = window.confirm('Deseja manter sua localização ativada automaticamente neste navegador?');
    try {
      localStorage.setItem(this.LS_ALWAYS_ALLOW, ok ? 'true' : 'false');
      this.log('LS: alwaysAllow =', ok);
    } catch { /* no-op */ }
  }

  private async getPermissionStateSafe(): Promise<PermissionState | null> {
    try {
      if (typeof navigator === 'undefined' || !('permissions' in navigator)) return null;
      const status = await (navigator as any).permissions.query({ name: 'geolocation' as any });
      return status?.state ?? null;
    } catch { return null; }
  }

  // ================= UI helpers (slider) =================
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

  // ================= Erros / Feedback =================
  /**
   * Mostra mensagem amigável. Importante:
   *  - USER_GESTURE_REQUIRED: mostramos toast, mas NÃO enviamos ao GlobalErrorHandler.
   *  - Demais erros: mostram toast e são encaminhados ao GlobalErrorHandler.
   */
  private handleGeoError(err: unknown): void {
    let msg = 'Falha ao obter a sua localização.';
    let isGestureOnly = false;

    if (err instanceof GeolocationError) {
      switch (err.code) {
        case GeolocationErrorCode.UNSUPPORTED:
          msg = 'Seu navegador não suporta geolocalização.'; break;
        case GeolocationErrorCode.INSECURE_CONTEXT:
          msg = 'Ative HTTPS (ou use localhost) para permitir a geolocalização.'; break;
        case GeolocationErrorCode.PERMISSION_DENIED:
          msg = 'Permissão de localização negada.'; break;
        case GeolocationErrorCode.USER_GESTURE_REQUIRED:
          msg = 'Clique em “Ativar localização” para continuar.';
          isGestureOnly = true;
          break;
        case GeolocationErrorCode.POSITION_UNAVAILABLE:
          msg = 'Posição atual indisponível.'; break;
        case GeolocationErrorCode.TIMEOUT:
          msg = 'Tempo esgotado ao tentar localizar você.'; break;
        default:
          msg = 'Ocorreu um erro desconhecido ao obter localização.';
      }
    } else if (err instanceof Error) {
      msg = err.message || msg;
    }

    // 1) UI primeiro (fonte única de UX aqui)
    this.errorNotificationService.showError(msg);

    // 2) Observabilidade (sem duplicar toast)
    if (!isGestureOnly) {
      const e = err instanceof Error ? err : new Error(msg);

      (e as any).context = 'OnlineUsersComponent.handleGeoError';
      (e as any).original = err;

      // ✅ evita toast duplicado no GlobalErrorHandler
      (e as any).skipUserNotification = true;

      this.globalErrorHandlerService.handleError(e);
    }
  }
} //Linha 547, fim do OnlineUsersComponent
// observar se todos os métodos aqui deveriam estar aqui, se não é o caso verificar redistribuição
// para aquivo mais especializado e evitar que o componente fique inchado demais (Single Responsibility Principle),
// E se for compensatório criar aquivos especializados e chamá-los aqui, para manter a organização e legibilidade do código.
