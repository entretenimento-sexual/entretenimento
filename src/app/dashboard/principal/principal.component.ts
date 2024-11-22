// src/app/dashboard/principal/principal.component.ts
import { Component, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { filter, take } from 'rxjs/operators';

@Component({
    selector: 'app-principal',
    templateUrl: './principal.component.html',
    styleUrls: ['./principal.component.css'],
    standalone: false
})
export class PrincipalComponent implements OnInit {
  currentUser$: Observable<IUserDados | null>;

  constructor(private store: Store<AppState>) {
    this.currentUser$ = this.store.select(selectCurrentUser);
  }

  ngOnInit(): void {
    // Espera até que o currentUser seja emitido
    this.currentUser$.pipe(
      filter(user => user !== null),
      take(1)
    ).subscribe(user => {
      console.log('Usuário disponível no componente:', user);
    });
  }
}
