// src/app/dashboard/online-users/online-users.component.ts
import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { AsyncPipe, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Observable, of, firstValueFrom } from 'rxjs';
import { catchError, finalize, map, switchMap, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { GeolocationService, GeolocationError, GeolocationErrorCode } from 'src/app/core/services/geolocation/geolocation.service';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { Timestamp } from 'firebase/firestore';

import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';

type PermissionState = 'granted' | 'prompt' | 'denied';

@Component({
  selector: 'app-online-users',
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css'],
  standalone: true,
  imports: [CommonModule, AsyncPipe, FormsModule, UserCardComponent]
})
export class OnlineUsersComponent implements OnInit {
  /** Lista crua retornada do Firestore (sem filtragem por distância) */
  private rawUsers: IUserDados[] = [];

  /** Raio (km) controlado pelo slider — stream que recalcula a lista */
  private readonly dist$ = new BehaviorSubject<number | null>(null);

  /** Lista de usuários online filtrada/ordenada, reativa ao slider */
  onlineUsers$?: Observable<IUserDados[]>;

  /** Flag de carregamento geral (botão + spinner) */
  loading = false;

  /** Coordenadas do usuário (sempre coarse, por política) */
  userLocation: { latitude: number; longitude: number } | null = null;

  /** Valor atual do slider + limite imposto pela policy (role/verificação) */
  uiDistanceKm?: number;
  policyMaxDistanceKm = 20;

  private readonly destroyRef = inject(DestroyRef);

  // ————————————————————————————————————————————————————————————
  // Chaves de persistência no localStorage
  private readonly LS_ALWAYS_ALLOW = 'geo:alwaysAllow'; // "true" | "false"
  private readonly LS_LAST_COORDS = 'geo:lastCoords';   // JSON { lat, lng, ts }

  constructor(
    protected readonly authService: AuthService,
    private readonly geolocationService: GeolocationService,
    private readonly distanceService: DistanceCalculationService,
    private readonly errorNotificationService: ErrorNotificationService,
    private readonly globalErrorHandlerService: GlobalErrorHandlerService,
    private readonly firestoreQueryService: FirestoreQueryService
  ) { }

  // ————————————————————————————————————————————————————————————
  // Ciclo de vida

  ngOnInit(): void {
    // Auto-ativação opcional:
    // Se o usuário já marcou “sempre permitir” E a permissão do browser está "granted",
    // obtemos a posição automaticamente sem exigir um novo clique.
    this.tryAutoEnableLocation();
  }

  // ————————————————————————————————————————————————————————————
  // Fluxo principal

  /**
   * Handler do botão “Ativar localização”
   * 1) Busca o usuário logado
   * 2) Obtém posição (com gesto do usuário)
   * 3) Aplica política por role/verificação
   * 4) Persiste preferências/coords
   * 5) Carrega usuários online e arma o stream do slider
   */
  async enableLocation(): Promise<void> {
    await this.enableLocationInternal({ requireUserGesture: true, silent: false });
  }

  /**
   * Fluxo interno – permite executar tanto no clique quanto na auto-ativação.
   */
  private async enableLocationInternal(opts: { requireUserGesture: boolean; silent: boolean }): Promise<void> {
    if (this.loading) return;
    this.loading = true;

    try {
      // 1) Usuário logado
      const currentUser = await firstValueFrom(this.authService.user$.pipe(take(1)));
      if (!currentUser?.uid) throw new Error('[OnlineUsers] Usuário não encontrado.');

      // 2) Obtém posição (SDK já respeita gesto e HTTPS)
      const raw = await firstValueFrom(
        this.geolocationService.currentPosition$({ requireUserGesture: opts.requireUserGesture }).pipe(take(1))
      );
      // 3) Aplica política de privacidade por role/verificação
      const { coords: safe, policy } = this.geolocationService.applyRolePrivacy(
        raw, currentUser.role, !!currentUser.emailVerified
      );

      if (safe?.latitude == null || safe?.longitude == null) {
        throw new Error('[OnlineUsers] applyRolePrivacy retornou coords inválidas.');
      }

      this.userLocation = { latitude: safe.latitude, longitude: safe.longitude };
      this.policyMaxDistanceKm = policy?.maxDistanceKm ?? 20;
      this.uiDistanceKm = this.uiDistanceKm ?? this.policyMaxDistanceKm;

      // 4) Persiste preferências e último ponto
      this.persistLastCoords(this.userLocation);
      await this.maybePersistAlwaysAllow(opts);

      // 5) Carrega usuários online uma vez e arma o stream do slider
      const users = await this.getOnlineUsersOnce();
      this.rawUsers = users ?? [];

      this.onlineUsers$ = this.dist$.pipe(
        map(km =>
          this.processOnlineUsers(
            this.rawUsers,
            currentUser.uid,
            Math.min(km ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm)
          )
        )
      );

      // dispara cálculo inicial
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

  // ————————————————————————————————————————————————————————————
  // Auto-ativação respeitando a opção “sempre permitir”

  /**
   * Se o usuário marcou “sempre permitir” e o browser está com geolocation=granted,
   * reativa automaticamente ao abrir a tela.
   */
  private async tryAutoEnableLocation(): Promise<void> {
    if (!this.readAlwaysAllow()) return;
    const state = await this.getPermissionStateSafe();
    if (state === 'granted') {
      // Sem gesto do usuário; silencioso para não disparar toasts toda hora
      await this.enableLocationInternal({ requireUserGesture: false, silent: true });
    }
  }

  // ————————————————————————————————————————————————————————————
  // UI – slider de raio

  /** Chamado pelo (ngModelChange) do slider */
  onDistanceChange(v: number): void {
    const cap = Math.min(v ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm);
    this.dist$.next(cap);
  }

  // ————————————————————————————————————————————————————————————
  // Auxiliares de dados / ordenação

  /** Busca a lista de online uma única vez, aceitando Promise ou Observable. */
  private async getOnlineUsersOnce(): Promise<IUserDados[]> {
    const result: any = this.firestoreQueryService.getOnlineUsers();
    if (result?.then) {
      // Promise
      return await result;
    }
    if (result?.pipe) {
      // Observable
      return await firstValueFrom(result.pipe(take(1)));
    }
    return [];
  }

  /** Aplica filtro por distância e ordenação (role > foto > município > lastLogin desc) */
  private processOnlineUsers(users: IUserDados[], loggedUserUID: string, capKm: number): IUserDados[] {
    if (!this.userLocation) return [];

    return users
      .filter(u => u.latitude != null && u.longitude != null && u.uid !== loggedUserUID)
      .map(u => {
        const d = this.distanceService.calculateDistanceInKm(
          this.userLocation!.latitude, this.userLocation!.longitude,
          u.latitude!, u.longitude!
        );
        return { ...u, distanciaKm: d ?? undefined };
      })
      .filter(u => u.distanciaKm !== undefined && u.distanciaKm <= capKm)
      .sort((a, b) => this.compareUsers(a, b));
  }

  private compareUsers(a: IUserDados, b: IUserDados): number {
    // 1) role (vip > premium > basico > free)
    const rolePriority: Record<string, number> = { vip: 1, premium: 2, basico: 3, free: 4 };
    const ra = rolePriority[(a.role || 'free').toLowerCase()] ?? 4;
    const rb = rolePriority[(b.role || 'free').toLowerCase()] ?? 4;
    if (ra !== rb) return ra - rb;

    // 2) tem foto primeiro
    if (!a.photoURL && b.photoURL) return 1;
    if (a.photoURL && !b.photoURL) return -1;

    // 3) município (ordem alfabética)
    const m = (a.municipio?.toLowerCase() || '').localeCompare(b.municipio?.toLowerCase() || '');
    if (m !== 0) return m;

    // 4) lastLogin (mais recente primeiro)
    const aLast = a.lastLogin instanceof Timestamp ? a.lastLogin.toMillis() : 0;
    const bLast = b.lastLogin instanceof Timestamp ? b.lastLogin.toMillis() : 0;
    return bLast - aLast;
  }

  // ————————————————————————————————————————————————————————————
  // Persistência simples (localStorage)

  private persistLastCoords(pos: { latitude: number; longitude: number }): void {
    try {
      localStorage.setItem(this.LS_LAST_COORDS, JSON.stringify({ lat: pos.latitude, lng: pos.longitude, ts: Date.now() }));
    } catch { /* no-op */ }
  }

  private readAlwaysAllow(): boolean {
    try {
      return localStorage.getItem(this.LS_ALWAYS_ALLOW) === 'true';
    } catch {
      return false;
    }
  }

  private async maybePersistAlwaysAllow(ctx: { requireUserGesture: boolean; silent: boolean }): Promise<void> {
    // Só oferecemos/gravamos a opção quando veio de um clique (gesto do usuário)
    if (!ctx.requireUserGesture) return;

    // Se já está marcado, não perguntar de novo
    if (this.readAlwaysAllow()) return;

    // Se a permissão do navegador ainda é "prompt", não adianta marcar sempre permitir
    // pois a API não poderá ser usada sem novo gesto.
    const state = await this.getPermissionStateSafe();
    if (state !== 'granted') return;

    // Pergunta simples. Em produção, substitua por modal bonitinho.
    const ok = window.confirm('Deseja manter sua localização ativada automaticamente neste navegador?');
    try {
      localStorage.setItem(this.LS_ALWAYS_ALLOW, ok ? 'true' : 'false');
    } catch { /* no-op */ }
  }

  private async getPermissionStateSafe(): Promise<PermissionState | null> {
    try {
      if (typeof navigator === 'undefined' || !('permissions' in navigator)) return null;
      // TS: cast leve para evitar reclamação do tipo PermissionName
      const status = await (navigator as any).permissions.query({ name: 'geolocation' as any });
      return status?.state ?? null;
    } catch {
      return null;
    }
  }

  // ————————————————————————————————————————————————————————————
  // Tratamento de erros

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
      // Pode ter vindo do applyRolePrivacy / fluxo interno
      msg = err.message || msg;
    }
    this.errorNotificationService.showError(msg);
    this.globalErrorHandlerService.handleError(err as Error);
  }
}
