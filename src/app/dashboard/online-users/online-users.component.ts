// src/app/dashboard/online-users/online-users.component.ts
import { Component, OnInit } from '@angular/core';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap, tap, first, finalize } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { GeolocationService } from 'src/app/core/services/geolocation/geolocation.service';
import { DistanceCalculationService } from 'src/app/core/services/geolocation/distance-calculation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { Timestamp } from 'firebase/firestore';

@Component({
  selector: 'app-online-users',
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css'],
  standalone: false
})
export class OnlineUsersComponent implements OnInit {
  onlineUsers$: Observable<IUserDados[]> | undefined;
  loading: boolean = false;
  userLocation: { latitude: number; longitude: number } | null = null;
  maxDistanceKm = 50;

  constructor(
    private authService: AuthService,
    private geolocationService: GeolocationService,
    private distanceService: DistanceCalculationService,
    private errorNotificationService: ErrorNotificationService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private firestoreQueryService: FirestoreQueryService
  ) { }

  ngOnInit(): void {
    this.loading = true;

    this.authService.user$.pipe(
      first(),
      switchMap(user => {
        if (!user) {
          this.loading = false;
          this.errorNotificationService.showError('Usuário não encontrado.');
          throw new Error('Usuário não encontrado.');
        }

        return from(this.geolocationService.getCurrentLocation()).pipe(
          map(location => ({ user, location })),
          catchError(error => {
            this.errorNotificationService.showError('Não foi possível acessar sua localização.');
            this.loading = false;
            return of(null);
          })
        );
      }),
      switchMap(result => {
        if (!result) return of([]);

        this.userLocation = result.location;
        return from(this.firestoreQueryService.getOnlineUsers()).pipe(
          map(users => this.processOnlineUsers(users, result.user.uid)),
          catchError(error => {
            this.errorNotificationService.showError('Erro ao carregar usuários online.');
            this.globalErrorHandlerService.handleError(error);
            return of([]);
          }),
          finalize(() => this.loading = false)
        );
      })
    ).subscribe(users => {
      this.onlineUsers$ = of(users);
      if (users.length > 0) {
        this.loading = false;
        this.errorNotificationService.showSuccess('Usuários carregados com sucesso.');
      } else {
        this.errorNotificationService.showInfo('Nenhum usuário online no momento.');
      }
    });
  }

  /**
   * Processa a lista de usuários online, filtrando por distância e excluindo o próprio usuário.
   */
  private processOnlineUsers(users: IUserDados[], loggedUserUID: string): IUserDados[] {
    if (!this.userLocation) {
      console.log('Localização do usuário não disponível.');
      return [];
    }

    return users
      .filter(user => user.latitude != null && user.longitude != null && user.uid !== loggedUserUID)
      .map(user => {
        const distanceInKm = this.distanceService.calculateDistanceInKm(
          this.userLocation!.latitude,
          this.userLocation!.longitude,
          user.latitude!,
          user.longitude!
        );

        return {
          ...user,
          distanciaKm: distanceInKm !== null ? distanceInKm : undefined
        };
      })
      .filter(user => user.distanciaKm !== undefined && user.distanciaKm <= this.maxDistanceKm)
      .sort((a, b) => this.compareUsers(a, b));
  }

  /**
   * Compara dois usuários para ordenação por prioridade de papel (role) e outros critérios.
   */
  private compareUsers(a: IUserDados, b: IUserDados): number {
    const rolePriority: { [key: string]: number } = { vip: 1, premium: 2, basico: 3, free: 4 };
    const roleDifference = rolePriority[a.role] - rolePriority[b.role];
    if (roleDifference !== 0) return roleDifference;

    if (!a.photoURL && b.photoURL) return 1;
    if (a.photoURL && !b.photoURL) return -1;

    const municipioDifference = (a.municipio?.toLowerCase() || '').localeCompare(b.municipio?.toLowerCase() || '');
    if (municipioDifference !== 0) return municipioDifference;

    const aLastLoginMillis = a.lastLogin instanceof Timestamp ? a.lastLogin.toMillis() : 0;
    const bLastLoginMillis = b.lastLogin instanceof Timestamp ? b.lastLogin.toMillis() : 0;
    return bLastLoginMillis - aLastLoginMillis;
  }
}
