//src\app\core\services\autentication\auth.service.ts
import { Injectable } from '@angular/core';
import { from, Observable, of, ReplaySubject } from 'rxjs';
import { catchError, tap, switchMap, first } from 'rxjs/operators';
import { IUserDados } from '../../interfaces/iuser-dados';
import { Router } from '@angular/router';

import { getAuth, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';

import { FirestoreService } from './firestore.service';
import { EmailVerificationService } from './email-verification.service';
import { UsuarioService } from '../usuario.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { IUserRegistrationData } from 'src/app/post-verification/iuser-registration-data';

const auth = getAuth();

@Injectable({
  providedIn: 'root'
})

export class AuthService {

  private userSubject = new ReplaySubject<IUserDados | null>(1);
  private currentUserValue: IUserDados | null = null;

  // Observable do usuário
  user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(
    private router: Router,
    private firestoreService: FirestoreService,
    private emailVerificationService: EmailVerificationService,
    private usuarioService: UsuarioService,
    private userProfileService: UserProfileService
  ) {
    this.initAuthStateListener();
  }

  // Inicia o ouvinte de mudança de autenticação
  private initAuthStateListener(): void {
    auth.onAuthStateChanged(user => {
      console.log('Estado de autenticação mudou:', user);
      if (user) {
        // Se um usuário estiver autenticado, obtemos os dados completos do usuário
        this.usuarioService.getUsuario(user.uid).subscribe(userData => {
          console.log('Dados do usuário atualizados:', userData);
          // Atualiza o valor atual e emite os dados através do userSubject
          this.currentUserValue = userData;
          this.userSubject.next(userData);
        }, error => {
          // Em caso de erro, registra o erro e define os valores como null
          console.error('Erro ao buscar dados do usuário:', error);
          this.currentUserValue = null;
          this.userSubject.next(null);
        });
      } else {
        // Se não houver usuário autenticado, define os valores como null
        console.log('Nenhum usuário autenticado.');
        this.currentUserValue = null;
        this.userSubject.next(null);
      }
    });
  }

  getUserAuthenticated(): Observable<IUserDados | null> {
    return this.user$.pipe(first()); // Pega apenas o primeiro valor emitido
  }

  getLoggedUserUID(): string | null {
    return this.currentUserValue ? this.currentUserValue.uid : null;
  }

  async register(email: string, password: string, userRegistrationData: IUserRegistrationData, userPreferences: any): Promise<void> {
    console.log('Iniciando registro para o email:', email);
    const userCredential = await createUserWithEmailAndPassword(getAuth(), email, password);
    const user = userCredential.user;
    if (!user) throw new Error('Falha ao criar usuário.');

    if (!user.uid) {
      throw new Error('UID do usuário não está disponível após a criação da conta.');
    }

    // Salvar dados adicionais do usuário no Firestore
    if (user.uid) {
      userRegistrationData.uid = user.uid;
      userRegistrationData.firstLogin = Timestamp.fromDate(new Date());
      await this.emailVerificationService.sendEmailVerification(user);

      const userData: IUserRegistrationData = {
        ...userRegistrationData,
        uid: user.uid,
        emailVerified: false,
        isSubscriber: false,
        estado: userRegistrationData.estado,
        municipio: userRegistrationData.municipio,
        // outros campos conforme necessário
      };

      await this.firestoreService.saveInitialUserData(user.uid, userRegistrationData);
    } else {
      console.error('UID é undefined');
      // Lide com o caso de uid não definido conforme necessário
    }
  }

  async verifyEmail(actionCode: string): Promise<void> {
    await this.emailVerificationService.verifyEmail(actionCode);
    // Aqui, você pode atualizar o status de verificação de e-mail no Firestore se necessário
    // E redirecionar o usuário para a página de destino
    this.router.navigate(['/email-verified']);
  }


  private async saveInitialUserData(uid: string, userData: IUserRegistrationData): Promise<void> {
    await this.firestoreService.saveInitialUserData(uid, userData);
  }

  async resendVerificationEmail(): Promise<void> {
    const currentUser = getAuth().currentUser;
    if (currentUser) {
      await this.emailVerificationService.sendEmailVerification(currentUser);
    } else {
      throw new Error('Nenhum usuário autenticado encontrado');
    }
  }

  async saveUserToFirestore(userRegistrationData: IUserRegistrationData): Promise<void> {
    if (!userRegistrationData.uid) {
      console.error('UID do usuário não está definido');
      return;
    }

    try {
      // Assumindo que userRegistrationData já inclui o uid e outros campos necessários
      await this.firestoreService.saveInitialUserData(userRegistrationData.uid, userRegistrationData);
    } catch (error) {
      console.error('Erro ao salvar usuário no Firestore:', error);
      throw error;
    }
  }

  // Checa se o nickname existe
  async checkIfNicknameExists(nickname: string): Promise<boolean> {
    return this.firestoreService.checkIfNicknameExists(nickname);
  }

  // Desloga o usuário
  logout(): Observable<void> {
    console.log('Iniciando processo de logout');
    return from(signOut(auth)).pipe(
      tap(() => {
        this.userSubject.next(null);
        console.log('Usuário deslogado com sucesso.');
      }),
      catchError(error => {
        console.error('Erro ao deslogar:', error);
        return of(undefined);
      })
    );
  }

  // Verifica se o usuário está autenticado
  isUserAuthenticated(): boolean {
    return !!this.currentUserValue;
  }

  // Retorna o usuário atual
  get currentUser(): IUserDados | null {
    return this.currentUserValue;
  }

  // Busca usuário pelo ID
  async getUserById(uid: string): Promise<IUserDados | null> {
    console.log("Chamando getUserById no AuthService com UID:", uid);
    const userData = await this.userProfileService.getUserById(uid);
    console.log('Dados recuperados do Firestore:', userData);
    return userData;
  }

  async login(email: string, password: string): Promise<IUserDados | null | undefined> {
    console.log('Tentativa de login para o email:', email);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      if (user) {
        console.log('Usuário logado com sucesso:', user);
        return this.usuarioService.getUsuario(user.uid).pipe(
          first()
        ).toPromise();
      } else {
        console.warn('Dados do usuário não encontrados após o login.');
        return null;
      }
    } catch (error) {
      console.error('Erro ao fazer login:', error);
      throw error;
    }
  }
}
