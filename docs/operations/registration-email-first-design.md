# Cadastro por e-mail primeiro — contrato canônico de implementação
**Ambiente:** desenvolvimento e emuladores. **Estado:** desenho aprovado para implementação progressiva; não é autorização de deploy de produção.

## Etapas e apresentação
1. Apelido principal exclusivo (4–12), complemento opcional (até 12). Manter o formulário e consultar somente o principal. A reserva transacional usa `public_index/nickname:<principal>`; sem coleção duplicada.
2. Digitação de e-mail: campo único, aviso breve de privacidade e ação para solicitar link. Sem senha nessa tela após o cutover. Respostas de solicitação não podem revelar se o e-mail já pertence a uma conta.
3. Link único recebido: aplicar o fluxo Firebase de email-link sign-in; não tratar como simples `sendEmailVerification` de uma conta com senha. No outro dispositivo, pedir o endereço novamente, sem transportá-lo em query string. Link inválido/usado/expirado: feedback próprio + reenvio com limites.
4. Depois de autenticar por link, exibir a definição e confirmação de senha. A senha deve ser criada pelo mecanismo do Firebase Auth e jamais persistida em Firestore, telemetria ou storage. Não publicar o perfil nesta fase.
5. Termos vigentes, declaração 18+ e avaliação etária canônica, com aceites explícitos e versionados.
6. Conclusão de perfil, manutenção do UID esperado, transação protegida e liberação somente depois da decisão backend.

## Risco documentado pelo Firebase — contas já existentes

O Firebase Auth informa que a autenticação por link pode **invalidar sessões anteriores e remover a senha de uma conta criada com e-mail/senha ainda não verificada**, no momento em que o link é consumido. Isso não pode ser introduzido silenciosamente em um cadastro existente. Fonte: https://firebase.google.com/docs/auth/web/email-link-auth

A ativação do novo provedor dependerá de um teste reproduzível em Auth Emulator com contas antigas (e-mail verificado/não verificado), link usado em outra sessão, criação de senha após o link, e um bloqueio inequívoco contra entrada em perfil de outra conta. Não usar `sendEmailVerification` como substituto de `sendSignInLinkToEmail`. Enquanto o teste não passar, manter **desativada** a nova jornada de autenticação.

As duas cenas fotográficas WebP foram integradas à `main` no commit `4f3922c7`. Não depender de imagens externas, instaladores locais ou artefatos não versionados.

## Dependências de segurança obrigatórias antes da virada
- **Autoridade etária:** o fluxo atual exige declaração 18+ antes de criar o UID. Como `signInWithEmailLink` cria/autentica a conta no primeiro clique, preservar a declaração pré-Auth na própria confirmação do link, imediatamente antes de consumi-lo; não presumir maioridade com base em e-mail confirmado. A declaração autenticada e os termos continuam na fase canônica; sem duplicar consentimentos.
- **Estado canônico:** introduzir `passwordSetup` como etapa do `RegisterFlowFacade` / `RegisterNavigationService` somente com evidência de criação de credencial; conta recém-autenticada por link sem senha não pode pular para Termos, Perfil ou Preferências. Estado protegido pelo backend, vinculado ao UID e resistente a troca de sessão.
- **Autenticação:** conferir os provedores e a sessão no Firebase Auth. `updatePassword` exige autenticação recente; após perder a sessão, reautenticar por link. Não inferir senha definida de uma flag controlada pelo navegador. A transição de provedor não pode resetar credenciais de uma conta existente.
- **Reserva:** apelido pesquisado é indicação provisória; entre entrada de e-mail e clique no link outra conta pode reservá-lo. Após login por link, reservar no `public_index` e retornar ao apelido em caso de disputa, sem criar perfil indevido.
- **Navegação:** guards para todas as rotas internas e chamadas críticas recusam conta incompleta. Permitir apenas continuar, suporte, reenviar, trocar e-mail e sair. Logout invalida estados temporários do UID antigo.
- **Privacidade:** nenhum e-mail ou token nos parâmetros de auditoria e logs. Rascunho da etapa pode ser associado a nonce local efêmero; não guardar senha, orientação ou município em storage persistente.
- **Custo/abuso:** debounce só do apelido principal; limitar envio e reenvio de links por origem e identidade quando aplicável; tratar erro e timeout de forma neutra; não anunciar envio de e-mail se a operação não foi confirmada.
- **Emuladores e produção:** habilitar Email Link em Authentication > Sign-in method no projeto de desenvolvimento apropriado, confirmar domínios autorizados. Não habilitar App Check/Fraud Defense de produção por essa mudança. Manter antigo fluxo funcional até a suíte E2E end-to-end ficar verde.

## Feedback canônico
| Estado | Feedback | Ação |
|---|---|---|
| E-mail inválido | Confira o endereço informado. | Corrigir campo |
| Envio confirmado | Se o endereço puder receber a mensagem, verifique sua caixa de entrada. | Verificar e-mail |
| Envio inconclusivo por rede | Não foi possível confirmar o envio. Sua solicitação pode ter sido recebida. | Repetir com limite |
| Link inválido/expirado | Este link não pode mais ser usado. | Pedir outro |
| Link de outra conta | Esta confirmação pertence a outra sessão. | Trocar conta com segurança |
| E-mail confirmado | Endereço confirmado. Agora defina sua senha. | Criar senha |
| Senha não concluída | Sua senha ainda não foi confirmada. | Reautenticar se necessário |
| Termos/idade/perfil pendentes | Seu cadastro ainda não foi concluído. | Continuar etapa |
| Cadastro concluído | Seu perfil está pronto. | Entrar na plataforma |

## Layout e cenas
- A primeira etapa mantém o layout fotográfico original. A partir da segunda subetapa, a cena fotográfica ocupa **coluna própria**, sem o card por cima. Em telas estreitas, a fotografia fica acima do formulário. Usar `object-fit: contain` para preservar a composição inteira, sem cortar participantes.
- Fade de ~380 ms; respeitar `prefers-reduced-motion`, sem vídeos, animações contínuas ou nova biblioteca. Imagem decorativa com `alt=""` e `aria-hidden`.
- Padronizar a largura do card e manter as instruções curtas, com erros não modais, visíveis quando for necessária ação e anunciados por leitores de tela.

## Critérios para autorizar substituição do fluxo existente
1. E2E com Auth/Firestore/Functions Emulator, criação por link em mesmo e outro navegador.
2. Comprovar 18+ pré-Auth, senha após link e bloqueio de navegação/autorização no backend enquanto incompleto.
3. Casos de link expirado, duplicado, e-mail já existente, falta de conexão, timeout, usuário lento, troca de sessão, logout e disputa pelo apelido.
4. Verificar feedback e invariância visual em desktop/móvel, inclusive `prefers-reduced-motion`.
5. Nenhum deploy de produção; revisar custo e configuração do provedor antes de qualquer habilitação remota.
