//src\app\dashboard\online-users\online-users.component.ts
import { Component, OnInit } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UsuarioStateService } from 'src/app/core/services/autentication/usuario-state.service';

@Component({
  selector: 'app-online-users',
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css']
})

export class OnlineUsersComponent implements OnInit {
  onlineUsersByRegion$: Observable<IUserDados[]> = of([]);

  constructor(private usuarioStateService: UsuarioStateService,
    private authService: AuthService,
   ) {}

  ngOnInit(): void {
    console.log('Componente OnlineUsers: ngOnInit chamado');
    this.usuarioStateService.fetchAllUsers(); // Garante a busca de todos os usuários
    this.onlineUsersByRegion$ = this.usuarioStateService.allUsers$.pipe(
      switchMap(users => {
        return this.authService.user$.pipe(
          map(currentUser => {
            if (!currentUser) {
              console.log('Nenhum usuário autenticado encontrado.');
              return [];
            }
            console.log('Usuário autenticado encontrado:', currentUser);
            const filteredUsers = users.filter(user =>
              user.isOnline &&
              user.municipio === currentUser.municipio &&
              user.uid !== currentUser.uid
            );
            console.log('Usuários online filtrados:', filteredUsers);
            return filteredUsers;
          })
        );
      })
    );
  }

}
