// src/app/dashboard/online-users/online-users.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { BehaviorSubject, Observable, firstValueFrom, combineLatest, interval } from 'rxjs';
import { map, startWith, filter, take } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
// ⛳️ MIGRAÇÃO: usamos a store canônica do usuário (app-level) no lugar do antigo AuthService
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { GeolocationService, GeolocationError, GeolocationErrorCode } from 'src/app/core/services/geolocation/geolocation.service';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { Timestamp } from 'firebase/firestore';

// ✅ necessário pois o template usa <app-user-card>
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';

type PermissionState = 'granted' | 'prompt' | 'denied';

@Component({
  selector: 'app-online-users',
  standalone: true,
  imports: [CommonModule, AsyncPipe, FormsModule, UserCardComponent],
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css']
})
export class OnlineUsersComponent implements OnInit {
  // ============== Config de UX ==============
  /** Janela de “recentes” (ms) – quem não bateu heartbeat dentro desse tempo não aparece */
  private static readonly RECENT_WINDOW_MS = 2 * 60 * 1000; // 2 min

  /** Intervalo de atualização visual da lista (ms) – UI só re-renderiza nesse ritmo */
  private static readonly UI_REFRESH_MS = 15_000; // 15s

  // ============== Estado ==============
  /** Raio (km) reativo controlado pelo slider */
  private readonly dist$ = new BehaviorSubject<number | null>(null);

  /** Lista final exibida (já filtrada/ordenada) */
  onlineUsers$?: Observable<IUserDados[]>;

  /** Spinner do botão */
  loading = false;

  /** Coordenadas coarse do usuário (por política) */
  userLocation: { latitude: number; longitude: number } | null = null;

  /** Limites do slider */
  uiDistanceKm?: number;
  policyMaxDistanceKm = 20;

  // localStorage keys
  private readonly LS_ALWAYS_ALLOW = 'geo:alwaysAllow';
  private readonly LS_LAST_COORDS = 'geo:lastCoords';

  constructor(
    // ⛳️ MIGRAÇÃO: substitui AuthService por CurrentUserStoreService
    protected readonly currentUserStore: CurrentUserStoreService,
    private readonly geolocationService: GeolocationService,
    private readonly distanceService: DistanceCalculationService,
    private readonly errorNotificationService: ErrorNotificationService,
    private readonly globalErrorHandlerService: GlobalErrorHandlerService,
    private readonly firestoreQueryService: FirestoreQueryService
  ) { }

  // ============== Ciclo de vida ==============

  ngOnInit(): void {
      firstValueFrom(
        this.currentUserStore.user$.pipe(
          filter((u): u is IUserDados | null => u !== undefined), // 👈 remove undefined do fluxo
          take(1)
        )
        )
        .then(user => this.tryAutoEnableLocation(user))
              .catch(err => this.handleGeoError(err));
          }

  // ============== Fluxo principal ==============
  /** Botão “Ativar localização” */
  async enableLocation(): Promise<void> {
    await this.enableLocationInternal({ requireUserGesture: true, silent: false });
  }

