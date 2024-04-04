// src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, Observable } from 'rxjs';
import { tap, map } from 'rxjs/operators';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from 'firebase/firestore';


enum SidebarState { CLOSED, OPEN }

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css', '../user-profile.css',
               './css-teste-user-profile-view.css']
})

export class UserProfileViewComponent implements OnInit, OnDestroy {

  private sidebarSubscription?: Subscription;
  public isSidebarVisible = SidebarState.CLOSED;
  public usuario$: Observable<IUserDados | null>;
  public uid!: string | null;
  public preferences: any;


  objectKeys(obj: any): string[] {
    return Object.keys(obj).filter(key => obj[key] && obj[key].value);
  }

  isCouple(gender: string | undefined): boolean {
    if (!gender) {
      return false;
    }
    return ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(gender);
  }

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private sidebarService: SidebarService,
    private usuarioService: UsuarioService
  ) {
    this.usuario$ = new Observable<IUserDados | null>();
  }

  ngOnInit(): void {
    const userId = this.route.snapshot.paramMap.get('id') || this.authService.currentUser?.uid;

    if (!userId) {
      console.error('UserID é undefined');
      return;
    }

    this.uid = userId;

    // Iniciar a assinatura para o Observable do usuário.
    this.usuario$ = this.usuarioService.getUsuario(userId).pipe(
      tap(user => console.log('Usuário recuperado do serviço:', user)), // Debugging antes da transformação.
      map(user => {
        // Verificar se user.firstLogin é uma instância de Timestamp e converter para Date.
        if (user && user.firstLogin instanceof Timestamp) {
          console.log('Convertendo firstLogin de Timestamp para Date');
          user.firstLogin = user.firstLogin.toDate();
        }
        return user;
      }),
      tap(user => {
        // Debugging após a transformação.
        console.log('Usuário após processamento:', user);
        if (user) {
          this.isSidebarVisible = user.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
          console.log('Estado da Sidebar definido para:', this.isSidebarVisible);
        }
      }),
      tap({
        error: error => console.error('Erro ao recuperar usuário:', error), // Capturar e logar possíveis erros.
        complete: () => console.log('Observable de usuário completado') // Opcional: Logar a conclusão do Observable.
      })
    );

    // Iniciar a assinatura para a visibilidade da sidebar.
    this.sidebarSubscription = this.sidebarService.isSidebarVisible$.subscribe(
      (isVisible) => {
        this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
        console.log('Visibilidade da Sidebar atualizada para:', isVisible ? 'Aberta' : 'Fechada');
      }
    );
  }
  getCoupleDescription(gender: string | undefined, partner1Orientation: string | undefined, partner2Orientation: string | undefined): string {
    if (gender === 'casal-ele-ele') {
      return `Ele ${this.getOrientationDescription(partner1Orientation)} / Ele ${this.getOrientationDescription(partner2Orientation)}`;
    } else if (gender === 'casal-ele-ela') {
      return `Ele ${this.getOrientationDescription(partner1Orientation)} / Ela ${this.getOrientationDescription(partner2Orientation)}`;
    } else if (gender === 'casal-ela-ela') {
      return `Ela ${this.getOrientationDescription(partner1Orientation)} / Ela ${this.getOrientationDescription(partner2Orientation)}`;
    } else {
      return '';
    }
  }

  getOrientationDescription(orientation: string | undefined): string {
    switch (orientation) {
      case 'bissexual':
        return 'bissexual';
      case 'homossexual':
        return 'homossexual';
      case 'heterossexual':
        return 'heterossexual';
      case 'pansexual':
        return 'pansexual';
      default:
        return '';
    }
  }

  ngOnDestroy(): void {
    this.sidebarSubscription?.unsubscribe();
  }

  isOnOwnProfile(): boolean {
    return this.uid === this.authService.currentUser?.uid;
  }

}




