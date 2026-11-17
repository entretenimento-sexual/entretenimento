# Cadastro e retomada

O formulário faz uma consulta provisória de apelido durante a edição. O RegisterService faz a checagem estrita de apelido publicado, valida os dados e inicia uma única criação de credencial no Firebase Auth. A reserva efetiva pertence a reserveRegistrationNickname, que atualiza o perfil privado e os índices em uma transação.

Se o SDK exceder o prazo de resposta, o formulário orienta entrar ou recuperar o acesso. Uma tentativa local que ainda possa concluir impede a criação concorrente. Depois que a credencial existe, uma falha subsequente preserva a conta. A reserva pode ser repetida uma vez após falha temporária. Se a reserva não for confirmada, o cadastro segue para verificação de e-mail e o servidor determina o apelido na conclusão do perfil.

O aceite de termos é auditado por acceptPlatformTerms. Se o aceite inicial falhar, a etapa explícita do cadastro recolhe a confirmação. O envio de e-mail é independente. Quando o envio não é confirmado, a tela de verificação oferece “Reenviar e-mail”.

A entrada por Google usa recoverRegistrationSeed se a leitura inicial do perfil estiver vazia. Essa operação compartilha as regras de concorrência da trigger de Auth e preserva os campos já gravados. A interface segue o fluxo canônico de verificação de e-mail, termos, idade e conclusão do perfil.

[Política de autenticação](../../../../../../docs/dev/auth-session-policy.md) · [Checklist de validação](../../../../../../docs/dev/auth-validation-checklist.md)
