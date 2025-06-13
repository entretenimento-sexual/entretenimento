// src\app\layout\perfis-proximos\perfis-proximos.component.ts
import { Component, OnInit, ViewChild, input } from '@angular/core';
import { Router } from '@angular/router';
import { distanceBetween, geohashForLocation } from 'geofire-common';
import { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { GeolocationService } from 'src/app/core/services/geolocation/geolocation.service';
import { NearbyProfilesService } from 'src/app/core/services/geolocation/near-profile.service';
import { MatDialog } from '@angular/material/dialog';
import { ModalMensagemComponent } from 'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';
import { take } from 'rxjs/operators';
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';


@Component({
    selector: 'app-perfis-proximos',
    templateUrl: './perfis-proximos.component.html',
    styleUrls: ['./perfis-proximos.component.css', '../layout-profile-exibe.css'],
    standalone: true,
  imports: [UserCardComponent]
})
export class PerfisProximosComponent implements OnInit {
  @ViewChild(ModalMensagemComponent)
  modalMensagem!: ModalMensagemComponent;

  userLocation: GeoCoordinates | null = null;
  profiles: IUserDados[] = [];

  readonly user = input.required<IUserDados | null>();
  readonly distanciaKm = input.required<number | null>();

  constructor(
    private geolocationService: GeolocationService,
    private authService: AuthService,
    private nearbyProfilesService: NearbyProfilesService,
    private router: Router,
    private dialog: MatDialog,
    private userProfileService: UserProfileService

  ) { }

  async ngOnInit(): Promise<void> {
    try {
      const user = await this.authService.user$.pipe(take(1)).toPromise();

      if (!user || !user.uid) {
        console.error('UID do usuário não está disponível.');
        return;
      }

      this.userLocation = await this.geolocationService.getCurrentLocation();

      if (this.isValidCoordinates(this.userLocation?.latitude, this.userLocation?.longitude)) {
        const geohash = geohashForLocation([this.userLocation.latitude, this.userLocation.longitude]);
        await this.loadProfilesNearUserLocation(user.uid);
        await this.userProfileService.updateUserLocation(user.uid, this.userLocation, geohash);
      } else {
        console.error('Coordenadas de localização inválidas.');
      }
    } catch (error) {
      console.error('Erro ao obter localização do usuário:', error);
    }
  }

  isValidCoordinates(latitude: number | null, longitude: number | null): boolean {
    console.log('Latitude:', latitude, 'Tipo:', typeof latitude);
    console.log('Longitude:', longitude, 'Tipo:', typeof longitude);

    return (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  async loadProfilesNearUserLocation(uid: string): Promise<void> {
    try {
      if (!this.userLocation) {
        console.error('Localização do usuário não está disponível.');
        return;
      }

      const { latitude, longitude } = this.userLocation;
      const maxDistanceKm = 20;

      this.profiles = await this.nearbyProfilesService.getProfilesNearLocation(
        latitude,
        longitude,
        maxDistanceKm,
        uid  // Passando o UID do usuário logado para o filtro
      );
      console.log('Perfis carregados com distância:', this.profiles);
    } catch (error) {
      console.error('Erro ao carregar perfis próximos:', error);
    }
  }

// daqui pra baixo é sobre envio de mensagem
  abrirModalMensagem(uid: string): void {
    console.log('UID do perfil selecionado para mensagem:', uid);

    const perfilSelecionado = this.profiles.find(profile => profile.uid === uid)
    if (perfilSelecionado) {
      const dialogRef = this.dialog.open(ModalMensagemComponent, {
        width: '22%',
        minWidth: 300,
        data: { profile: perfilSelecionado } // Passe o perfil encontrado como parte dos dados
      });

      dialogRef.afterClosed().subscribe(result => {
        // Trate o resultado aqui
        if (result) {
          this.router.navigate(['/chat', uid]);
        }
      });
    } else {
      console.error('Perfil não encontrado com o UID:', uid);
    }
  }
}



