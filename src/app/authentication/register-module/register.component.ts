// src\app\authentication\register-module\register.component.ts
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AbstractControl, FormBuilder, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { MatDialog } from '@angular/material/dialog';
import { TermosECondicoesComponent } from 'src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component';
import { Router } from '@angular/router';
import { first } from 'rxjs';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { RegisterService } from 'src/app/core/services/autentication/register/register.service';

@Component({
  selector: 'app-register-component',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
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
    private router: Router,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) { }

  // Inicializa o formulário e monitora mudanças no valor dos campos
  ngOnInit(): void {
    this.initForm(); // Inicializa o formulário
    this.monitorFormChanges(); // Monitora mudanças nos campos do formulário

    // Redireciona usuários autenticados para as rotas apropriadas
    this.authService.user$.pipe(first()).subscribe((user) => {
      if (user) {
        this.registerService.getUserProgress(user.uid).subscribe({
          next: (userData) => {
            if (!userData.emailVerified) {
              // E-mail não verificado, redireciona para a página de boas-vindas
              this.router.navigate(['/welcome']);
            } else if (!userData.gender || !userData.estado || !userData.municipio) {
              // Cadastro incompleto, redireciona para a finalização do cadastro
              this.router.navigate(['/finalizar-cadastro']);
            } else {
              // Cadastro completo, redireciona para o dashboard
              this.router.navigate(['/dashboard/principal']);
            }
          },
          error: (error) => {
            console.error('Erro ao carregar progresso do usuário:', error);
            this.errorNotification.showError('Erro ao verificar o progresso do cadastro.');
          },
        });
      }
    });
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
      const nickname = control.value; // Linha 61
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

    const monitorApelidoChanges = () => {
      const apelidoPrincipal = apelidoControl?.value || '';
      const complementoApelido = complementoApelidoControl?.value || '';
      const nickname = `${apelidoPrincipal} ${complementoApelido}`.trim(); // Concatena apelido principal e complemento

      if (apelidoPrincipal.length >= 4) {
        console.log(`Verificando se o apelido completo "${nickname}" já existe...`);

        this.registerService.checkIfNicknameExists(nickname).subscribe({
          next: (exists) => {
            if (exists) {
              apelidoControl?.setErrors({ nicknameExists: true });
              apelidoControl?.markAsTouched();
              console.log(`Apelido "${nickname}" já existe.`);
            } else {
              apelidoControl?.setErrors(null);
              console.log(`Apelido "${nickname}" disponível.`);
            }
            this.cdr.markForCheck(); // Força a detecção de mudanças
          },
          error: (error) => {
            console.error('Erro ao verificar apelido:', error);
            this.errorNotification.showError('Erro ao verificar apelido. Tente novamente mais tarde.');
          }
        });
      } else {
        apelidoControl?.setErrors(null); // Limpa erros enquanto digita antes de atingir o limite de 4 caracteres
        console.log('Apelido principal com menos de 4 caracteres. Limpa erros.');
        this.cdr.markForCheck(); // Força a detecção de mudanças
      }
    };

    apelidoControl?.valueChanges.subscribe(() => monitorApelidoChanges());
    complementoApelidoControl?.valueChanges.subscribe(() => monitorApelidoChanges());
  }


  // Método chamado ao submeter o formulário
  async onRegister() {
    // Limpa mensagens de erro anteriores
    this.clearErrorMessages();
    console.log('Início do registro. Form status:', this.registerForm.status);

    if (this.isLockedOut || this.registerForm.invalid) {
      this.errorNotification.showError('Por favor, corrija os erros antes de continuar.');
      console.log('Formulário inválido ou bloqueado. Registro abortado.');
      return;
    }

    const { apelidoPrincipal, complementoApelido, email, password } = this.registerForm.value;
    const nickname = `${apelidoPrincipal} ${complementoApelido}`.trim(); // Junta apelido principal e complemento

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
        date: new Date(),
      },
    };

    console.log('Dados do formulário:', userRegistrationData);

    this.isLoading = true;

    try {
      console.log('Chamando registerService.registerUser...');
      const result = await this.registerService.registerUser(userRegistrationData, password).toPromise();
      console.log('Registro bem-sucedido. Resultado:', result);

      // Mensagem de sucesso e navegação após registro
      localStorage.setItem('tempNickname', nickname);
      this.formSubmitted = true;
      this.failedAttempts = 0;

      this.errorNotification.showSuccess('Registro realizado com sucesso! Redirecionando...');
      this.router.navigate(['/welcome']); // Redireciona para a página de boas-vindas
    } catch (error: any) {
      console.error('Erro durante o registro:', error);
      this.handleRegistrationError(error);
    } finally {
      this.isLoading = false;
      console.log('Finalizado o registro. Estado do formulário:', this.registerForm.status);
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
