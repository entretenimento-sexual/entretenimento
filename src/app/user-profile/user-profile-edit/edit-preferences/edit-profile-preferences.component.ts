// src\app\user-profile\user-profile-edit\edit-profile-preferences\edit-profile-preferences.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, tap, catchError } from 'rxjs/operators';
import { UserPreferencesService } from 'src/app/core/services/preferences/user-preferences.service';
import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';

@Component({
  selector: 'app-edit-profile-preferences',
  templateUrl: './edit-profile-preferences.component.html',
  styleUrls: ['./edit-profile-preferences.component.css'],
  standalone: false
})
export class EditProfilePreferencesComponent implements OnInit {
  uid: string | null = null;
  preferencias$: Observable<IUserPreferences | null> = of(null); // Usando Observable ao invés de atributo direto
  preferencias: IUserPreferences = {
    genero: [],
    praticaSexual: [],
    preferenciaFisica: [],
    relacionamento: []
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userPreferencesService: UserPreferencesService
  ) { }

  ngOnInit(): void {
    console.log('[EditProfilePreferencesComponent] Inicializando...');

    this.preferencias$ = this.route.paramMap.pipe(
      map(params => params.get('id')),
      tap(uid => this.uid = uid),
      switchMap(uid => {
        if (!uid) return of(null);
        console.log('[EditProfilePreferencesComponent] Buscando preferências para UID:', uid);
        return this.userPreferencesService.getUserPreferences$(uid).pipe(
          tap(preferencias => {
            if (preferencias) {
              this.preferencias = preferencias;
              console.log('[EditProfilePreferencesComponent] Preferências carregadas:', preferencias);
            }
          }),
          catchError(error => {
            console.error('[EditProfilePreferencesComponent] Erro ao buscar preferências:', error);
            return of(null);
          })
        );
      })
    );
  }

  salvarPreferencias(): void {
    if (!this.uid) return;

    console.log('[EditProfilePreferencesComponent] Salvando preferências:', this.preferencias);

    const preferenciasParaSalvar: { [key: string]: any } = {};
    for (const key in this.preferencias) {
      if (this.preferencias.hasOwnProperty(key)) {
        preferenciasParaSalvar[key] = { value: this.preferencias[key] };
      }
    }

    this.userPreferencesService.saveUserPreferences$(this.uid, preferenciasParaSalvar)
      .subscribe({
        next: () => {
          console.log('[EditProfilePreferencesComponent] Preferências salvas com sucesso!');
          this.router.navigate(['/perfil', this.uid]);
        },
        error: err => {
          console.error('[EditProfilePreferencesComponent] Erro ao salvar preferências:', err);
        }
      });
  }

  voltarSemSalvar(): void {
    if (this.uid) {
      this.router.navigate(['/perfil', this.uid]);
    }
  }
}
