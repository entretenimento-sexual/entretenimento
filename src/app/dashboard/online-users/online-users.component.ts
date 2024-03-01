//src\app\dashboard\online-users\online-users.component.ts
import { Component, OnInit } from '@angular/core';
import { EMPTY, Observable, combineLatest, map } from 'rxjs';
import { withLatestFrom } from 'rxjs/operators';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UsuarioStateService } from 'src/app/core/services/autentication/usuario-state.service';

@Component({
  selector: 'app-online-users',
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css']
})
export class OnlineUsersComponent implements OnInit {
  onlineUsersByRegion$: Observable<IUserDados[]> = EMPTY;;

  constructor(private usuarioStateService: UsuarioStateService) { }

  ngOnInit(): void {
    this.usuarioStateService.fetchAllUsers();

    // Combina os dados do usuário corrente com a lista de todos os usuários
    this.onlineUsersByRegion$ = this.usuarioStateService.allUsers$.pipe(
      withLatestFrom(this.usuarioStateService.user$),
      map(([users, currentUser]) => {
        if (!currentUser) return [];
        return users.filter(user => user.municipio === currentUser?.municipio && user.isOnline && user.uid !== currentUser?.uid);
      })
    );
  }
}
