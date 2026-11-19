import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';

const firebase = {
  send: vi.fn(),
  isLink: vi.fn(),
  consume: vi.fn(),
  beforeStateChanged: vi.fn(),
  reauthenticate: vi.fn(),
  update: vi.fn(),
};
import {
  emailLinkSignupPreviewAllowed,
  EmailLinkRegistrationService
} from './email-link-registration.service';

describe('EmailLinkRegistrationService (emulador, sem alterar fluxo antigo)', () => {
  let auth: any;
  let session: any;
  let errors: any;
  let service: EmailLinkRegistrationService;
  let prepare: ReturnType<typeof vi.fn>;
  let read: ReturnType<typeof vi.fn>;
  let passwordRequired: boolean;
  const email = 'adulto@example.com';
  const uid = 'email-link-preview-uid-novo';
  const link = 'http://localhost:4200/register/continuar-por-email?mode=signIn&oobCode=demo&apiKey=fake-api-key';

  beforeEach(() => {
    vi.clearAllMocks();
    auth = { currentUser: null };
    session = { isTerminatingSnapshot: false, terminationVersionSnapshot: 0 };
    errors = { report: vi.fn() };
    service = new EmailLinkRegistrationService(auth, session, errors, {} as never, {} as never);
    Object.assign((service as any).firebase, {
      sendSignInLinkToEmail: firebase.send,
      isSignInWithEmailLink: firebase.isLink,
      signInWithEmailLink: firebase.consume,
      beforeAuthStateChanged: firebase.beforeStateChanged,
      reauthenticateWithCredential: firebase.reauthenticate,
      updatePassword: firebase.update,
    });
    // O teste exercita a lógica de sessão; a flag de ambiente tem teste puro.
    vi.spyOn(service as any, 'assertPreview').mockImplementation(() => {});
    firebase.send.mockResolvedValue(undefined);
    firebase.isLink.mockReturnValue(true);
    passwordRequired = true;
    prepare = vi.fn().mockResolvedValue({ data: { uid } });
    read = vi.fn(async () => ({ data: { passwordRequired } }));
    vi.spyOn(service as any, 'callable').mockImplementation(name =>
      name === 'prepareEmailLinkRegistration' ? prepare : read);
    firebase.beforeStateChanged.mockReturnValue(() => {});
    firebase.reauthenticate.mockResolvedValue({ user: auth.currentUser });
    firebase.update.mockImplementation(async () => { passwordRequired = false; });
    firebase.consume.mockImplementation(async () => {
      const user = { uid, email, emailVerified: true };
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
    expect(prepare).not.toHaveBeenCalled();
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
    expect(result).toEqual({ uid, email });
    expect(prepare).toHaveBeenCalledWith({ email, code: 'demo', confirmsAdult: true });
    await firstValueFrom(service.setPassword$(uid, email, 'SenhaTeste123', 'SenhaTeste123'));
    expect(firebase.update).toHaveBeenCalledOnce();
    expect(firebase.update).toHaveBeenCalledWith(auth.currentUser, 'SenhaTeste123');
    expect(firebase.reauthenticate).toHaveBeenCalledOnce();
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('não pode redefinir senha de conta preexistente via laboratório', async () => {
    const blocked = { code: 'functions/failed-precondition' };
    prepare.mockRejectedValueOnce(blocked);
    await expect(firstValueFrom(service.completeLink$(email, link, true))).rejects.toBe(blocked);
    expect(firebase.consume).not.toHaveBeenCalled();
    auth.currentUser = { uid: 'legado', email, emailVerified: true };
    await expect(
      firstValueFrom(service.setPassword$('legado', email, 'SenhaTeste123', 'SenhaTeste123'))
    ).rejects.toMatchObject({ code: 'registration/session-changed' });
    expect(firebase.update).not.toHaveBeenCalled();
  });

  it('recusa definir senha depois de troca de UID', async () => {
    await firstValueFrom(service.completeLink$(email, link, true));
    auth.currentUser = { uid: 'outro', email, emailVerified: true };
    await expect(firstValueFrom(service.setPassword$(uid, email, 'SenhaTeste123','SenhaTeste123')))
      .rejects.toMatchObject({ code: 'registration/session-changed' });
    expect(firebase.update).not.toHaveBeenCalled();
  });

  it('recusa alteração da sessão enquanto consome link e não retorna sucesso', async () => {
    firebase.consume.mockImplementation(async () => {
      auth.currentUser = { uid: 'outro', email, emailVerified: true };
      return { user: { uid, email, emailVerified: true } };
    });
    await expect(firstValueFrom(service.completeLink$(email, link, true)))
      .rejects.toMatchObject({ code: 'registration/session-changed' });
  });

  it('preserva a outra sessão se ela aparecer antes de o Auth aplicar o link', async () => {
    firebase.consume.mockImplementation(async () => {
      auth.currentUser = { uid: 'outro' };
      firebase.beforeStateChanged.mock.calls[0][1]({ uid });
    });
    await expect(firstValueFrom(service.completeLink$(email, link, true)))
      .rejects.toMatchObject({ code: 'registration/session-changed' });
    expect(auth.currentUser.uid).toBe('outro');
  });

  it('não regrava uma senha já confirmada após falha de comunicação', async () => {
    auth.currentUser = { uid, email, emailVerified: true };
    passwordRequired = false;
    await firstValueFrom(service.setPassword$(uid, email, 'SenhaTeste123', 'SenhaTeste123'));
    expect(firebase.update).not.toHaveBeenCalled();
  });

  it('recupera o token revogado após uma gravação cujo resultado se perdeu', async () => {
    auth.currentUser = { uid, email, emailVerified: true };
    passwordRequired = false;
    read.mockRejectedValueOnce({ code: 'functions/unauthenticated' });
    await firstValueFrom(service.setPassword$(uid, email, 'SenhaTeste123', 'SenhaTeste123'));
    expect(firebase.reauthenticate).toHaveBeenCalledOnce();
    expect(firebase.update).not.toHaveBeenCalled();
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
