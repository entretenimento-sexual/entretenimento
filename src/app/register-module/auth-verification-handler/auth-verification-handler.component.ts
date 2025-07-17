// src\app\authentication\auth-verification-handler\auth-verification-handler.component.ts
import { Component, OnInit, OnDestroy, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { first, Subject, switchMap, tap } from 'rxjs';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { FirestoreService } from 'src/app/core/services/data-handling/firestore.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';
import { getAuth } from 'firebase/auth';
import { LoginService } from 'src/app/core/services/autentication/login.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Component({
    selector: 'app-auth-verification-handler',
    templateUrl: './auth-verification-handler.component.html',
    styleUrls: ['./auth-verification-handler.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
  })

export class AuthVerificationHandlerComponent implements OnInit, OnDestroy {
  public isLoading = true;
  public showSubscriptionOptions = false;
  public mode: string = '';
  public oobCode: string = '';
  public newPassword: string = '';
  public confirmPassword: string = '';
  public showPassword: boolean = false;
  public showConfirmPassword: boolean = false;
  public showVerificationErrorModal: boolean = false;
  public shouldShowRecoveryLink: boolean = false;

  // Variável única para mensagens de sucesso e erro
  public message: string = '';

  public gender: string = '';
  public orientation: string = '';
  public selectedEstado: string = '';
  public selectedMunicipio: string = '';
  public estados: any[] = [];
  public municipios: any[] = [];
  public selectedFile: File | null = null;
  public isUploading: boolean = false;
  public progressValue: number = 0;
  public uploadMessage: string = '';
  public formErrors: { [key: string]: string } = {
    gender: '',
    orientation: '',
    selectedFile: '',
    estado: '',
    municipio: '',
  };

