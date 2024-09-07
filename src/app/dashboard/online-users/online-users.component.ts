// src/app/dashboard/online-users/online-users.component.ts
import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators'; // Importe o operador map do rxjs
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Store, select } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { loadOnlineUsers } from 'src/app/store/actions/user.actions';
import { selectAllOnlineUsers } from 'src/app/store/selectors/user.selectors';

@Component({
  selector: 'app-online-users',
  templateUrl: './online-users.component.html',
  styleUrls: ['./online-users.component.css']
})
export class OnlineUsersComponent implements OnInit {
  onlineUsers$: Observable<IUserDados[]> | undefined;

  constructor(private store: Store<AppState>) { }

  ngOnInit(): void {
    console.log('Buscando todos os usuários online...');

    // Dispara a ação para carregar os usuários online
    this.store.dispatch(loadOnlineUsers());

    // Seleciona os usuários online diretamente e aplica a lógica de ordenação
    this.onlineUsers$ = this.store.pipe(
      select(selectAllOnlineUsers),
      map((users: IUserDados[]) => { // Define o tipo dos usuários
        console.log('Usuários recebidos antes da ordenação:', users);

        // Define a prioridade dos papéis
        const rolePriority: { [key: string]: number } = { 'vip': 1, 'premium': 2, 'basico': 3, 'free': 4 };

        return users.sort((a: IUserDados, b: IUserDados) => {
          // 1. Ordenar por papel (VIP, Premium, Basico, Free)
          const roleDifference = rolePriority[a.role] - rolePriority[b.role];
          if (roleDifference !== 0) return roleDifference;

          // 2. Dentro do papel, ordenar por presença de foto
          if (!a.photoURL && b.photoURL) return 1;
          if (a.photoURL && !b.photoURL) return -1;

          // 3. Dentro dos usuários com fotos, ordenar por município
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
  }
}
