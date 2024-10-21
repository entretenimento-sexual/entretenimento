// src\app\user-profile\user-profile-view\user-profile-preferences\user-profile-preferences.component.ts
import { Component, Input } from '@angular/core';
import { SharedModule } from "../../../shared/shared.module";
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { mapeamentoCategorias } from 'src/app/core/interfaces/icategoria-mapeamento';
import { IUserPreferences } from 'src/app/core/interfaces/iuser-preferences';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { UserPreferencesService } from 'src/app/core/services/preferences/user-preferences.service';

@Component({
    selector: 'app-user-profile-preferences',
    templateUrl: './user-profile-preferences.component.html',
    styleUrls: ['./user-profile-preferences.component.css',]

  })
  
export class UserProfilePreferencesComponent {
  @Input() uid: string | null = null;
  public categoriasDePreferencias: any = {
    genero: [],
    praticaSexual: [],
    preferenciaFisica: [],
    relacionamento: []
  };

  constructor(private usuarioService: UsuarioService,
    private userPreferencesService: UserPreferencesService) { }

  ngOnInit(): void {
    if (this.uid) {
      this.userPreferencesService.buscarPreferenciasDoUsuario(this.uid)
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

