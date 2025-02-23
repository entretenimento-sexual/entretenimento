// src\app\user-profile\user-profile-edit\edit-profile-preferences\edit-profile-preferences.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, tap, catchError, finalize, first } from 'rxjs/operators';
import { UserPreferencesService } from 'src/app/core/services/preferences/user-preferences.service';
import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-edit-profile-preferences',
  templateUrl: './edit-profile-preferences.component.html',
  styleUrls: ['./edit-profile-preferences.component.css'],
  standalone: false
})
export class EditProfilePreferencesComponent implements OnInit {
  uid: string | null = null;
  carregando: boolean = true;
  preferencias$: Observable<IUserPreferences | null> = of(null);
  preferencias: IUserPreferences = {
    genero: [],
    praticaSexual: [],
    preferenciaFisica: [],
    relacionamento: []
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userPreferencesService: UserPreferencesService,
    private errorHandler: GlobalErrorHandlerService,
    private notifier: ErrorNotificationService
  ) { }

  ngOnInit(): void {
    console.log('[EditProfilePreferencesComponent] Inicializando...');

    // Captura o UID da rota antes de buscar as preferências
    this.route.paramMap.pipe(
      first(),
      map(params => params.get('id')),
      tap(uid => {
        if (!uid) {
          console.warn('[EditProfilePreferencesComponent] UID não encontrado na rota.');
          this.carregando = false;
        } else {
          console.log('[EditProfilePreferencesComponent] UID extraído:', uid);
          this.uid = uid;
        }
      }),
      switchMap(uid => {
        if (!uid) return of(null);
        console.log('[EditProfilePreferencesComponent] Buscando preferências para UID:', uid);

        return this.userPreferencesService.getUserPreferences$(uid).pipe(
          tap(preferencias => {
            if (preferencias) {
              this.preferencias = { ...preferencias};
              console.log('[EditProfilePreferencesComponent] Preferências carregadas:', preferencias);
            }
          }),
          catchError(error => {
            this.errorHandler.handleError(error);
            this.notifier.showError('Erro ao buscar preferências. Tente novamente mais tarde.');
            console.error('[EditProfilePreferencesComponent] Erro ao buscar preferências:', error);
            return of(null);
          }),
          finalize(() => {
            this.carregando = false;
            console.log('[EditProfilePreferencesComponent] Inicialização concluída.');
          })
        );
      })
    ).subscribe(preferencias => this.preferencias$ = of(preferencias));
  }

  salvarPreferencias(): void {
    if (!this.uid) {
      this.notifier.showError('Erro: Nenhum UID encontrado.');
      console.error('[EditProfilePreferencesComponent] Tentativa de salvar sem UID.');
      return;
    }

    console.log('[EditProfilePreferencesComponent] Salvando preferências:', this.preferencias);

    const preferenciasParaSalvar: Partial<IUserPreferences> = { ...this.preferencias };

    this.userPreferencesService.saveUserPreferences$(this.uid, preferenciasParaSalvar)
      .pipe(
        tap(() => {
          console.log('[EditProfilePreferencesComponent] Preferências salvas com sucesso!');
          this.notifier.showSuccess('Preferências salvas com sucesso!');
          this.router.navigate(['/perfil', this.uid]);
        }),
        catchError(err => {
          this.errorHandler.handleError(err);
          this.notifier.showError('Erro ao salvar preferências. Tente novamente.');
          console.error('[EditProfilePreferencesComponent] Erro ao salvar preferências:', err);
          return of(null);
        })
      ).subscribe();
  }

  voltarSemSalvar(): void {
    if (this.uid) {
      console.log('[EditProfilePreferencesComponent] Retornando sem salvar.');
      this.router.navigate(['/perfil', this.uid]);
    } else {
      console.warn('[EditProfilePreferencesComponent] Não foi possível retornar, UID ausente.');
    }
  }
}
