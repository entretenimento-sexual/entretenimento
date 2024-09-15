// src/app/dashboard/online-users/online-users.component.ts
import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Store, select } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { loadOnlineUsers } from 'src/app/store/actions/user.actions';
import { selectAllOnlineUsers } from 'src/app/store/selectors/user.selectors';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { GeolocationService } from 'src/app/core/services/geolocation/geolocation.service';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';

@Component({
  selector: 'app-online-users',
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css']
})
export class OnlineUsersComponent implements OnInit {
  onlineUsers$: Observable<IUserDados[]> | undefined;
  userLocation: { latitude: number, longitude: number } | null = null;

  constructor(private store: Store<AppState>,
    private authService: AuthService,
    private geolocationService: GeolocationService,
    private distanceService: DistanceCalculationService) { }

  async ngOnInit(): Promise<void> {
    // Obter a localização do usuário logado
    this.userLocation = await this.geolocationService.getCurrentLocation();
    // Dispara a ação para carregar os usuários online
    this.store.dispatch(loadOnlineUsers());
    console.log('Buscando todos os usuários online...');

    // Obter o UID do usuário logado como um Observable
    this.authService.getUserAuthenticated().subscribe(loggedUser => {
      const loggedUserUID = loggedUser?.uid;

      // Seleciona os usuários online diretamente e aplica a lógica de ordenação
      this.onlineUsers$ = this.store.pipe(
        select(selectAllOnlineUsers),
        map((users: IUserDados[]) => {
          console.log('Usuários recebidos antes da ordenação:', users);

          // Filtra para remover o próprio usuário logado
          const filteredUsers = users.filter(user => user.uid !== loggedUserUID);
          // Calcular a distância para cada usuário
          return filteredUsers.map(user => {
            const userCopy = { ...user };
            if (this.userLocation && user.latitude && user.longitude) {
              console.log(`Calculando distância para o usuário ${user.uid} com coordenadas (${user.latitude}, ${user.longitude})`);
              const distanceInKm = this.distanceService.calculateDistanceInKm(
                this.userLocation.latitude,
                this.userLocation.longitude,
                user.latitude,
                user.longitude
              );
              userCopy.distanciaKm = distanceInKm ?? undefined; // Usar undefined se distanceInKm for null
            } else {
              console.log(`Usuário ${user.uid} não tem coordenadas válidas.`);
              userCopy.distanciaKm = undefined; // Usar undefined em vez de null
            }
            return userCopy;
          }).sort((a: IUserDados, b: IUserDados) => {
            // Ordenação por papel e outros critérios
            const rolePriority: { [key: string]: number } = { 'vip': 1, 'premium': 2, 'basico': 3, 'free': 4 };
            const roleDifference = rolePriority[a.role] - rolePriority[b.role];
            if (roleDifference !== 0) return roleDifference;

            if (!a.photoURL && b.photoURL) return 1;
            if (a.photoURL && !b.photoURL) return -1;

            const aMunicipio = a.municipio?.toLowerCase() || '';
            const bMunicipio = b.municipio?.toLowerCase() || '';
            const municipioDifference = aMunicipio.localeCompare(bMunicipio);
            if (municipioDifference !== 0) return municipioDifference;

            // 4. Dentro do município, ordenar por último login (mais recente primeiro)
            if (a.lastLoginDate && b.lastLoginDate) {
              return b.lastLoginDate.toMillis() - a.lastLoginDate.toMillis();
            }

            return 0; // Se tudo for igual, mantém a ordem original
          });
        })
      );

      // Observa os usuários online e imprime no console
      this.onlineUsers$.subscribe(onlineUsers => {
        console.log('Usuários online encontrados no componente:', onlineUsers);
      });
    });
  }
}
