// src/app/layout/profile-list/profile-list.component.ts
import { Component, OnInit } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';


@Component({
  selector: 'app-profile-list',
  templateUrl: './profile-list.component.html',
  styleUrls: ['./profile-list.component.css', '../layout-profile-exibe.css']
})
export class ProfileListComponent implements OnInit {
  user: any;
  profiles: any[] = [];

  constructor(private authService: AuthService,
              private firestoreService: FirestoreService) { }

  ngOnInit(): void {
    this.authService.user$.subscribe(currentUser => {
      this.user = currentUser;

      // Carrega os perfis sugeridos após garantir que o usuário está autenticado
      this.firestoreService.getSuggestedProfiles()
        .then(profiles => {
          this.profiles = profiles;
        })
        .catch(error => {
          console.error("Erro ao buscar perfis sugeridos:", error);
        });
    });
  }
}
