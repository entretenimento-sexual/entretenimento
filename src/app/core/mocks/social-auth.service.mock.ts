// src\app\core\mocks\social-auth.service.mock.ts
import { Observable, of } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export class SocialAuthServiceMock {
  user$: Observable<IUserDados | null> = of(null);

  googleLogin(): Promise<any> {
    // Simulando uma resposta de sucesso do login social, você pode ajustar conforme a necessidade
    return Promise.resolve({
      email: 'alexseves@gmail.com',
      name: 'Teste',
      photoURL: 'https://avatars.githubusercontent.com/u/123456789'
    });
  }

  logout(): Promise<void> {
    return Promise.resolve();
  }
}
