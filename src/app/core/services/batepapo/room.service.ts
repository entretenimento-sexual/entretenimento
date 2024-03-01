//src\app\core\services\batepapo\room.service.ts
import { Injectable } from '@angular/core';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { Observable, of, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class RoomService {

  constructor(private subscriptionService: SubscriptionService) { }

  createRoom(roomDetails: any): Observable<any> {
    // Primeiro, verifica se o usuário é assinante
    return this.subscriptionService.checkUserSubscription().pipe(
      switchMap(isSubscriber => {
        if (!isSubscriber) {
          this.subscriptionService.promptSubscription({
            title: "Exclusivo para assinantes",
            message: "Deseja se tornar um assinante para criar salas?"
          });
          // Retorna um erro observável para interromper o fluxo, pois o diálogo já está sendo tratado
          return throwError(() => new Error('Acesso negado: apenas assinantes podem criar salas de bate-papo.'));
        }
        // Se o usuário for assinante, continua a lógica para criar a sala
        console.log('Criando sala de bate-papo com detalhes', roomDetails);
        // Substitua o retorno abaixo pela sua lógica de criação de sala efetiva
        return of({ success: true, roomId: 'roomId123' });
      }),
      catchError(error => {
        console.error('Erro ao criar a sala de bate-papo:', error);
        return throwError(() => error);
      })
    );
  }
  // Outros métodos relacionados ao gerenciamento de salas de bate-papo podem ser adicionados aqui
}
