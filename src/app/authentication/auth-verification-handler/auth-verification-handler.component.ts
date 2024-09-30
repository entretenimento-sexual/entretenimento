// src\app\authentication\auth-verification-handler\auth-verification-handler.component.ts
import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { OobCodeService } from 'src/app/core/services/autentication/oobCode.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { Subject } from 'rxjs';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';
import { UserProfileService } from 'src/app/core/services/user-profile/user-profile.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-auth-verification-handler',
  templateUrl: './auth-verification-handler.component.html',
  styleUrls: ['./auth-verification-handler.component.css']
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
    private authService: AuthService,
    private router: Router,
    private ngZone: NgZone
  ) { }

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.mode = params['mode'];
      this.oobCode = params['oobCode'];

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

    this.loadEstados(); // Carrega os estados ao iniciar
  }

  async loadEstados() {
    try {
      const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados');
      this.estados = await response.json();
      this.estados.sort((a, b) => a.nome.localeCompare(b.nome)); // Ordena os estados
    } catch (error) {
      console.error('Erro ao carregar os estados:', error);
    }
  }

  async onEstadoChange() {
    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${this.selectedEstado}/municipios`);
      this.municipios = await response.json();
      this.municipios.sort((a, b) => a.nome.localeCompare(b.nome)); // Ordena os municípios
    } catch (error) {
      console.error('Erro ao carregar os municípios:', error);
    }
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  // Verificação de email
  async handleEmailVerification(): Promise<void> {
    this.isLoading = true;
    try {
      await this.emailVerificationService.verifyEmail(this.oobCode);
      const isVerified = await this.emailVerificationService.reloadCurrentUser();

      if (isVerified) {
        const currentUserUid = this.emailVerificationService.getCurrentUserUid();
        await this.emailVerificationService.updateEmailVerificationStatus(currentUserUid!, true);
        this.message = 'E-mail verificado com sucesso!';
        this.showSubscriptionOptions = true;
      } else {
        this.message = 'Falha na verificação do e-mail.';
        this.showVerificationErrorModal = true;
      }
    } catch (error) {
      this.message = 'Erro ao verificar o e-mail.';
      this.showVerificationErrorModal = true;
    } finally {
      this.isLoading = false;
    }
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

  // Reset de senha
  async resetPassword(): Promise<void> {
    console.log('Tentando redefinir a senha...');  // Debug log
    this.isLoading = true;

    if (this.newPassword !== this.confirmPassword) {
      this.message = 'As senhas não coincidem.';
      console.log('Erro: Senhas não coincidem');  // Debug log
      this.isLoading = false;
      return;
    }
    if (this.newPassword.length < 6) {
      this.message = 'A senha deve ter pelo menos 6 caracteres.';
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
        setTimeout(() => this.router.navigate(['/login']), 4000);
      });
    } catch (error: any) {
      if (error.code === 'auth/expired-action-code') {
        this.message = 'O link de redefinição expirou.';
      } else if (error.code === 'auth/invalid-action-code') {
        this.message = 'O código de redefinição é inválido ou já foi usado.';
      } else {
        this.message = 'Erro ao redefinir a senha.';
      }
    } finally {
      this.isLoading = false;
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
