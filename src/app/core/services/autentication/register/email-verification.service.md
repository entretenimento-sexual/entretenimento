# Verificação de e-mail

O Firebase Auth confirma o endereço vinculado ao código do link. A página valida o tipo da operação antes de aplicar o código. O e-mail retornado pelo Firebase é usado somente em memória para conferir a sessão que iniciou a consulta.

Se o destinatário estiver autenticado na mesma sessão, o app atualiza o token antes de sincronizar o estado no perfil privado. Se a sessão for de outra conta, a confirmação do destinatário permanece válida e a tela oferece a troca de conta. Depois de confirmar sem sessão, o usuário entra com a conta que recebeu o link.

A página distingue link expirado, inválido ou já utilizado, falha de comunicação e atualização de perfil pendente. O reenvio ocorre na etapa autenticada de verificação, em /register/welcome. A próxima etapa do cadastro é definida pelo fluxo de registro.

[Política de autenticação](../../../../../../docs/dev/auth-session-policy.md) · [Checklist local](../../../../../../docs/dev/auth-validation-checklist.md)
