// src/app/layout/perfis-proximos/perfis-proximos.component.ts
import { Component, OnInit, ViewChild, input, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { geohashForLocation } from 'geofire-common';
import { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { GeolocationService, GeolocationError, GeolocationErrorCode } from 'src/app/core/services/geolocation/geolocation.service';
import { NearbyProfilesService } from 'src/app/core/services/geolocation/near-profile.service';
import { MatDialog } from '@angular/material/dialog';
import { ModalMensagemComponent } from 'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';
import { AsyncPipe, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-perfis-proximos',
  templateUrl: './perfis-proximos.component.html',
  styleUrls: ['./perfis-proximos.component.css', '../layout-profile-exibe.css'],
  standalone: true,
  imports: [CommonModule, AsyncPipe, FormsModule, UserCardComponent]
})
export class PerfisProximosComponent implements OnInit {
  @ViewChild(ModalMensagemComponent) modalMensagem!: ModalMensagemComponent;

  userLocation: GeoCoordinates | null = null;
  profiles: IUserDados[] = [];

  // Slider de raio (UI) + limite imposto pela policy do role/verificação
  uiDistanceKm?: number;
  policyMaxDistanceKm = 20;

  readonly user = input.required<IUserDados | null>();
  readonly distanciaKm = input.required<number | null>();

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly geolocationService: GeolocationService,
    // ⚠️ precisa ser visível ao template
    protected readonly authService: AuthService,
    private readonly nearbyProfilesService: NearbyProfilesService,
    private readonly router: Router,
    private readonly dialog: MatDialog,
    private readonly userProfileService: UserProfileService,
    private readonly errorNotificationService: ErrorNotificationService,
    private readonly globalErrorHandlerService: GlobalErrorHandlerService
  ) { }

  ngOnInit(): void {
    // Nada de geolocalização aqui – só após gesto do usuário.
  }

  /** Chamado pelo botão no template */
  onEnableLocationClick(): void {
    this.authService.user$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: async (user) => {
        if (!user?.uid) {
          this.errorNotificationService.showError('Usuário não autenticado.');
          return;
        }
        try {
          const precise = await this.geolocationService.getCurrentLocation({ requireUserGesture: true });
          const { coords: safeCoords, geohash, policy } = this.geolocationService.applyRolePrivacy(
            precise,
            user.role,
            !!user.emailVerified
          );

          this.userLocation = safeCoords;

          // Limite + valor inicial do slider
          this.policyMaxDistanceKm = policy.maxDistanceKm || 20;
          this.uiDistanceKm ??= this.policyMaxDistanceKm;

          // Carrega perfis respeitando o slider (capado pelo limite)
          await this.loadProfilesNearUserLocation(user.uid);

          // Atualiza localização (coarse)
          const finalHash = geohash ?? geohashForLocation([safeCoords.latitude!, safeCoords.longitude!]);
          await this.userProfileService.updateUserLocation(user.uid, { ...safeCoords, geohash: finalHash }, finalHash);
        } catch (err) {
          this.handleGeoError(err);
        }
      },
      error: (err) => this.handleGeoError(err)
    });
  }

  private async loadProfilesNearUserLocation(uid: string): Promise<void> {
    try {
      if (!this.userLocation) {
        this.errorNotificationService.showInfo('Localização não disponível.');
        return;
      }
      const { latitude, longitude } = this.userLocation;
      const capKm = Math.min(this.uiDistanceKm ?? this.policyMaxDistanceKm, this.policyMaxDistanceKm);

      this.profiles = await this.nearbyProfilesService.getProfilesNearLocation(
        latitude!, longitude!, capKm, uid
      );
    } catch (error) {
      this.errorNotificationService.showError('Erro ao carregar perfis próximos.');
      this.globalErrorHandlerService.handleError(error as Error);
    }
  }

  abrirModalMensagem(uid: string): void {
    const perfilSelecionado = this.profiles.find(p => p.uid === uid);
    if (!perfilSelecionado) {
      this.errorNotificationService.showInfo('Perfil não encontrado.');
      return;
    }
    const dialogRef = this.dialog.open(ModalMensagemComponent, {
      width: '22%',
      minWidth: 300,
      data: { profile: perfilSelecionado }
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result) this.router.navigate(['/chat', uid]);
    });
  }

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
    this.errorNotificationService.showError(msg);
    this.globalErrorHandlerService.handleError(err as Error);
  }
}
