//src\app\core\services\batepapo\room.service.ts
import { Injectable } from '@angular/core';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { Observable, of, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { AuthService } from '../autentication/auth.service';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class RoomService {

  constructor(private subscriptionService: SubscriptionService,
              private authService: AuthService,
              private router: Router) { }

  canCreateRoomBasedOnRole(role: string): boolean {
    return ['articulador', 'extase'].includes(role);
  }

  createRoom(roomDetails: any): Observable<any> {
    return this.authService.user$.pipe(
      switchMap(user => {
        if (!user) {
          return throwError(() => new Error('Usuário não autenticado.'));
        }
        if (!['articulador', 'extase'].includes(user.role)) {
          this.subscriptionService.promptSubscription({
            title: "Exclusivo para certos roles",
            message: "Apenas usuários com certos roles podem criar salas. Deseja atualizar seu role ou assinatura?"
          });
          return throwError(() => new Error('Acesso negado: apenas usuários com roles específicos podem criar salas de bate-papo.'));
        }

        let roomExpiration;
        if (user.isSubscriber) {
          // Lógica para assinantes contínuos
          roomExpiration = user.roomCreationSubscriptionExpires ?? new Date(new Date().setFullYear(new Date().getFullYear() + 1));
        } else if (user.singleRoomCreationRightExpires) {
          // Lógica para pagadores mensais
          roomExpiration = new Date(new Date().setDate(new Date().getDate() + 30));
        } else {
          // Usuários não assinantes
          this.subscriptionService.promptSubscription({
            title: "Torne-se um assinante",
            message: "Você precisa ser assinante para criar uma sala. Gostaria de se tornar um?"
          });
          return throwError(() => new Error('Acesso negado: apenas assinantes podem criar salas.'));
        }
        console.log('Criando sala de bate-papo com detalhes', roomDetails, 'e expiração em', roomExpiration);
        // Implemente a criação real da sala aqui
        return of({ success: true, roomId: 'roomId123', expiration: roomExpiration });
      }),
      catchError(error => {
        console.error('Erro ao criar a sala de bate-papo:', error);
        return throwError(() => error);
      })
    );
  }
}

