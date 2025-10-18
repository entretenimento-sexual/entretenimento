//src\app\shared\pipes\register-error-message.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'registerErrorMessage',
  standalone: true,
})
export class RegisterErrorMessagePipe implements PipeTransform {

  transform(errors: Record<string, any> | null): string | null {
    console.log('[RegisterErrorMessagePipe] Recebeu erros:', errors);
    if (!errors) return null;

    // 🔍 Verifica os erros na ordem de prioridade
    if (errors['required']) return 'Campo obrigatório.';
    if (errors['minlength']) return `Mínimo de ${errors['minlength'].requiredLength} caracteres.`;
    if (errors['maxlength']) return `Máximo de ${errors['maxlength'].requiredLength} caracteres.`;
    if (errors['invalidNickname']) return 'Caracteres inválidos no apelido.';
    if (errors['nicknameExists']) return 'Apelido já está em uso.';
    if (errors['email']) return 'E-mail inválido.';
    if (errors['password']) return 'Senha fraca.';

    // ⚠️ Mensagem padrão para erros não tratados
    return 'Erro de validação.';
  }
}
