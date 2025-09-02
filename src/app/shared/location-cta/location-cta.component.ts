// src/app/shared/location-cta/location-cta.component.ts
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import {  GeolocationService,
          GeolocationError,
          GeolocationErrorCode,
          UserRole } from 'src/app/core/services/geolocation/geolocation.service';

import { LocationPersistenceService } from 'src/app/core/services/geolocation/location-persistence.service';
import { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';

// 👉 tipo local para o estado de permissão
type PermState = PermissionState | 'unsupported';

@Component({
  selector: 'app-location-cta',
  templateUrl: './location-cta.component.html',
  styleUrls: ['./location-cta.component.css'],
  standalone: true,
  imports: [CommonModule, RouterModule, MatButtonModule, MatSnackBarModule]
})
export class LocationCtaComponent implements OnInit {
  @Input() uid!: string;
  @Input() role: UserRole | undefined;
  @Input() emailVerified = false;

  @Output() updated = new EventEmitter<{ coords: GeoCoordinates; geohash?: string }>();

  permState: PermState = 'unsupported';
  busy = false;

  constructor(
    private geo: GeolocationService,
    private persist: LocationPersistenceService,
    private snack: MatSnackBar
  ) { }

  async ngOnInit() {
    this.permState = await this.geo.queryPermission();
  }

  get buttonLabel(): string {
    if (this.permState === 'granted') return 'Atualizar minha localização';
    if (this.permState === 'denied') return 'Permitir localização no navegador';
    return 'Ativar localização';
  }

  async onActivate() {
    if (!this.uid) {
      this.snack.open('Faça login para ativar sua localização.', undefined, { duration: 2500 });
      return;
    }

    this.busy = true;
    try {
      const raw = await firstValueFrom(
        this.geo.currentPosition$({
          requireUserGesture: true,
          enableHighAccuracy: this.emailVerified && (this.role === 'vip' || this.role === 'premium'),
          timeout: 10000,
        })
      );

      const { coords, geohash, policy } =
        this.geo.applyRolePrivacy(raw, this.role, this.emailVerified);

      await this.persist.saveUserLocation(this.uid, coords, geohash);
      localStorage.setItem('geo_soft_accept', '1');

      this.updated.emit({ coords, geohash });
      this.snack.open(
        `Localização atualizada • precisão ≈ ${policy.decimals} casas`,
        undefined, { duration: 2500 }
      );

      this.permState = await this.geo.queryPermission();
    } catch (e) {
      const err = e as GeolocationError;

      // mapa tipado pelo enum
      const msg: Record<GeolocationErrorCode, string> = {
        [GeolocationErrorCode.USER_GESTURE_REQUIRED]: 'Clique no botão para permitir.',
        [GeolocationErrorCode.PERMISSION_DENIED]: 'Permissão negada. Verifique o cadeado do navegador.',
        [GeolocationErrorCode.INSECURE_CONTEXT]: 'Use HTTPS (ou localhost) para ativar localização.',
        [GeolocationErrorCode.POSITION_UNAVAILABLE]: 'Não foi possível obter sua posição agora.',
        [GeolocationErrorCode.TIMEOUT]: 'Demorou demais para obter sua posição.',
        [GeolocationErrorCode.UNSUPPORTED]: 'Seu navegador não suporta geolocalização.',
        [GeolocationErrorCode.UNKNOWN]: 'Erro ao tentar obter sua localização.',
      };

      this.snack.open(msg[err.code] ?? msg[GeolocationErrorCode.UNKNOWN], undefined, { duration: 3000 });
    } finally {
      this.busy = false;
    }
  }
}
