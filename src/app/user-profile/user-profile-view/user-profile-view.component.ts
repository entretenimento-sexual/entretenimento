// src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css']
})
export class UserProfileViewComponent implements OnInit {

  public isSidebarVisible: boolean = false;
  public userNickname?: string | null | undefined = null;  // Apelido do usuário do perfil visualizado
  public userName: string | null | undefined = null;  // Nome do usuário do perfil visualizado
  public userIdade?: string | null | undefined = null;  // Idade do usuário do perfil visualizado
  public photoURL: string = '';  // URL da foto do perfil visualizado
  public uid!: string | null;  // UID do usuário atualmente logado
  private sidebarSubscription?: Subscription;  // Inscrição para observar mudanças na visibilidade da barra lateral
  public userId!: string | null;  // UserID do perfil que está sendo visualizado

  constructor(
    private route: ActivatedRoute,  // Usado para obter informações sobre a rota atual
    private authService: AuthService,  // Serviço de autenticação
    private sidebarService: SidebarService  // Serviço para controlar a barra lateral
  ) { }

  async ngOnInit(): Promise<void> {
    console.log('UserProfileViewComponent carregado!');

    const currentUser = this.authService.currentUser;// Primeiro, pegamos o usuário atualmente autenticado

    if (!currentUser) {
      console.log('Nenhum usuário logado.');
      return;
    }// Verifica se há um usuário logado. Se não houver, encerra a execução.

    this.uid = currentUser.uid;  // Atribui o UID do usuário autenticado

    this.userId = this.route.snapshot.paramMap.get('id'); // Pegamos o ID da rota
    console.log('UserID obtido da rota:', this.userId);

    // Se a rota for 'meu-perfil', então usamos o UID do usuário atualmente autenticado
    if (this.userId === 'meu-perfil') {
      this.userId = this.uid;
    }

    if (!this.userId) { // Se não houver userID e a rota não for 'meu-perfil', encerra a execução
      console.log('UserID não especificado.');
      return;
    }

    console.log('Buscando dados do usuário com UserID:', this.userId);
    const userData = await this.authService.getUserById(this.userId);
    console.log('Dados do usuário recuperados:', userData);

    if (userData) {// Se tivermos dados do usuário, atualizamos as propriedades do componente
      this.userName = userData.nome || userData.displayName;
      this.userNickname = userData.nickname;
      this.userIdade = userData.idade?.toString() || null;
      this.photoURL = userData.photoURL || '';
    }

    console.log('UID (usuário logado):', this.uid);
    console.log('UserID (perfil visualizado):', this.userId);

    this.sidebarSubscription = this.sidebarService.isSidebarVisible$.subscribe((isVisible) => {
      this.isSidebarVisible = isVisible;
    
    });
  }

  ngOnDestroy(): void {
    this.sidebarSubscription?.unsubscribe();
  }

  isOnOwnProfile(): boolean {
    return this.userId === this.uid;
  }

  }



