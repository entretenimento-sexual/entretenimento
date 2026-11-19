import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';

const firebase = vi.hoisted(() => ({
  send: vi.fn(),
  isLink: vi.fn(),
  consume: vi.fn(),
  extra: vi.fn(),
  update: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  sendSignInLinkToEmail: firebase.send,
  isSignInWithEmailLink: firebase.isLink,
  signInWithEmailLink: firebase.consume,
  getAdditionalUserInfo: firebase.extra,
  updatePassword: firebase.update,
}));
vi.mock('src/environments/environment', () => ({
  environment: {
    production: false,
    useEmulators: true,
    features: { emailFirstSignupPreview: true },
  },
}));
import {
  emailLinkSignupPreviewAllowed,
  EmailLinkRegistrationService
} from './email-link-registration.service';

describe('EmailLinkRegistrationService (emulador, sem alterar fluxo antigo)', () => {
  let auth: any;
  let session: any;
  let errors: any;
  let service: EmailLinkRegistrationService;
  const email = 'adulto@example.com';
  const link = 'http://localhost:4200/register/continuar-por-email?mode=signIn&oobCode=demo';

  beforeEach(() => {
    vi.clearAllMocks();
    auth = { currentUser: null };
    session = { isTerminatingSnapshot: false, terminationVersionSnapshot: 0 };
    errors = { report: vi.fn() };
    service = new EmailLinkRegistrationService(auth, session, errors);
    firebase.send.mockResolvedValue(undefined);
    firebase.isLink.mockReturnValue(true);
    firebase.extra.mockReturnValue({ isNewUser: true });
    firebase.update.mockResolvedValue(undefined);
    firebase.consume.mockImplementation(async () => {
      const user = { uid: 'uid-novo', email, emailVerified: true };
      auth.currentUser = user;
      return { user };
    });
  });

  it('nunca ativa o fluxo fora do emulador de desenvolvimento', () => {
    expect(emailLinkSignupPreviewAllowed({
      production: true, useEmulators: true, features: { emailFirstSignupPreview: true },
    } as any)).toBe(false);
    expect(emailLinkSignupPreviewAllowed({
      production: false, useEmulators: false, features: { emailFirstSignupPreview: true },
    } as any)).toBe(false);
    expect(emailLinkSignupPreviewAllowed({
      production: false, useEmulators: true, features: { emailFirstSignupPreview: false },
    } as any)).toBe(false);
  });

  it('envia somente o e-mail e um retorno local sem expor e-mail/UID no link', async () => {
    await firstValueFrom(service.requestLink$(email));
    expect(firebase.send).toHaveBeenCalledTimes(1);
    expect(firebase.send).toHaveBeenCalledWith(auth, email, {
      url: `${location.origin}/register/continuar-por-email`,
      handleCodeInApp: true,
    });
    const settings = firebase.send.mock.calls[0][2];
    expect(settings.url).not.toContain(email);
    expect(settings.url).not.toContain('uid');
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('nega envio quando outra conta está autenticada', async () => {
    auth.currentUser = { uid: 'outro' };
    await expect(firstValueFrom(service.requestLink$(email)))
      .rejects.toMatchObject({ code: 'registration/session-active' });
    expect(firebase.send).not.toHaveBeenCalled();
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('exige maioridade antes do login por link criar UID', async () => {
    await expect(firstValueFrom(service.completeLink$(email, link, false)))
      .rejects.toMatchObject({ code: 'registration/adult-declaration-required' });
    expect(firebase.consume).not.toHaveBeenCalled();
  });

  it('não consome link inválido nem troca uma sessão existente', async () => {
    firebase.isLink.mockReturnValue(false);
    await expect(firstValueFrom(service.completeLink$(email, link, true)))
      .rejects.toMatchObject({ code: 'registration/invalid-link' });
    expect(firebase.consume).not.toHaveBeenCalled();
    firebase.isLink.mockReturnValue(true);
    auth.currentUser = { uid: 'outra-conta' };
    await expect(firstValueFrom(service.completeLink$(email, link, true)))
      .rejects.toMatchObject({ code: 'registration/session-active' });
    expect(firebase.consume).not.toHaveBeenCalled();
  });

  it('confirma o UID devolvido pelo Auth e define a senha sem persisti-la', async () => {
    const result = await firstValueFrom(service.completeLink$(email, link, true));
    expect(result).toEqual({ uid: 'uid-novo', email, newUser: true });
    await firstValueFrom(service.setPassword$('uid-novo', email, 'SenhaTeste123', 'SenhaTeste123'));
    expect(firebase.update).toHaveBeenCalledOnce();
    expect(firebase.update).toHaveBeenCalledWith(auth.currentUser, 'SenhaTeste123');
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('não pode redefinir senha de conta preexistente via laboratório', async () => {
    firebase.extra.mockReturnValue({ isNewUser: false });
    const result = await firstValueFrom(service.completeLink$(email, link, true));
    expect(result.newUser).toBe(false);
    await expect(
      firstValueFrom(service.setPassword$('uid-novo', email, 'SenhaTeste123', 'SenhaTeste123'))
    ).rejects.toMatchObject({ code: 'registration/session-changed' });
    expect(firebase.update).not.toHaveBeenCalled();
  });

  it('recusa definir senha depois de troca de UID', async () => {
    await firstValueFrom(service.completeLink$(email, link, true));
    auth.currentUser = { uid: 'outro', email, emailVerified: true };
    await expect(firstValueFrom(service.setPassword$('uid-novo', email, 'SenhaTeste123','SenhaTeste123')))
      .rejects.toMatchObject({ code: 'registration/session-changed' });
    expect(firebase.update).not.toHaveBeenCalled();
  });

  it('recusa alteração da sessão enquanto consome link e não retorna sucesso', async () => {
    firebase.consume.mockImplementation(async () => {
      auth.currentUser = { uid: 'outro', email, emailVerified: true };
      return { user: { uid: 'uid-novo', email, emailVerified: true } };
    });
    await expect(firstValueFrom(service.completeLink$(email, link, true)))
      .rejects.toMatchObject({ code: 'registration/session-changed' });
  });

  it('não repete envio automaticamente em falha de transporte', async () => {
    const failure=Object.assign(new Error('network down'),{code:'auth/network-request-failed'});
    firebase.send.mockRejectedValue(failure);
    await expect(firstValueFrom(service.requestLink$(email))).rejects.toBe(failure);
    expect(firebase.send).toHaveBeenCalledTimes(1);
    expect(errors.report).toHaveBeenCalledOnce();
    expect(errors.report.mock.calls[0][1].metadata).not.toHaveProperty('email');
  });
});
