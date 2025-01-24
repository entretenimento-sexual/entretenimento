//src\app\authentication\register-module\register-progress.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { map, switchMap, of } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';


@Injectable({
  providedIn: 'root',
})
export class RegisterProgressGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private router: Router
  ) { }

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
    return this.authService.user$.pipe(
      switchMap((user) => {
        if (!user) {
          // Usuário não autenticado, redireciona para login
          this.router.navigate(['/login']);
          return of(false);
        }

        // Usuário autenticado, verifica progresso do cadastro
        return this.firestoreUserQuery.getUser(user.uid).pipe(
          map((userData) => {
            if (!userData) {
              // Dados não encontrados, redireciona para login
              this.router.navigate(['/login']);
              return false;
            }

            if (!userData.emailVerified) {
              // Email não verificado, redireciona para página de boas-vindas
              this.router.navigate(['/welcome']);
              return false;
            }

            if (!userData.gender || !userData.estado || !userData.municipio) {
              // Cadastro incompleto, redireciona para página de finalização de cadastro
              this.router.navigate(['/finalizar-cadastro']);
              return false;
            }

            // Cadastro completo, acesso permitido
            return true;
          })
        );
      })
    );
  }
}
