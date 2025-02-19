// src\app\user-profile\user-profile-view\user-profile-preferences\user-profile-preferences.component.ts
import { Component, Input } from '@angular/core';
import { mapeamentoCategorias } from 'src/app/core/interfaces/icategoria-mapeamento';
import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';
import { UserPreferencesService } from 'src/app/core/services/preferences/user-preferences.service';

@Component({
    selector: 'app-user-profile-preferences',
    templateUrl: './user-profile-preferences.component.html',
    styleUrls: ['./user-profile-preferences.component.css',],
    standalone: false
})

export class UserProfilePreferencesComponent {
  @Input() uid: string | null = null;
  public categoriasDePreferencias: any = {
    genero: [],
    praticaSexual: [],
    preferenciaFisica: [],
    relacionamento: []
  };

  constructor(private userPreferencesService: UserPreferencesService) { }

  ngOnInit(): void {
    console.log('[UserProfilePreferencesComponent] Iniciando com UID:', this.uid);
    if (this.uid) {
      this.userPreferencesService.getUserPreferences$(this.uid)
        .subscribe((preferencias: IUserPreferences) => {
          this.agruparPreferencias(preferencias);
        });
    }
  }

  private agruparPreferencias(preferencias: IUserPreferences): void {
    this.categoriasDePreferencias = {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: []
    };

    for (const key in preferencias) {
      if (preferencias[key]) {
        for (const categoria in mapeamentoCategorias) {
          if (mapeamentoCategorias[categoria as keyof typeof mapeamentoCategorias].includes(key)) {
            this.categoriasDePreferencias[categoria].push(key);
            break;
          }
        }
      }
    }
  }
}

