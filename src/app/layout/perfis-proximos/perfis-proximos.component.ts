// src/app/layout/perfis-proximos/perfis-proximos.component.ts
// Objetivo:
// - exibir perfis próximos com base na localização
// - respeitar política de privacidade/raio conforme nível do usuário
// - manter UX sutil: só avisar sobre perfil mínimo quando o usuário clicar em "Ativar localização"
// - permitir que o usuário escolha entre finalizar cadastro ou continuar sem localização
//
// Observações desta versão:
// - o perfil mínimo continua sendo requisito apenas no momento da ativação da localização
// - não há banner permanente nem bloqueio seco por guard neste componente
// - o fluxo de redirecionamento usa /register/finalizar-cadastro com redirectTo
//
// Ajuste explícito desta revisão:
// - suprimi o @ViewChild modalMensagem e o import ViewChild, porque estavam sem uso real
//   no fluxo atual. A abertura do modal continua ocorrendo corretamente via MatDialog
//   + ModalMensagemComponent no método abrirModalMensagem().

import { Component, DestroyRef, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { geohashForLocation } from 'geofire-common';
import { AsyncPipe, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import {
  GeolocationService,
  GeolocationError,
  GeolocationErrorCode
} from 'src/app/core/services/geolocation/geolocation.service';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import {
  take,
  switchMap,
  distinctUntilChanged,
  map,
  filter,
  tap,
  shareReplay
} from 'rxjs/operators';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { MatDialog } from '@angular/material/dialog';
import { ModalMensagemComponent } from 'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component';
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';

// Auth infra
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';

// Cache leve de UI
import { CacheService } from 'src/app/core/services/general/cache/cache.service';

// NgRx
import { Store } from '@ngrx/store';
import { NearbyProfilesActions } from 'src/app/store/actions/actions.location/nearby-profiles.actions';
import * as LocationActions from 'src/app/store/actions/actions.location/location.actions';
import {
  selectLocationNearbyVMByUid,
  selectMaxDistanceKm
} from 'src/app/store/selectors/selectors.location/location.selectors';

@Component({
  selector: 'app-perfis-proximos',
  templateUrl: './perfis-proximos.component.html',
  styleUrls: ['./perfis-proximos.component.css', '../layout-profile-exibe.css'],
  standalone: true,
  imports: [CommonModule, AsyncPipe, FormsModule, UserCardComponent]
})
export class PerfisProximosComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cache = inject(CacheService);

  // ===========================================================================
  // Signals locais: estado de localização, política, UX e prompt contextual
  // ===========================================================================

  // Localização efetivamente usada pela UI
  private readonly _userLocation = signal<GeoCoordinates | null>(null);
  readonly userLocation = computed(() => this._userLocation());

  // Limite máximo de raio permitido pela policy atual
  private readonly _policyMaxDistanceKm = signal<number>(20);
  readonly policyMaxDistanceKm = computed(() => this._policyMaxDistanceKm());

  // Valor do slider controlado pela UI (persistido em cache leve)
  private readonly _uiDistanceKm =
    signal<number | undefined>(this.cache.getSync<number>('uiDistanceKm') ?? undefined);
  readonly uiDistanceKm = computed(() => this._uiDistanceKm() ?? this.policyMaxDistanceKm());

  // Último erro amigável de localização
  private readonly _lastError = signal<string | null>(null);
  readonly lastError = computed(() => this._lastError());

  // Prompt contextual exibido apenas quando o usuário clica para ativar localização
  // sem ter concluído o perfil mínimo
  private readonly _showProfileCompletionPrompt = signal(false);
  readonly showProfileCompletionPrompt = computed(() => this._showProfileCompletionPrompt());

  // ===========================================================================
  // Dependências
  // ===========================================================================

  private readonly geolocationService = inject(GeolocationService);
  private readonly userProfileService = inject(UserProfileService);
  private readonly errorNotificationService = inject(ErrorNotificationService);
  private readonly globalErrorHandlerService = inject(GlobalErrorHandlerService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly authSession = inject(AuthSessionService);
  private readonly accessControl = inject(AccessControlService);
  private readonly store = inject(Store);

  // ===========================================================================
  // Streams de usuário / auth
  // ===========================================================================

  readonly user$ = this.currentUserStore.user$.pipe(
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );

  private readonly uid$ = this.currentUserStore.getLoggedUserUID$();

  // ===========================================================================
  // Sincronização do slider com o slice de location
  // ===========================================================================

  private readonly syncUiWithStore$ = this.store.select(selectMaxDistanceKm).pipe(
    tap((v) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (this._uiDistanceKm() !== v) {
          this._uiDistanceKm.set(v);
        }
      }
    }),
    takeUntilDestroyed(this.destroyRef)
  ).subscribe();

  // Trigger manual para recalcular VM / disparar reload
  private readonly reload$ = new BehaviorSubject<void>(undefined);

  // ===========================================================================
  // VM combinando Location + NearbyProfiles por UID
  // ===========================================================================

  readonly vm$ = combineLatest([this.uid$, this.reload$]).pipe(
    map(([uid]) => uid),
    filter((uid): uid is string => !!uid),
    switchMap((uid) =>
      this.store.select(selectLocationNearbyVMByUid(uid)).pipe(
        tap((vm) => {
          // Cache-first:
          // só carrega do backend quando houver key/location e o cache não estiver fresh
          if (vm.key && vm.currentLocation && !vm.isFresh) {
            const params = {
              uid,
              lat: vm.currentLocation.latitude,
              lon: vm.currentLocation.longitude,
              radiusKm: vm.maxDistanceKm,
            };

            this.store.dispatch(NearbyProfilesActions.load({ params }));
          }
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // Observables consumidos pelo template
  readonly profiles$: Observable<IUserDados[]> = this.vm$.pipe(map((vm) => vm.list));
  readonly nearbyLoading$: Observable<boolean> = this.vm$.pipe(map((vm) => vm.loading));
  readonly nearbyError$: Observable<string | null> = this.vm$.pipe(map((vm) => vm.error));
  readonly ttlLeftMs$: Observable<number> = this.vm$.pipe(map((vm) => vm.ttlLeftMs));

  // Persistência leve do slider (TTL 15 min)
  private readonly uiDistancePersistEffect = effect(() => {
    const v = this._uiDistanceKm();
    if (v && Number.isFinite(v)) {
      this.cache.set('uiDistanceKm', v, 15 * 60 * 1000);
    }
  });

  // ===========================================================================
  // UX: navegação segura para finalizar cadastro
  // ===========================================================================

  /**
   * Normaliza a rota de retorno para evitar valores inválidos.
   * Mantém a experiência fluida: o usuário finaliza o cadastro e volta
   * para a área de perfis próximos.
   */
  private normalizeRedirectTarget(url: string | null | undefined): string {
    const clean = (url ?? '').trim();

    if (!clean) return '/perfis-proximos';
    if (!clean.startsWith('/') || clean.startsWith('//')) {
      return '/perfis-proximos';
    }

    return clean;
  }

  /**
   * Usuário optou por continuar na área sem ativar localização.
   * Apenas ocultamos o prompt contextual.
   */
  continueWithoutLocation(): void {
    this._showProfileCompletionPrompt.set(false);
  }

  /**
   * Usuário optou por concluir o perfil mínimo agora.
   * Redireciona para finalizar cadastro com redirectTo apontando
   * para a rota atual.
   */
  goToFinishMinimumProfile(): void {
    this._showProfileCompletionPrompt.set(false);

    const redirectTo = this.normalizeRedirectTarget(this.router.url);

    this.router.navigate(
      ['/register/finalizar-cadastro'],
      { queryParams: { redirectTo } }
    ).catch(() => {});
  }

  // ===========================================================================
  // Ações de UI
  // ===========================================================================

  /**
   * Clique explícito do usuário para ativar localização.
   *
   * Nova regra de UX:
   * - se o perfil mínimo não estiver concluído, não mostramos erro seco;
   *   exibimos um aviso contextual com escolha do usuário
   * - se o perfil estiver apto, seguimos com a ativação normal da localização
   */
  async onEnableLocationClick(): Promise<void> {
    try {
      await this.authSession.whenReady();

      const user = await firstValueFrom(this.user$.pipe(take(1)));
      if (!user?.uid) {
        this.errorNotificationService.showError(
          'Você precisa estar autenticado para usar esta área.'
        );
        return;
      }

      // Perfil mínimo = nickname + finalizar cadastro
      // Aqui usamos o gate já consolidado pela AccessControlService.
      const profileEligible = await firstValueFrom(
        this.accessControl.profileEligible$.pipe(take(1))
      );

      if (!profileEligible) {
        // Não tratamos como "erro": é uma orientação contextual.
        this._showProfileCompletionPrompt.set(true);
        return;
      }

      // Se o perfil já estiver apto, escondemos eventual prompt antigo.
      this._showProfileCompletionPrompt.set(false);

      const precise = await this.geolocationService.getCurrentLocation({
        requireUserGesture: true
      });

      const { coords: safeCoords, geohash, policy } =
        this.geolocationService.applyRolePrivacy(
          precise,
          user.role,
          !!user.emailVerified
        );

      // Atualiza signals locais de UX/policy
      this._userLocation.set(safeCoords);
      this._policyMaxDistanceKm.set(policy.maxDistanceKm || 20);

      if (this._uiDistanceKm() == null) {
        this._uiDistanceKm.set(this._policyMaxDistanceKm());
      }

      // Atualiza slice de location no store
      this.store.dispatch(
        LocationActions.updateCurrentLocation({
          latitude: safeCoords.latitude!,
          longitude: safeCoords.longitude!
        })
      );

      // Atualiza coarse location do perfil (best-effort)
      const finalHash =
        geohash ?? geohashForLocation([safeCoords.latitude!, safeCoords.longitude!]);

      if (navigator.onLine) {
        await this.userProfileService
          .updateUserLocation(
            user.uid,
            { ...safeCoords, geohash: finalHash },
            finalHash
          )
          .catch(() => {});
      }

      // Dispara recomputação da VM / load sob demanda
      this.reload$.next();

    } catch (err) {
      this.handleGeoError(err);
    }
  }

  /**
   * Alteração do raio pelo slider.
   * Sempre aplica cap pelo máximo permitido na policy.
   */
  onDistanceChangeKm(next: number | string): void {
    const asNumber = Math.floor(Number(next) || 1);
    const capped = Math.min(Math.max(1, asNumber), this.policyMaxDistanceKm());

    // Atualiza UI local
    this._uiDistanceKm.set(capped);

    // Atualiza no slice de location
    this.store.dispatch(
      LocationActions.setMaxDistance({ maxDistanceKm: capped })
    );

    // Nova key / novo cache / possível reload
    this.reload$.next();
  }

  /**
   * Abre modal de mensagem para o perfil selecionado.
   * Mantido como estava, apenas com comentários explicativos.
   */
  abrirModalMensagem(uid: string): void {
    this.profiles$
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((list) => {
        const perfilSelecionado = list.find((p) => p.uid === uid);

        if (!perfilSelecionado) {
          this.errorNotificationService.showInfo('Perfil não encontrado.');
          return;
        }

        const dialogRef = this.dialog.open(ModalMensagemComponent, {
          width: 'min(480px, 92vw)',
          data: { profile: perfilSelecionado }
        });

        dialogRef.afterClosed().pipe(take(1)).subscribe((result) => {
          if (result) {
            this.router.navigate(['/chat', uid]);
          }
        });
      });
  }

  trackByUid = (_: number, item: IUserDados) => item.uid;

  // ===========================================================================
  // Tratamento centralizado de erro de geolocalização
  // ===========================================================================

  private handleGeoError(err: unknown): void {
    let msg = 'Falha ao obter a sua localização.';

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
    }

    this._lastError.set(msg);
    this.errorNotificationService.showError(msg);
    this.globalErrorHandlerService.handleError(err as Error);
  }
} // Linha 411