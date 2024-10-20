// src\app\authentication\register-component\register.component.ts
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { RegisterService } from 'src/app/core/services/autentication/register.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AbstractControl, FormBuilder, FormGroup, ValidatorFn, Validators } from '@angular/forms';
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
  // Inicializando propriedades com valores padrão
  registerForm!: FormGroup; // Formulário de registro
  public formSubmitted: boolean = false; // Verifica se o formulário foi enviado com sucesso
  public isLoading: boolean = false; // Indica se o registro está em andamento
  public isLockedOut: boolean = false; // Indica se o formulário está bloqueado por falhas
  private failedAttempts: number = 0; // Contador de tentativas de registro com falhas
  private maxAttempts: number = 5; // Número máximo de tentativas antes de bloquear
  private lockoutTime: number = 30000; // Tempo de bloqueio em milissegundos (30 segundos)

  constructor(
    private formBuilder: FormBuilder,
    private registerService: RegisterService,
    private emailVerificationService: EmailVerificationService,
    private errorNotification: ErrorNotificationService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) { }

  // Inicializa o formulário e monitora mudanças no valor dos campos
  ngOnInit(): void {
    this.initForm(); // Inicializa o formulário
    this.monitorFormChanges(); // Monitora as mudanças no formulário
  }

  private initForm(): void {
    this.registerForm = this.formBuilder.group({
      apelidoPrincipal: [
        '',
        [Validators.required, Validators.minLength(3), Validators.maxLength(12), this.nicknameValidator()]
      ],
      complementoApelido: ['', [Validators.maxLength(12), this.complementNicknameValidator()]],
      email: ['', [Validators.required, ValidatorService.emailValidator()]],
      password: ['', [Validators.required, ValidatorService.passwordValidator()]],
      aceitarTermos: [false, Validators.requiredTrue]
    });
  }

  // Validador personalizado para o apelido
  private nicknameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const nickname = control.value;
      const nicknameRegex = /^[a-zA-Z0-9!@#$%^&*()_+\-=]{3,12}$/;
      return nickname && !nicknameRegex.test(nickname) ? { 'invalidNickname': { value: nickname } } : null;
    };
  }

  private complementNicknameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const complemento = control.value;
      // Permitir letras, números e caracteres especiais, sem exigir tamanho mínimo
      const nicknameRegex = /^[a-zA-Z0-9!@#$%^&*()_+\-=]{0,12}$/; // 0 a 12 caracteres válidos
      return complemento && !nicknameRegex.test(complemento) ? { 'invalidNickname': { value: complemento } } : null;
    };
  }

  // Monitora mudanças no apelido principal e verifica se já existe a partir do 4º caractere
  private monitorFormChanges(): void {
    const apelidoControl = this.registerForm.get('apelidoPrincipal');
    const complementoApelidoControl = this.registerForm.get('complementoApelido');

    // Monitorar alterações tanto no apelido principal quanto no complemento
    const monitorApelidoChanges = () => {
      const apelidoPrincipal = apelidoControl?.value || '';
      const complementoApelido = complementoApelidoControl?.value || '';

      // Verifica se o apelido principal tem pelo menos 4 caracteres
      if (apelidoPrincipal.length >= 4) {
        const nickname = `${apelidoPrincipal} ${complementoApelido}`.trim(); // Concatena apelido principal e complemento
        console.log(`Verificando se o apelido completo "${nickname}" já existe...`);

        this.registerService.checkIfNicknameExists(nickname).then(exists => {
          if (exists) {
            if (apelidoControl) {
            apelidoControl.setErrors({ nicknameExists: true });
            apelidoControl.markAsTouched();
          }
            console.log(`Apelido "${nickname}" já existe.`);
          } else {
            if (apelidoControl) {
              apelidoControl.setErrors(null);
            }

            console.log(`Apelido "${nickname}" disponível.`);
          }

          this.cdr.markForCheck(); // Força a detecção de mudanças

        }).catch(error => {
          console.error('Erro ao verificar apelido:', error);
          this.errorNotification.showError('Erro ao verificar apelido. Tente novamente mais tarde.');
        });
      } else {
        if (apelidoControl) {
          apelidoControl.setErrors(null); 
        } // Limpa erros enquanto digita antes de atingir o limite de 4 caracteres
        console.log('Apelido principal com menos de 4 caracteres. Limpa erros.');
        this.cdr.markForCheck(); // Força a detecção de mudanças
      }
    };

    apelidoControl?.valueChanges.subscribe(() => monitorApelidoChanges());
    complementoApelidoControl?.valueChanges.subscribe(() => monitorApelidoChanges());
  }

  // Método chamado ao submeter o formulário
  async onRegister() {
    // Limpa as mensagens de erro
    this.clearErrorMessages();
    console.log('Form status:', this.registerForm.status);
    if (this.isLockedOut || this.registerForm.invalid) {
      return;
    }

    const { apelidoPrincipal, complementoApelido, email, password } = this.registerForm.value;
    const nickname = `${apelidoPrincipal} ${complementoApelido}`.trim(); // Junta o apelido principal e o complemento

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
          this.errorNotification.showError(`Erro desconhecido. Código: ${error.message}`);
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
