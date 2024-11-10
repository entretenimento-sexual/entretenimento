// src/app/dashboard/online-users/online-users.component.ts
import { Component, OnInit } from '@angular/core';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap, tap, first } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { FirestoreQueryService } from 'src/app/core/services/autentication/firestore-query.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { GeolocationService } from 'src/app/core/services/geolocation/geolocation.service';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { Timestamp } from 'firebase/firestore';

@Component({
  selector: 'app-online-users',
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css']
})
export class OnlineUsersComponent implements OnInit {
  onlineUsers$: Observable<IUserDados[]> | undefined;
  loading$: Observable<boolean> | undefined;
  userLocation: { latitude: number, longitude: number } | null = null;
  loading: boolean = false;
  maxDistanceKm = 50; // Defina a distância máxima desejada em km

  constructor(
    private store: Store<AppState>,
    private authService: AuthService,
    private geolocationService: GeolocationService,
    private distanceService: DistanceCalculationService,
    private errorNotificationService: ErrorNotificationService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private firestoreQueryService: FirestoreQueryService
  ) { }

  async ngOnInit(): Promise<void> {
    this.loading = true;

    // Obtém o UID do usuário logado
    let loggedUserUID: string | undefined;
    this.authService.user$.pipe(first()).subscribe(user => {
      loggedUserUID = user?.uid;
    });

    // Obtém a localização do usuário
    try {
      this.userLocation = await this.geolocationService.getCurrentLocation();
      console.log('Localização do usuário:', this.userLocation);
    } catch (error) {
      console.error('Erro ao obter localização:', error);
      this.errorNotificationService.showError('Não foi possível acessar sua localização.');
      this.userLocation = null;
    }

    // Busca e exibe usuários online
    this.onlineUsers$ = from(this.firestoreQueryService.getOnlineUsers()).pipe(
      map(users => this.processOnlineUsers(users, loggedUserUID)),
      catchError(error => {
        this.errorNotificationService.showError('Erro ao carregar usuários online.');
        this.globalErrorHandlerService.handleError(error);
        this.loading = false;
        return of([]);
      })
    );

    this.onlineUsers$?.subscribe({
      next: onlineUsers => {
        onlineUsers.length > 0
          ? this.errorNotificationService.showSuccess('Usuários carregados com sucesso.')
          : this.errorNotificationService.showInfo('Nenhum usuário online no momento.');
      },
      error: err => {
        this.errorNotificationService.showError('Erro ao carregar usuários online.');
        this.globalErrorHandlerService.handleError(err);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }

  private processOnlineUsers(users: IUserDados[], loggedUserUID?: string): IUserDados[] {
    if (!this.userLocation) {
      console.log('Localização do usuário não disponível.');
      return [];
    }

    const processedUsers = users
      .filter(user => user.latitude != null && user.longitude != null && user.uid !== loggedUserUID) // Exclui o próprio usuário
      .map(user => {
        if (this.userLocation) {
          const distanceInKm = this.distanceService.calculateDistanceInKm(
            this.userLocation.latitude!,
            this.userLocation.longitude!,
            user.latitude!,
            user.longitude!
          );

          if (distanceInKm !== null && distanceInKm <= this.maxDistanceKm) {
            return { ...user, distanciaKm: distanceInKm };
          }
        }
        return null;
      })
      .filter(user => user !== null)
      .sort((a, b) => this.compareUsers(a!, b!));

    return processedUsers as IUserDados[];
  }

  private compareUsers(a: IUserDados, b: IUserDados): number {
    const rolePriority: { [key: string]: number } = { 'vip': 1, 'premium': 2, 'basico': 3, 'free': 4 };
    const roleDifference = rolePriority[a.role] - rolePriority[b.role];
    if (roleDifference !== 0) return roleDifference;

    if (!a.photoURL && b.photoURL) return 1;
    if (a.photoURL && !b.photoURL) return -1;

    const municipioDifference = (a.municipio?.toLowerCase() || '').localeCompare(b.municipio?.toLowerCase() || '');
    if (municipioDifference !== 0) return municipioDifference;

    const aLastLoginMillis = a.lastLoginDate instanceof Timestamp ? a.lastLoginDate.toMillis() : 0;
    const bLastLoginMillis = b.lastLoginDate instanceof Timestamp ? b.lastLoginDate.toMillis() : 0;

    return bLastLoginMillis - aLastLoginMillis;
  }
}
