// src\app\authentication\auth-verification-handler\auth-verification-handler.component.ts
import { Component, OnInit, OnDestroy, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { OobCodeService } from 'src/app/core/services/autentication/oobCode.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { first, Subject } from 'rxjs';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { EmailInputModalService } from 'src/app/core/services/autentication/email-input-modal.service';

@Component({
  selector: 'app-auth-verification-handler',
  templateUrl: './auth-verification-handler.component.html',
  styleUrls: ['./auth-verification-handler.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
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
    private userProfileService: UserProfileService,
    private oobCodeService: OobCodeService,
    private firestoreService: FirestoreService,
    private emailInputModalService: EmailInputModalService,
    private usuarioService: UsuarioService,
    private authService: AuthService,
    private router: Router,
    private ngZone: NgZone
  ) { }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.mode = params['mode'];
      this.oobCode = params['oobCode'];
      console.log('Modo atual:', this.mode);

      if (this.oobCode) {
        this.oobCodeService.setCode(this.oobCode);
      } else {
        this.message = 'Código inválido.';
        this.isLoading = false;
        return;
      }

      if (this.mode === 'verifyEmail') {
        this.handleEmailVerification();
      } else if (this.mode === 'resetPassword') {
        this.isLoading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  async handleEmailVerification(): Promise<void> {
    this.isLoading = true;
    try {
      const isVerified = await this.emailVerificationService.reloadCurrentUser();

      // Verifica se o status do email é "partial" ou "true"
      const currentUserUid = this.authService.getLoggedUserUID();
      const userData = await this.usuarioService.getUsuario(currentUserUid!).pipe(first()).toPromise();

      if (userData?.emailVerified === 'partial') {
        this.message = 'Seu e-mail já foi verificado anteriormente. Faça login para continuar.';
        this.router.navigate(['/login']); // Redireciona para a tela de login
        return;
      }

      // Caso o email ainda não tenha sido verificado
      await this.emailVerificationService.verifyEmail(this.oobCode);

      if (isVerified) {
        await this.emailVerificationService.updateEmailVerificationStatus(currentUserUid!, 'partial');
        this.message = 'E-mail verificado com sucesso! Faça login para continuar.';
        this.router.navigate(['/login']);  // Redireciona para login após verificação
      } else {
        this.message = 'Falha na verificação do e-mail.';
      }
    } catch (error) {
      this.message = 'Erro ao verificar o e-mail.';
      console.error('Erro ao verificar o e-mail:', error);
    } finally {
      this.isLoading = false;
    }
  }


  goToFinalizarCadastro(): void {
    this.router.navigate(['/finalizar-cadastro']);
  }

  resendVerificationEmail(): void {
    this.isLoading = true;
    this.emailVerificationService.resendVerificationEmail().then(() => {
      this.message = 'E-mail de verificação reenviado com sucesso!';
      this.isLoading = false;
    }).catch((error) => {
      this.message = 'Falha ao reenviar o e-mail de verificação.';
      console.error('Erro ao reenviar o e-mail:', error);
      this.isLoading = false;
    });
  }

   redirectToFAQ(): void {
    this.router.navigate(['/faq']); // Redireciona para a página de FAQ
  }

  closeModal(): void {
    this.showVerificationErrorModal = false;
  }

  // Centraliza a lógica de submissão
  async onSubmit(): Promise<void> {
    this.message = '';  // Limpa mensagens anteriores
    console.log('Submissão iniciada com modo:', this.mode);  // Debug log

    if (this.mode === 'resetPassword') {
      await this.resetPassword();
    } else if (this.mode === 'verifyEmail') {
      this.finishRegistration();
    }
  }

  // Abrir o modal de recuperação de senha
  openPasswordRecoveryModal(): void {
    this.emailInputModalService.openModal();
  }

  // Reset de senha
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
    if (this.newPassword.length < 6) {
      this.message = 'A senha deve ter pelo menos 8 caracteres.';
      this.isLoading = false;
      return;
    }

    try {
      await this.authService.confirmPasswordReset(this.oobCode, this.newPassword);
      this.message = 'Senha redefinida com sucesso! Você será redirecionado para a página de login em breve.';

      // Limpa os campos de senha
      this.newPassword = '';
      this.confirmPassword = '';

      // Redireciona após 4 segundos
      this.ngZone.run(() => {
        setTimeout(() => this.router.navigate(['/login']), 3000);
      });
    } catch (error: any) {
      this.handlePasswordResetError(error);

    } finally {
      this.isLoading = false;
    }
  }

  // Função que verifica o erro e configura a exibição do link
  // Função que verifica o erro e configura a exibição do link
  private handlePasswordResetError(error: any): void {
    const resetErrors = ['auth/expired-action-code', 'auth/invalid-action-code'];

    // Verifica se o código de erro é um dos erros de redefinição
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
    this.message = 'Cadastro finalizado com sucesso!';
    console.log('Cadastro finalizado!');

    const uid = this.authService.getLoggedUserUID();
    if (uid) {
      // Primeiramente, buscamos os dados existentes do usuário no Firestore
      this.userProfileService.getUserById(uid).then((existingUserData: IUserDados | null) => {
        if (existingUserData) {
          // Mantemos o email e nickname salvos anteriormente
          const userData: IUserRegistrationData = {
            uid: uid,
            emailVerified: true,
            email: existingUserData.email || '',  // Mantém o email existente
            nickname: existingUserData.nickname || '',  // Mantém o nickname existente
            isSubscriber: existingUserData.isSubscriber || false,  // Mantém a informação de assinante
            firstLogin: existingUserData.firstLogin || new Date(),  // Mantém a data do primeiro login
            gender: this.gender,
            orientation: this.orientation,
            estado: this.selectedEstado,
            municipio: this.selectedMunicipio
          };

          // Atualizamos os dados do usuário no Firestore
          this.firestoreService.saveInitialUserData(uid, userData)
            .then(() => {
              this.message = 'Cadastro finalizado com sucesso!';
              console.log('Dados salvos no Firestore:', userData);

              // Mostra as opções de assinatura após salvar os dados
              this.showSubscriptionOptions = true;

              // Exibe uma mensagem de sucesso e redireciona após um tempo
              setTimeout(() => {
                this.ngZone.run(() => this.router.navigate(['/dashboard/principal']));
              }, 3000); // Redireciona após 5 segundos
            })
            .catch((error: any) => {
              this.message = 'Erro ao salvar os dados.';
              console.error('Erro ao salvar dados no Firestore:', error);
            });
        } else {
          this.message = 'Erro: Dados do usuário não encontrados.';
          console.error('Erro: Dados do usuário não encontrados.');
        }
      }).catch((error: any) => {
        this.message = 'Erro ao buscar dados do usuário.';
        console.error('Erro ao buscar dados do usuário no Firestore:', error);
      });
    } else {
      this.message = 'Erro: UID do usuário não encontrado.';
      console.error('Erro: UID do usuário não encontrado.');
    }
  }
}
