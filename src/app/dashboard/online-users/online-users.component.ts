// src/app/dashboard/online-users/online-users.component.ts
import { Component, OnInit } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Store, select } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { loadOnlineUsers } from 'src/app/store/actions/actions.user/user.actions';
import { selectAllOnlineUsers } from 'src/app/store/selectors/selectors.user/user.selectors';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { GeolocationService } from 'src/app/core/services/geolocation/geolocation.service';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';
import { selectLoadingOnlineUsers } from 'src/app/store/selectors/selectors.user/online-users.selectors';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { Timestamp } from '@firebase/firestore';

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

  constructor(
    private store: Store<AppState>,
    private authService: AuthService,
    private geolocationService: GeolocationService,
    private distanceService: DistanceCalculationService,
    private errorNotificationService: ErrorNotificationService,
    private globalErrorHandlerService: GlobalErrorHandlerService
  ) { }

  async ngOnInit(): Promise<void> {
    this.loading = true;

    // Carrega a localização do usuário
    this.userLocation = await this.geolocationService.getCurrentLocation();

    // Dispara a ação para carregar usuários online
    this.store.dispatch(loadOnlineUsers());

    // Estado de carregamento
    this.loading$ = this.store.pipe(select(selectLoadingOnlineUsers));

    // Assinatura para carregar usuários online com filtro e cálculo de distância
    this.onlineUsers$ = this.authService.user$.pipe(
      switchMap(loggedUser => {
        const loggedUserUID = loggedUser?.uid;

        return this.store.pipe(
          select(selectAllOnlineUsers),
          map(users => this.processOnlineUsers(users, loggedUserUID))
        );
      }),
      tap(onlineUsers => {
        if (onlineUsers.length > 0) {
          this.errorNotificationService.showSuccess('Usuários carregados com sucesso.');
        } else {
          this.errorNotificationService.showInfo('Nenhum usuário online no momento.');
        }
      }),
      catchError(error => {
        this.errorNotificationService.showError('Erro ao carregar usuários online.');
        this.globalErrorHandlerService.handleError(error);
        this.loading = false;
        return of([]);
      })
    );

    this.onlineUsers$.subscribe({
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

  // Método para processar os usuários online: filtro, cálculo de distância e ordenação
  private processOnlineUsers(users: IUserDados[], loggedUserUID?: string): IUserDados[] {
    if (!this.userLocation) {
      console.log('Localização do usuário não disponível.');
      return [];
    }

    return users
      .filter(user => user.uid !== loggedUserUID)
      .map(user => {
        if (user.distanciaKm === undefined && user.latitude && user.longitude && this.userLocation) {
        const userCopy = { ...user };
            userCopy.distanciaKm = this.distanceService.calculateDistanceInKm(
            this.userLocation.latitude,
            this.userLocation.longitude,
            user.latitude,
            user.longitude
          ) ?? undefined;
          return userCopy;
        }
        return user;
      })
      .sort((a, b) => this.compareUsers(a, b));
  }

  // Método para comparar e ordenar usuários
  private compareUsers(a: IUserDados, b: IUserDados): number {
    const rolePriority: { [key: string]: number } = { 'vip': 1, 'premium': 2, 'basico': 3, 'free': 4 };
    const roleDifference = rolePriority[a.role] - rolePriority[b.role];
    if (roleDifference !== 0) return roleDifference;

    if (!a.photoURL && b.photoURL) return 1;
    if (a.photoURL && !b.photoURL) return -1;

    const municipioDifference = (a.municipio?.toLowerCase() || '').localeCompare(b.municipio?.toLowerCase() || '');
    if (municipioDifference !== 0) return municipioDifference;

    // Verifica se `lastLoginDate` é um Timestamp e converte para milissegundos
    const aLastLoginMillis = a.lastLoginDate instanceof Timestamp ? a.lastLoginDate.toMillis() : 0;
    const bLastLoginMillis = b.lastLoginDate instanceof Timestamp ? b.lastLoginDate.toMillis() : 0;

    return bLastLoginMillis - aLastLoginMillis;
  }
}