  private ngUnsubscribe: Subject<void> = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private emailVerificationService: EmailVerificationService,
    private loginService: LoginService,
    private firestoreService: FirestoreService,
    private emailInputModalService: EmailInputModalService,
    private firestoreUserQuery: FirestoreUserQueryService,
    private globalErrorHandlerService: GlobalErrorHandlerService,
    private authService: AuthService,
    private router: Router,
    private ngZone: NgZone
  ) { }

  ngOnInit(): void {
    this.route.queryParams.subscribe(async params => {
      this.mode = params['mode'];
      this.oobCode = params['oobCode'];
      console.log('Modo atual:', this.mode);

      if (this.oobCode) {
        //this.oobCodeService.setCode(this.oobCode);
      } else {
        this.message = 'Código inválido.';
        this.isLoading = false;
        return;
      }

      // Aguardar autenticação para garantir que o UID esteja disponível
      this.authService.user$.pipe(first()).subscribe((userData: IUserDados | null) => {
        if (userData) {
          if (this.mode === 'verifyEmail') {
            this.handleEmailVerification();
          } else if (this.mode === 'resetPassword') {
            this.isLoading = false;
          }
        } else {
          this.message = 'Erro: Nenhum usuário autenticado.';
          this.isLoading = false;
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  async handleEmailVerification(): Promise<void> {
    this.isLoading = true;

    try {
      // Obtendo diretamente o usuário autenticado do Firebase usando ferramentas nativas
      const auth = getAuth(); // Obtém a instância do Firebase Auth
      const currentUser = auth.currentUser; // Obtém o usuário atual

      if (!currentUser || !currentUser.uid) {
        this.message = 'Erro: UID do usuário não encontrado.';
        this.isLoading = false;
        return;
      }

      // Verifica se o e-mail já foi verificado anteriormente
      const userData = await this.firestoreUserQuery.getUser(currentUser.uid).pipe(first()).toPromise();

      if (userData?.emailVerified) {
        this.message = 'Seu e-mail já foi verificado anteriormente. Faça login para continuar.';
        this.router.navigate(['/login']); // Redireciona para a tela de login
        return;
      }

      // Verificar o email com o código oobCode
      await this.emailVerificationService.verifyEmail(this.oobCode);

      this.message = 'E-mail verificado com sucesso! Faça login para continuar.';
      this.router.navigate(['/login']);  // Redireciona para login após verificação
    } catch (error) {
      this.message = 'Erro ao verificar o e-mail.';
      console.log('Erro ao verificar o e-mail:', error);
    } finally {
      this.isLoading = false;
    }
  }

  // Outros métodos permanecem inalterados...
  goToFinalizarCadastro(): void {
    this.router.navigate(['/finalizar-cadastro']);
  }

  resendVerificationEmail(): void {
    this.isLoading = true;
    this.emailVerificationService.resendVerificationEmail().subscribe({
      next: (message) => {
        this.message = message;
      },
      error: (error) => {
        this.message = 'Falha ao reenviar o e-mail de verificação.';
        console.log('Erro ao reenviar o e-mail:', error);
      },
      complete: () => {
        this.isLoading = false;
      }
    });
  }


  redirectToFAQ(): void {
    this.router.navigate(['/faq']); // Redireciona para a página de FAQ
  }

  closeModal(): void {
    this.showVerificationErrorModal = false;
  }

  async onSubmit(): Promise<void> {
    this.message = '';  // Limpa mensagens anteriores
    console.log('Submissão iniciada com modo:', this.mode);  // Debug log

    if (this.mode === 'resetPassword') {
      await this.resetPassword();
    } else if (this.mode === 'verifyEmail') {
      this.finishRegistration();
    }
  }

  openPasswordRecoveryModal(): void {
    this.emailInputModalService.openModal();
  }

  async resetPassword(): Promise<void> {
    console.log('Tentando redefinir a senha...');  // Debug log
    this.isLoading = true;
    this.shouldShowRecoveryLink = false;

    if (this.newPassword !== this.confirmPassword) {
      this.message = 'As senhas não coincidem.';
      console.log('Erro: Senhas não coincidem');  // Debug log
      this.isLoading = false;
      return;
    }
    if (this.newPassword.length < 8) {
      this.message = 'A senha deve ter pelo menos 8 caracteres.';
      this.isLoading = false;
      return;
    }

    try {
      await this.loginService.confirmPasswordReset(this.oobCode, this.newPassword);
      this.message = 'Senha redefinida com sucesso! Você será redirecionado para a página de login em breve.';

      this.newPassword = '';
      this.confirmPassword = '';

      this.ngZone.run(() => {
        setTimeout(() => this.router.navigate(['/login']), 3000);
      });
    } catch (error: any) {
      this.handlePasswordResetError(error);

    } finally {
      this.isLoading = false;
    }
  }

  private handlePasswordResetError(error: any): void {
    const resetErrors = ['auth/expired-action-code', 'auth/invalid-action-code'];

    if (resetErrors.includes(error.code)) {
      this.shouldShowRecoveryLink = true;
      this.message = error.code === 'auth/expired-action-code' ?
        'O link de redefinição de senha expirou.' :
        'O código de redefinição é inválido ou já foi usado.';
    } else {
      this.shouldShowRecoveryLink = true;
      this.message = 'Erro ao redefinir a senha.';
    }
  }

  // Funções de cadastro
  checkFieldValidity(field: string, value: any): void {
    if (!value) {
      this.formErrors[field] = `O campo ${field} é obrigatório.`;
    } else {
      this.formErrors[field] = '';
    }
  }

  isFieldInvalid(field: string): boolean {
    return !!this.formErrors[field];
  }

  uploadFile(event: any): void {
    this.selectedFile = event.target.files[0];
    this.checkFieldValidity('selectedFile', this.selectedFile);
  }

  goToSubscription(): void {
    this.router.navigate(['/subscription-plan']);
  }

  continueWithoutSubscription(): void {
    this.router.navigate(['/dashboard/principal']);
  }

  // Função para alternar a visibilidade da senha
  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  // Finalização do cadastro
  finishRegistration(): void {
    this.message = 'Processando cadastro...'; // Feedback inicial

    this.authService.getLoggedUserUID$().pipe(
      switchMap((uid) => {
        if (!uid) {
          this.message = 'Erro ao identificar o usuário. Por favor, tente novamente.';
          throw new Error('UID do usuário não encontrado.');
        }

        // Verifica se os dados estão no cache antes de buscar no Firestore
        return this.firestoreUserQuery.getUser(uid).pipe(
          switchMap((existingUserData: IUserDados | null) => {
            if (!existingUserData) {
              this.message = 'Erro ao buscar dados do usuário. Tente novamente.';
              throw new Error('Dados do usuário não encontrados no Firestore.');
            }

            const userData: IUserRegistrationData = {
              uid,
              emailVerified: true,
              email: existingUserData.email || '',
              nickname: existingUserData.nickname || '',
              isSubscriber: existingUserData.isSubscriber || false,
              firstLogin: existingUserData.firstLogin || new Date(),
              gender: this.gender,
              orientation: this.orientation,
              estado: this.selectedEstado,
              municipio: this.selectedMunicipio,
              acceptedTerms: {
                accepted: true,
                date: new Date()
              }
            };

            // Salva os dados no Firestore
            return this.firestoreService.saveInitialUserData(uid, userData).pipe(
              tap(() => {
                this.cacheUserData(userData); // Atualiza o cache local
              })
            );
          })
        );
      })
    ).subscribe({
      next: () => {
        this.message = 'Cadastro finalizado com sucesso!';
        console.log('Dados do usuário salvos com sucesso.');

        this.showSubscriptionOptions = true;

        setTimeout(() => {
          this.ngZone.run(() => this.router.navigate(['/dashboard/principal']));
        }, 3000);
      },
      error: (error: any) => {
        this.message = 'Erro ao processar o cadastro. Por favor, tente novamente.';
        console.log('Erro no processo de cadastro:', error);
        this.globalErrorHandlerService.handleError(error); // Centraliza o tratamento do erro
      }
    });
  }
  // Método para armazenar os dados do usuário no cache
  private cacheUserData(userData: IUserRegistrationData): void {
    if (!userData || !userData.uid) {
      console.log('Dados inválidos fornecidos para cacheUserData:', userData);
      return;
    }
    this.firestoreUserQuery.updateUserInStateAndCache(userData.uid, userData); // Atualiza cache e estado
    console.log(`[AuthVerificationHandlerComponent] Dados do usuário ${userData.uid} armazenados no cache.`);
  }
}
