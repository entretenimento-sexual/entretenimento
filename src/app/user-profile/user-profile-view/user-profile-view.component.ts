import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SidebarService } from 'src/app/core/services/sidebar.service';
import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { selectUserById } from 'src/app/store/selectors/user.selectors';
import { observeUserChanges } from 'src/app/store/actions/user.actions';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { Timestamp } from 'firebase/firestore';

enum SidebarState { CLOSED, OPEN }

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css']
})

export class UserProfileViewComponent implements OnInit, OnDestroy {

  private sidebarSubscription?: Subscription;
  public isSidebarVisible = SidebarState.CLOSED;
  public uid!: string | null;
  public preferences: any;
  public currentUser: IUserDados | null = null; // Armazena o usuário autenticado

  // Observable para armazenar o usuário carregado do Store
  public usuario$: Observable<IUserDados | null> = new Observable<IUserDados | null>();

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private sidebarService: SidebarService,
    private store: Store<AppState> // Injeta o Store para acessar o estado global
  ) { }

  ngOnInit(): void {
    // Centralizar a assinatura do usuário autenticado
    this.authService.user$.pipe(
      tap(user => this.currentUser = user) // Armazena o usuário autenticado
    ).subscribe();

    // Recupera o ID do usuário atual ou o ID da rota
    const routeUid = this.route.snapshot.paramMap.get('id');
    this.uid = routeUid || this.currentUser?.uid || null; // Garante que 'this.uid' seja string | null

    if (this.uid) {
      // Dispara a ação para observar mudanças no usuário
      this.store.dispatch(observeUserChanges({ uid: this.uid }));

      // Usa o Store para selecionar o usuário com base no UID
      this.usuario$ = this.store.select(selectUserById(this.uid)).pipe(
        tap(user => {
          console.log('Usuário recuperado do Store:', user);
          if (user) {
            // Cria uma cópia do objeto e converte firstLogin se necessário
            let userCopy = { ...user };
            if (userCopy.firstLogin) {
              if (userCopy.firstLogin instanceof Timestamp) {
                console.log('Convertendo firstLogin de Timestamp para Date');
                userCopy.firstLogin = userCopy.firstLogin.toDate();
              } else if (typeof userCopy.firstLogin === 'string' || userCopy.firstLogin instanceof Date) {
                console.log('firstLogin já é uma Date ou string válida');
              } else {
                console.error('Formato inválido para firstLogin:', userCopy.firstLogin);
              }
            } else {
              console.log('firstLogin não está definido');
            }

            // Define o estado da Sidebar com base no estado armazenado
            this.isSidebarVisible = userCopy.isSidebarOpen ? SidebarState.OPEN : SidebarState.CLOSED;
            console.log('Estado da Sidebar definido para:', this.isSidebarVisible);
          }
        })
      );
    } else {
      console.error('UserID é undefined');
    }

    // Iniciar a assinatura para a visibilidade da sidebar
    this.sidebarSubscription = this.sidebarService.isSidebarVisible$.subscribe(
      isVisible => {
        this.isSidebarVisible = isVisible ? SidebarState.OPEN : SidebarState.CLOSED;
        console.log('Visibilidade da Sidebar atualizada para:', isVisible ? 'Aberta' : 'Fechada');
      }
    );
  }

  objectKeys(obj: any): string[] {
    return Object.keys(obj).filter(key => obj[key] && obj[key].value);
  }

  isCouple(gender: string | undefined): boolean {
    if (!gender) {
      return false;
    }
    return ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(gender);
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

  isOnOwnProfile(): boolean {
    return this.currentUser?.uid === this.uid; // Evita a necessidade de múltiplas assinaturas
  }

  ngOnDestroy(): void {
    this.sidebarSubscription?.unsubscribe(); // Desinscrever-se corretamente
  }
}
