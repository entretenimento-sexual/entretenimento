// src\app\core\services\autentication\TokenService.ts
import { Injectable } from '@angular/core';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Observable, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class TokenService {
  user$: Observable<User | null>;

  constructor(private auth: Auth) {
    // Cria um Observable para rastrear o estado de autenticação do usuário
    this.user$ = new Observable(observer => {
      // Monitore as mudanças no estado de autenticação
      const unsubscribe = onAuthStateChanged(auth, user => {
        observer.next(user);  // Emite o estado atual do usuário
        observer.complete(); // Completa o Observable
      });

      // Função de limpeza ao final da subscrição
      return () => unsubscribe();
    });
  }

  // Recupera o token do usuário atual (se ele estiver autenticado)
  getToken(): Observable<string | null> {
    return this.user$.pipe(
      switchMap(user => (user ? user.getIdToken() : of(null))),
      take(1)
    );
  }

  // Verifica se o usuário está autenticado
  isLoggedIn(): Observable<boolean> {
    return this.user$.pipe(
      map(user => !!user)
    );
  }
}
