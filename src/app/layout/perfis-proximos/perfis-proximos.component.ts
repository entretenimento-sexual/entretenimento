// src/app/layout/perfis-proximos/perfis-proximos.component.ts
import { Component, ViewChild, DestroyRef, inject, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { geohashForLocation } from 'geofire-common';
import { AsyncPipe, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { GeolocationService, GeolocationError, GeolocationErrorCode } from 'src/app/core/services/geolocation/geolocation.service';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { take, switchMap, distinctUntilChanged, map, filter, tap, shareReplay } from 'rxjs/operators';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
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
import * as LocationActions from 'src/app/store/actions/actions.location/location.actions'; // 👈 namespace (named exports)
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
  @ViewChild(ModalMensagemComponent) modalMensagem!: ModalMensagemComponent;

  private readonly destroyRef = inject(DestroyRef);
  private readonly cache = inject(CacheService);

  // Signals locais: política / UX
  private readonly _userLocation = signal<GeoCoordinates | null>(null);
  readonly userLocation = computed(() => this._userLocation());

  private readonly _policyMaxDistanceKm = signal<number>(20);
  readonly policyMaxDistanceKm = computed(() => this._policyMaxDistanceKm());

  private readonly _uiDistanceKm =
    signal<number | undefined>(this.cache.getSync<number>('uiDistanceKm') ?? undefined);
  readonly uiDistanceKm = computed(() => this._uiDistanceKm() ?? this.policyMaxDistanceKm());

  private readonly _lastError = signal<string | null>(null);
  readonly lastError = computed(() => this._lastError());

  // DEPENDÊNCIAS
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

  // USER STREAM
  readonly user$ = this.currentUserStore.user$.pipe(
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );
  private readonly uid$ = this.currentUserStore.getLoggedUserUID$();

  // Mantém slider da UI alinhado ao store (searchParams.maxDistanceKm)
  private readonly syncUiWithStore$ = this.store.select(selectMaxDistanceKm).pipe(
    tap((v) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (this._uiDistanceKm() !== v) this._uiDistanceKm.set(v);
      }
    }),
    takeUntilDestroyed(this.destroyRef)
  ).subscribe();

  // Trigger manual (ex.: após ativar localização)
  private readonly reload$ = new BehaviorSubject<void>(undefined);

  // VM combinando Location + NearbyProfiles (por UID)
  readonly vm$ = combineLatest([this.uid$, this.reload$]).pipe(
    map(([uid]) => uid),
    filter((uid): uid is string => !!uid),
    switchMap(uid => this.store.select(selectLocationNearbyVMByUid(uid)).pipe(
      tap(vm => {
        // cache-first: só carrega se não estiver fresh
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
    )),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // Observables para o template
  readonly profiles$: Observable<IUserDados[]> = this.vm$.pipe(map(vm => vm.list));
  readonly nearbyLoading$ = this.vm$.pipe(map(vm => vm.loading));
  readonly nearbyError$ = this.vm$.pipe(map(vm => vm.error));
  readonly ttlLeftMs$ = this.vm$.pipe(map(vm => vm.ttlLeftMs));

  // Persistência leve do slider (TTL 15min)
  private readonly uiDistancePersistEffect = effect(() => {
    const v = this._uiDistanceKm();
    if (v && Number.isFinite(v)) this.cache.set('uiDistanceKm', v, 15 * 60 * 1000);
  });

  // AÇÕES DE UI
  async onEnableLocationClick(): Promise<void> {
    try {
      await this.authSession.whenReady();
      const user = await firstValueFrom(this.user$);
      if (!user?.uid) {
        this.errorNotificationService.showError('Você precisa estar autenticado para usar esta área.');
        return;
      }

      const precise = await this.geolocationService.getCurrentLocation({ requireUserGesture: true });
      const { coords: safeCoords, geohash, policy } = this.geolocationService.applyRolePrivacy(
        precise, user.role, !!user.emailVerified
      );

      // Atualiza UI local (cap)
      this._userLocation.set(safeCoords);
      this._policyMaxDistanceKm.set(policy.maxDistanceKm || 20);
      if (this._uiDistanceKm() == null) this._uiDistanceKm.set(this._policyMaxDistanceKm());

      // 🔁 Atualiza slice 'location' (usa suas actions reais)
      this.store.dispatch(LocationActions.updateCurrentLocation({
        latitude: safeCoords.latitude!, longitude: safeCoords.longitude!
      }));

      // Atualiza coarse location no perfil (best-effort)
      const finalHash = geohash ?? geohashForLocation([safeCoords.latitude!, safeCoords.longitude!]);
      if (navigator.onLine) {
        await this.userProfileService
          .updateUserLocation(user.uid, { ...safeCoords, geohash: finalHash }, finalHash)
          .catch(() => { });
      }

      // Recalcula VM → dispara load se precisar
      this.reload$.next();

    } catch (err) {
      this.handleGeoError(err);
    }
  }

  onDistanceChangeKm(next: number | string): void {
    const asNumber = Math.floor(Number(next) || 1);
    const capped = Math.min(Math.max(1, asNumber), this.policyMaxDistanceKm());

    // Atualiza UI local
    this._uiDistanceKm.set(capped);

    // 🔁 Atualiza no slice 'location' (nova action)
    this.store.dispatch(LocationActions.setMaxDistance({ maxDistanceKm: capped }));

    // Nova key → novo cache (ou hit de cache existente)
    this.reload$.next();
  }

  abrirModalMensagem(uid: string): void {
    this.profiles$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(list => {
      const perfilSelecionado = list.find(p => p.uid === uid);
      if (!perfilSelecionado) {
        this.errorNotificationService.showInfo('Perfil não encontrado.');
        return;
      }
      const dialogRef = this.dialog.open(ModalMensagemComponent, {
        width: 'min(480px, 92vw)',
        data: { profile: perfilSelecionado }
      });
      dialogRef.afterClosed().pipe(take(1)).subscribe(result => {
        if (result) this.router.navigate(['/chat', uid]);
      });
    });
  }

  trackByUid = (_: number, item: IUserDados) => item.uid;

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
    }
    this._lastError.set(msg);
    this.errorNotificationService.showError(msg);
    this.globalErrorHandlerService.handleError(err as Error);
  }
}
