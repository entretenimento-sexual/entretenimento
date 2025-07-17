// src/app/layout/profile-list/profile-list.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Subject } from 'rxjs';
import { switchMap, takeUntil, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
  selector: 'app-profile-list',
  templateUrl: './profile-list.component.html',
  styleUrls: ['./profile-list.component.css', '../layout-profile-exibe.css'],
  standalone: false,
})
export class ProfileListComponent implements OnInit, OnDestroy {
  user: IUserDados | null = null; // Usuário autenticado
  profiles: IUserDados[] = []; // Perfis sugeridos
  private destroy$ = new Subject<void>(); // Para gerenciar assinaturas

  constructor(
    private authService: AuthService,
    private firestoreQuery: FirestoreQueryService
  ) { }

  ngOnInit(): void {
    // Observa mudanças no usuário autenticado
    this.authService.user$
      .pipe(
        takeUntil(this.destroy$), // Garante que a assinatura seja cancelada ao destruir o componente
        switchMap((currentUser) => {
          this.user = currentUser; // Armazena o usuário autenticado
          if (!currentUser) {
            console.log('[ProfileListComponent] Nenhum usuário autenticado.');
            return of([]); // Retorna lista vazia se não houver usuário
          }
          // Busca perfis sugeridos
          return this.firestoreQuery.getSuggestedProfiles().pipe(
            catchError((error) => {
              console.log('Erro ao buscar perfis sugeridos:', error);
              return of([]); // Retorna lista vazia em caso de erro
            })
          );
        })
      )
      .subscribe((profiles) => {
        this.profiles = profiles; // Armazena os perfis sugeridos
        console.log('[ProfileListComponent] Perfis sugeridos carregados:', profiles);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next(); // Emite sinal para encerrar assinaturas
    this.destroy$.complete(); // Completa o Subject
  }
}
