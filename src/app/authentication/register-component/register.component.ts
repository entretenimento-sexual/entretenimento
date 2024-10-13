// src\app\authentication\register-component\register.component.ts
import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { RegisterService } from 'src/app/core/services/autentication/register.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ValidatorService } from 'src/app/core/services/data-handling/validator.service';
import { MatDialog } from '@angular/material/dialog';
import { TermosECondicoesComponent } from 'src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component';

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class RegisterComponent implements OnInit {
  registerForm!: FormGroup; // O FormGroup é inicializado corretamente no ngOnInit
  public formSubmitted: boolean = false;
  public isLoading: boolean = false;
  public isLockedOut: boolean = false;
  private failedAttempts: number = 0;
  private maxAttempts: number = 5;
  private lockoutTime: number = 30000; // Tempo de bloqueio em milissegundos (30 segundos)

  constructor(
    private formBuilder: FormBuilder,
    private registerService: RegisterService,
    private emailVerificationService: EmailVerificationService,
    private errorNotification: ErrorNotificationService,
    private dialog: MatDialog
  ) { }

  ngOnInit(): void {
    this.initForm();
    this.registerForm.statusChanges.subscribe(status => {
      console.log('Form status:', status); // Isso deve imprimir 'VALID' ou 'INVALID'
      // Verifique o estado individual de cada campo
      console.log('Nickname status:', this.registerForm.get('nickname')?.status);
      console.log('Email status:', this.registerForm.get('email')?.status);
      console.log('Password status:', this.registerForm.get('password')?.status);
      console.log('Estado status:', this.registerForm.get('estado')?.status);
      console.log('Municipio status:', this.registerForm.get('municipio')?.status);
      console.log('Aceitar Termos status:', this.registerForm.get('aceitarTermos')?.status);
    });
  }

  // Inicializa o formulário no ngOnInit
  private initForm(): void {
    this.registerForm = this.formBuilder.group({
      nickname: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(25)]],
      email: ['', [Validators.required, ValidatorService.emailValidator()]],
      password: ['', [Validators.required, ValidatorService.passwordValidator()]], // Validador de senha personalizado
      aceitarTermos: [false, Validators.requiredTrue]
    });
  }

  // Método chamado ao submeter o formulário
  async onRegister() {
    // Limpa as mensagens de erro
    this.clearErrorMessages();
    console.log('Form status:', this.registerForm.status);
    if (this.isLockedOut || this.registerForm.invalid) {
      return;
    }

    const { nickname, email, password } = this.registerForm.value;
    const userRegistrationData: IUserRegistrationData = {
      uid: '',
      email,
      nickname,
      photoURL: '',
      emailVerified: false,
      isSubscriber: false,
      firstLogin: new Date(),
      acceptedTerms: {
        accepted: true,
        date: new Date() // Data de aceitação dos termos
      },
    };
    //Ainda não implementada Política de Re-aceitação dos Termos
    this.isLoading = true;

    try {
      // Chama o serviço para registrar o usuário
      await this.registerService.registerUser(userRegistrationData, password);
      localStorage.setItem('tempNickname', nickname);
      this.formSubmitted = true;
      this.failedAttempts = 0; // Zera o contador de falhas
      this.registerForm.reset();
      this.errorNotification.showSuccess('Registro realizado com sucesso! Verifique seu e-mail.');
    } catch (error: any) {
      this.handleRegistrationError(error);
    } finally {
      this.isLoading = false;
    }
  }

  // Método para abrir o modal
  openTermsDialog(): void {
    this.dialog.open(TermosECondicoesComponent, {
      width: '600px', // Customize o tamanho do modal se necessário
    });
  }

  // Limpa as mensagens de erro
  clearErrorMessages(): void {
    this.errorNotification.clearError();
  }

  // Verifica se o apelido já está em uso e atualiza o estado do apelido
  checkNickname(): void {
    const nicknameControl = this.registerForm.get('nickname');
    if (nicknameControl && nicknameControl.value.length >= 4 && nicknameControl.value.length <= 25) {
      this.registerService.checkIfNicknameExists(nicknameControl.value).then(exists => {
        if (exists) {
          nicknameControl.setErrors({ nicknameInUse: true }); // Define o erro diretamente no controle
        } else {
          nicknameControl.setErrors(null); // Limpa o erro se o apelido não estiver em uso
        }
      });
    }
  }

  // Método para reenviar o e-mail de verificação
  async resendVerificationEmail(): Promise<void> {
    try {
      await this.emailVerificationService.resendVerificationEmail();
      this.errorNotification.showSuccess(`E-mail de verificação reenviado para ${this.registerForm.get('email')?.value}. Verifique sua caixa de entrada.`);
    } catch (error) {
      this.errorNotification.showError('Erro ao reenviar o e-mail de verificação.');
    }
  }

  // Lida com erros de registro
  handleRegistrationError(error: any): void {
    this.failedAttempts++;

    if (this.failedAttempts >= this.maxAttempts) {
      this.lockForm();
    }

    // Tratamento de erros baseado no código retornado
    if (error && error.code) {
      switch (error.message) {
        case 'auth/weak-password':
          this.errorNotification.showError('A senha deve conter pelo menos 8 caracteres.');
          break;
        case 'auth/email-already-in-use':
          this.errorNotification.showError('Este e-mail já está em uso. Verifique sua caixa de entrada.');
          break;
        case 'auth/invalid-email':
          this.errorNotification.showError('Endereço de e-mail inválido.');
          break;
        case 'Apelido já está em uso.':  // Trata o caso de apelido já estar em uso
          this.registerForm.get('nickname')?.setErrors({ nicknameInUse: true });
          break;
        case 'auth/network-request-failed':
          this.errorNotification.showError('Problema de conexão. Verifique sua rede.');
          break;
        default:
          // Exibe erro apenas se não for um erro já conhecido
          if (!['Apelido já está em uso.', 'auth/email-already-in-use'].includes(error.message)) {
            this.errorNotification.showError(`Erro desconhecido. Código: ${error.message}`);
          }
          break;
      }
    } else {
      this.errorNotification.showError('Erro inesperado. Tente novamente mais tarde.');
    }
  }


  // Bloqueia o formulário temporariamente após muitas tentativas falhas
  lockForm(): void {
    this.isLockedOut = true;
    this.errorNotification.showError('Muitas tentativas. Tente novamente em 30 segundos.');

    setTimeout(() => {
      this.isLockedOut = false;
      this.failedAttempts = 0;
    }, this.lockoutTime);
  }
}
