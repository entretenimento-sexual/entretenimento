// src\app\layout\perfis-proximos\perfis-proximos.component.ts
import { Component, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { distanceBetween, geohashForLocation } from 'geofire-common';
import { GeoCoordinates } from 'src/app/core/interfaces/geolocation.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';
import { GeolocationService } from 'src/app/core/services/geolocation/geolocation.service';
import { NearbyProfilesService } from 'src/app/core/services/geolocation/near-profile.service';
import { MatDialog } from '@angular/material/dialog';
import { ModalMensagemComponent } from 'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';

@Component({
  selector: 'app-perfis-proximos',
  templateUrl: './perfis-proximos.component.html',
  styleUrls: ['./perfis-proximos.component.css', '../layout-profile-exibe.css']
})
export class PerfisProximosComponent implements OnInit {
  @ViewChild(ModalMensagemComponent)
  modalMensagem!: ModalMensagemComponent;

  userLocation: GeoCoordinates | null = null;
  profiles: IUserDados[] = [];

  constructor(
    private geolocationService: GeolocationService,
    private firestoreService: FirestoreService,
    private authService: AuthService,
    private nearbyProfilesService: NearbyProfilesService,
    private router: Router,
    private dialog: MatDialog,
    private userProfileService: UserProfileService

  ) { }

  async ngOnInit(): Promise<void> {

    try {
      // Etapa 1: Obter a localização do usuário.
      this.userLocation = await this.geolocationService.getCurrentLocation();
      console.log('User Location:', this.userLocation);

      // Verifique se as coordenadas são válidas antes de prosseguir.
      if (this.isValidCoordinates(this.userLocation?.latitude, this.userLocation?.longitude)) {
        console.log('Localização do usuário obtida com sucesso:', this.userLocation);
        console.log('Latitude:', this.userLocation?.latitude);
        console.log('Longitude:', this.userLocation?.longitude);

        // Etapa 2: Carregar perfis próximos.
        const user = this.authService.currentUser; // Obtenha o usuário atual
        if (user && user.uid) {
          console.log('usuario possui um id:', user.uid)
          const geohash = geohashForLocation([this.userLocation.latitude, this.userLocation.longitude]);
          await this.loadProfilesNearUserLocation(user.uid);
          // Etapa 3 (opcional): Salvar a localização atualizada no Firestore.
          await this.userProfileService.updateUserLocation(user.uid, this.userLocation, geohash);
        } else {
          console.error('UID do usuário não está disponível.');
          // Lide com as coordenadas inválidas aqui, por exemplo, exibindo uma mensagem para o usuário.
        }
      } else {
        console.error('Coordenadas de localização inválidas.');
        // Lide com as coordenadas inválidas aqui, por exemplo, exibindo uma mensagem para o usuário.
      }
    } catch (error) {
      // Pedir IA para gerar uma mensagem de erro ao usuário
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
      const maxDistanceKm = 20; // Defina a distância máxima desejada em quilômetros.

      // Chame o serviço para obter perfis próximos com base nas coordenadas.
      this.profiles = await this.nearbyProfilesService.getProfilesNearLocation(
        latitude,
        longitude,
        maxDistanceKm,
      );
      // Calcule a distância para cada perfil
  this.profiles.forEach(profile => {
    if (profile.latitude && profile.longitude) {
      const distance = distanceBetween([profile.latitude, profile.longitude], [latitude, longitude]);
      console.log(this.profiles)
      profile.distanciaKm = distance / 1000; // Converta para quilômetros

    }
  });

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



