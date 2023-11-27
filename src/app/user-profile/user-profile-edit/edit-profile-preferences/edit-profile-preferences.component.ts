// src\app\user-profile\user-profile-edit\edit-profile-preferences\edit-profile-preferences.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { UsuarioService } from 'src/app/core/services/usuario.service';

@Component({
  selector: 'app-edit-profile-preferences',
  templateUrl: './edit-profile-preferences.component.html',
  styleUrls: ['./edit-profile-preferences.component.css']
})

export class EditProfilePreferencesComponent implements OnInit {
  uid$!: Observable<string | null>;
  preferencias: any = {};

  constructor(private route: ActivatedRoute,
              private usuarioService: UsuarioService,
              private router: Router) { }

  ngOnInit() {
    this.route.paramMap.pipe(
      map(params => params.get('id')),
      switchMap(uid => {
        if (uid) {
          return this.usuarioService.buscarPreferenciasDoUsuario(uid).pipe(
            tap(preferencias => {
              if (preferencias) {
                this.preferencias = preferencias;
              }
            })
          );
        }
        return of(null);
      })
    ).subscribe();
  }

  salvarPreferencias() {
    console.log('Salvando preferências:', this.preferencias);
    this.route.paramMap.subscribe(params => {
      const uid = params.get('id');
      if (uid) {
        this.usuarioService.salvarPreferenciasDoUsuario(uid, this.preferencias)
          .subscribe({
            next: () => {
              console.log('Preferências salvas com sucesso!');
              this.router.navigate(['/perfil', uid]);
            },
            error: erro => console.error('Erro ao salvar preferências', erro)
          });
      }
    });
  }
}