  /**
   * Ativa a localização e arma o pipeline da lista:
   * - obtém usuário logado (via CurrentUserStoreService)
   * - pega posição (respeita gesto/HTTPS)
   * - aplica política (coarse + cap de raio)
   * - persiste preferências simples
   * - conecta stream reativa + “gate” de re-render a cada UI_REFRESH_MS
   */
  private async enableLocationInternal(opts: { requireUserGesture: boolean; silent: boolean }): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    try {
      // 1) Usuário logado (⛳️ MIGRAÇÃO: origem mudou)
      const currentUser = await firstValueFrom(
        this.currentUserStore.user$.pipe(
          filter((u): u is IUserDados => !!u?.uid),
          take(1)
        )
      );

      // 2) Posição atual (pode vir undefined — fazemos guard)
      const raw = await firstValueFrom(
        this.geolocationService.currentPosition$({ requireUserGesture: opts.requireUserGesture })
      );
      if (!raw) {
        throw new Error('[OnlineUsers] Posição não disponível (geolocalização retornou vazio).');
      }

      // 3) Política (coarse + cap de raio) – applyRolePrivacy espera GeoCoordinates
      const { coords: safe, policy } = this.geolocationService.applyRolePrivacy(
        raw,
        currentUser.role,
        !!currentUser.emailVerified
      );
      if (safe?.latitude == null || safe?.longitude == null) {
        throw new Error('[OnlineUsers] applyRolePrivacy retornou coords inválidas.');
      }

      this.userLocation = { latitude: safe.latitude, longitude: safe.longitude };
      this.policyMaxDistanceKm = policy?.maxDistanceKm ?? 20;
      this.uiDistanceKm = this.uiDistanceKm ?? this.policyMaxDistanceKm;

      // 4) Persistência simples
      this.persistLastCoords(this.userLocation);
      await this.maybePersistAlwaysAllow(opts);

      // 5) Streams
      //    Use isOnline==true (reativo). Se você tiver getRecentlyOnline$ (via lastSeen), pode usar aqui.
      const onlineRaw$ = this.firestoreQueryService.getOnlineUsers$();
      // const onlineRaw$ = this.firestoreQueryService.getRecentlyOnline$();

      // Emite imediato e a cada UI_REFRESH_MS (gate visual)
      const uiTick$ = interval(OnlineUsersComponent.UI_REFRESH_MS).pipe(startWith(0));

      // Slider: valor inicial + mudanças
      const km$ = this.dist$.pipe(startWith(this.uiDistanceKm ?? this.policyMaxDistanceKm));

      // Re-render **somente** no tick ou quando o slider muda.
      this.onlineUsers$ = combineLatest([km$, uiTick$, onlineRaw$]).pipe(
        map(([km, _tick, users]) =>
          this.processOnlineUsers(
            users,
            currentUser.uid,
            Math.min(km ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm)
          )
        )
      );

      // dispara cálculo inicial de raio
      this.dist$.next(this.uiDistanceKm!);

      if (!opts.silent) {
        this.errorNotificationService.showSuccess('Localização ativada e usuários carregados.');
      }
    } catch (err) {
      this.handleGeoError(err);
    } finally {
      this.loading = false;
    }
  }

  // ============== Slider ==============
  onDistanceChange(v: number): void {
    const cap = Math.min(v ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm);
    this.dist$.next(cap);
  }

  // ============== Processamento ==============
  /**
   * Filtra “recentes”, aplica distância e ordena estável:
   * role > tem foto > município (asc) > lastLogin (desc)
   */
  private processOnlineUsers(users: IUserDados[], loggedUID: string, capKm: number): IUserDados[] {
    if (!this.userLocation) return [];

    const now = Date.now();
    const recentMs = OnlineUsersComponent.RECENT_WINDOW_MS;

    return (users || [])
      // 0) só “recentes” (mitiga perfis presos como online)
      .filter(u => this.isRecent((u as any)?.lastSeen, now, recentMs))
      // 1) precisa ter coords e não ser o próprio usuário
      .filter(u => u.latitude != null && u.longitude != null && u.uid !== loggedUID)
      // 2) calcula distância
      .map(u => {
        const d = this.distanceService.calculateDistanceInKm(
          this.userLocation!.latitude, this.userLocation!.longitude,
          u.latitude!, u.longitude!
        );
        return { ...u, distanciaKm: d ?? undefined } as IUserDados & { distanciaKm?: number };
      })
      // 3) aplica raio
      .filter(u => (u as any).distanciaKm !== undefined && (u as any).distanciaKm! <= capKm)
      // 4) ordenação estável (evita flicker)
      .sort((a, b) => this.compareUsersStable(a, b));
  }

  private compareUsersStable(a: IUserDados, b: IUserDados): number {
    const rolePriority: Record<string, number> = { vip: 1, premium: 2, basico: 3, free: 4 };
    const ra = rolePriority[(a.role || 'free').toLowerCase()] ?? 4;
    const rb = rolePriority[(b.role || 'free').toLowerCase()] ?? 4;
    if (ra !== rb) return ra - rb;

    if (!a.photoURL && b.photoURL) return 1;
    if (a.photoURL && !b.photoURL) return -1;

    const m = (a.municipio?.toLowerCase() || '').localeCompare(b.municipio?.toLowerCase() || '');
    if (m !== 0) return m;

    const aLast = a.lastLogin instanceof Timestamp ? a.lastLogin.toMillis() : 0;
    const bLast = b.lastLogin instanceof Timestamp ? b.lastLogin.toMillis() : 0;
    return bLast - aLast;
  }

  /** Confere se lastSeen está dentro da janela “recentes” */
  private isRecent(lastSeen: unknown, nowMs: number, windowMs: number): boolean {
    let ms = 0;
    if (lastSeen instanceof Timestamp) ms = lastSeen.toMillis();
    else if (lastSeen && typeof lastSeen === 'object' && 'seconds' in (lastSeen as any)) {
      ms = ((lastSeen as any).seconds || 0) * 1000;
    } else if (typeof lastSeen === 'number') {
      ms = lastSeen;
    }
    return ms > 0 && (nowMs - ms) <= windowMs;
  }

  // ============== Auto-ativação ==============
  /**
   * Auto-ativa somente se:
   *  - houver usuário (uid válido)
   *  - a preferência local (LS_ALWAYS_ALLOW) estiver ligada
   *  - permissão do navegador estiver "granted"
   */
  private async tryAutoEnableLocation(user: IUserDados | null): Promise<void> {
    if (!user?.uid) return;                      // precisa de usuário
    if (!this.readAlwaysAllow()) return;         // precisa da preferência local marcada
    const state = await this.getPermissionStateSafe();
    if (state === 'granted') {
      await this.enableLocationInternal({ requireUserGesture: false, silent: true });
    }
  }

  // ============== Persistência simples ==============
  private persistLastCoords(pos: { latitude: number; longitude: number }): void {
    try {
      localStorage.setItem(this.LS_LAST_COORDS, JSON.stringify({ lat: pos.latitude, lng: pos.longitude, ts: Date.now() }));
    } catch { /* no-op */ }
  }

  private readAlwaysAllow(): boolean {
    try { return localStorage.getItem(this.LS_ALWAYS_ALLOW) === 'true'; } catch { return false; }
  }

  private async maybePersistAlwaysAllow(ctx: { requireUserGesture: boolean; silent: boolean }): Promise<void> {
    if (!ctx.requireUserGesture) return;
    if (this.readAlwaysAllow()) return;
    const state = await this.getPermissionStateSafe();
    if (state !== 'granted') return;

    const ok = window.confirm('Deseja manter sua localização ativada automaticamente neste navegador?');
    try { localStorage.setItem(this.LS_ALWAYS_ALLOW, ok ? 'true' : 'false'); } catch { /* no-op */ }
  }

  private async getPermissionStateSafe(): Promise<PermissionState | null> {
    try {
      if (typeof navigator === 'undefined' || !('permissions' in navigator)) return null;
      const status = await (navigator as any).permissions.query({ name: 'geolocation' as any });
      return status?.state ?? null;
    } catch { return null; }
  }

  // ============== Erros ==============
  private handleGeoError(err: unknown): void {
    let msg = 'Falha ao obter a sua localização.';
    if (err instanceof GeolocationError) {
      switch (err.code) {
        case GeolocationErrorCode.UNSUPPORTED: msg = 'Seu navegador não suporta geolocalização.'; break;
        case GeolocationErrorCode.INSECURE_CONTEXT: msg = 'Ative HTTPS (ou use localhost) para permitir a geolocalização.'; break;
        case GeolocationErrorCode.PERMISSION_DENIED: msg = 'Permissão de localização negada.'; break;
        case GeolocationErrorCode.USER_GESTURE_REQUIRED: msg = 'Clique em “Ativar localização” para continuar.'; break;
        case GeolocationErrorCode.POSITION_UNAVAILABLE: msg = 'Posição atual indisponível.'; break;
        case GeolocationErrorCode.TIMEOUT: msg = 'Tempo esgotado ao tentar localizar você.'; break;
        default: msg = 'Ocorreu um erro desconhecido ao obter localização.';
      }
    } else if (err instanceof Error) {
      msg = err.message || msg;
    }
    this.errorNotificationService.showError(msg);
    this.globalErrorHandlerService.handleError(err as Error);
  }
}
