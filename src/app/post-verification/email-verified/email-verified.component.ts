// src\app\post-verification\email-verified\email-verified.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { EmailVerificationService } from 'src/app/core/services/autentication/email-verification.service';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-email-verified',
  templateUrl: './email-verified.component.html',
  styleUrls: ['./email-verified.component.css']
})
export class EmailVerifiedComponent implements OnInit, OnDestroy {

  public isEmailVerified = false;
  oobCode: any;

  private ngUnsubscribe = new Subject<void>();
  constructor(
    private authService: AuthService,
    private emailVerificationService: EmailVerificationService,
    private route: ActivatedRoute
  ) { }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.ngUnsubscribe)).subscribe(async params => {
      this.oobCode = params['oobCode'];

      if (this.oobCode) {
        this.emailVerificationService.setCode(this.oobCode);
        console.log('oobCode recuperado:', this.oobCode);
        try {
          await this.handleEmailVerification(this.oobCode);
        } catch (error) {
          console.error('Erro ao manusear a verificação de e-mail', error);
        }
      } else {
        console.error('oobCode não encontrado');
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  async handleEmailVerification(oobCode: string): Promise<void> {
    try {
      await this.authService.handleEmailVerification(oobCode);
      this.isEmailVerified = true;
    } catch (error) {
      console.error('Falha ao manusear a verificação de e-mail no AuthService', error);
    }

    try {
      await this.emailVerificationService.reloadCurrentUser();
    } catch (error) {
      console.error('Falha ao recarregar o usuário atual', error);
    }
  }

  onSubmit(): void {
    console.log('Formulário enviado');
  }
}
