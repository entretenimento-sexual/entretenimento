// src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css']
})
export class UserProfileViewComponent implements OnInit {

  userId!: string | null;
  userName: string | null | undefined = null;
  userNickname?: string | null | undefined = null;
  userIdade?: string | null | undefined = null;
  public photoURL: string = '';
  public currentRoute: string = '';

  constructor(private route: ActivatedRoute,
              private router: Router,
              private authService: AuthService
    ) { }

  async ngOnInit(): Promise<void> {
    this.currentRoute = this.router.url;
    console.log("Inicializando UserProfileViewComponent.");
    this.userId = this.route.snapshot.paramMap.get('id');
    console.log('UserID obtido da rota:', this.userId);

    // Se a rota for 'meu-perfil', pegue o ID do usuário atualmente autenticado
    if (this.userId === 'meu-perfil') {
      const currentUser = this.authService.currentUser;
      if (currentUser) {
        this.userId = currentUser.uid;
      }
    }

    if (this.userId) {
      console.log('Buscando dados do usuário com UserID:', this.userId);
      const userData = await this.authService.getUserById(this.userId);
      console.log('Dados do usuário recuperados:', userData);
      if (userData) {
        this.userName = userData.nome || userData.displayName;
        this.userNickname = userData.nickname;
        this.userIdade = userData.idade?.toString() || null;
        this.photoURL = userData.photoURL || '';
      }
    }
  }}
