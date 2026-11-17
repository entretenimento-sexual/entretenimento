# Checklist local de autenticação

Use este checklist antes de registrar alterações em login, cadastro, recuperação de senha, navbar pública ou onboarding.

## Ambiente

1. Subir emuladores:

```powershell
npm.cmd run emu:media:full:win
```

2. Subir Angular:

```powershell
npm.cmd run start:emu
```

3. Abrir:

```text
http://localhost:4200/login
http://localhost:4200/register
http://127.0.0.1:4000/
```

## Login

- `/login` carrega sem erro no console.
- Navbar pública mostra `Cadastre-se`, alternância de tema e alto contraste.
- Navbar pública não mostra `Planos de Assinatura`.
- Hero mantém texto curto.
- Google aparece apenas no login.
- Botão `Entrar` só habilita com e-mail e senha preenchidos.
- Senha errada mostra erro somente dentro do card.
- Erro técnico real pode usar snackbar global.
- Toggle de senha alterna `Mostrar senha` / `Ocultar senha` via `aria-label`.
- Login utiliza sessao persistente; nao apresentar checkbox Lembrar de mim.

## Recuperação de senha

- Botão `Esqueci minha senha` abre modal.
- Foco inicial vai para o campo de e-mail.
- `Esc` fecha o modal quando não está enviando.
- Clique fora fecha o modal quando não está enviando.
- Durante envio, o modal não fecha por clique externo/tecla acidental.
- E-mail inválido mostra erro inline.
- Solicitação aceita mostra feedback neutro.
- No Auth Emulator, a mensagem orienta copiar o link impresso no terminal.

## Cadastro

- `/register` carrega sem erro no console.
- Navbar pública mostra `Entrar`, alternância de tema e alto contraste.
- Não há botão Google no registro.
- Botão `Cadastrar` fica desabilitado até termos aceitos e formulário válido.
- Apelido inválido ou repetido mostra feedback controlado.
- Cadastro cria usuário no Auth Emulator.
- Cadastro cria documento em `users/{uid}` no Firestore Emulator.
- Cadastro cria índice público de apelido quando aplicável.
- Usuário novo segue para verificação/finalização conforme fluxo atual.

## Cadastro interrompido

- Simular resposta temporariamente perdida na reserva de apelido. Conferir que o acesso permanece disponível e que a conclusão respeita o apelido reservado no servidor.
- Usar um apelido reservado e ainda não publicado. Conferir que a verificação de e-mail continua e que a conclusão do perfil permite escolher outro apelido.
- Simular indisponibilidade durante a criação da credencial. Conferir que o formulário oferece acesso e recuperação com mensagem neutra e que o cadastro pode prosseguir pelo login se a conta tiver sido criada.
- Entrar com Google durante a criação do seed pela trigger. Conferir que o mesmo perfil privado é reutilizado e confirmar a próxima etapa de cadastro.

## Link de verificação de e-mail

- Abrir o link da conta A com a conta B autenticada. A deve ficar verificada no Firebase, B deve continuar com o mesmo estado e a troca de conta deve depender do botão na tela.
- Abrir um link sem sessão. Conferir que o login oferecido permite retomar o cadastro com a conta que recebeu o e-mail.
- Exercitar o link expirado, o código já usado e uma falha de comunicação. Conferir a orientação de cada caso e fazer o reenvio pela tela autenticada de verificação.
- Confirmar o link com a mesma conta e provocar falha na atualização do perfil. Conferir a indicação de atualização pendente e a opção de continuar.

## Pós-login

- Usuário com e-mail não verificado vai para `/register/welcome?autocheck=1`.
- Conta nova com e-mail e termos confirmados segue para a etapa de idade se a decisão etária estiver pendente. Após confirmar idade, abre a conclusão do perfil.
- A sessão de uma conta bloqueada continua sem acesso à etapa etária de cadastro.
- Resultados atrasados da conta anterior não avançam o cadastro nem aplicam bloqueio à conta atual.
- Usuário verificado com perfil completo vai para `/dashboard/principal` ou rota protegida original.
- Conta suspensa/deletada segue para `/conta/status` quando aplicável.

## Saída da conta

- Com um rascunho aberto, clicar em “Sair” e depois “Continuar editando”. Confirmar que a sessão e os campos continuam disponíveis.
- Repetir e escolher “Sair sem salvar”. Conferir o progresso e a mensagem “Você saiu da sua conta” no login.
- Se a navegação ao login falhar após o Firebase confirmar a saída, checar que a tela protegida fica oculta e que “Abrir login” permite tentar novamente.
- Abrir um rascunho na segunda aba e encerrar a sessão na primeira. A segunda aba deve sair para o login e conservar os campos que podem ser retomados na mesma conta.

## Recuperação após falha temporária

- Recarregar uma rota protegida com a persistência do Auth atrasada. Se a espera exceder o prazo, o login oferece “Tentar novamente”. A ação abre a rota original quando o SDK e o perfil estiverem disponíveis.
- Repetir com falha temporária de consulta do perfil. Uma conta ainda autenticada pode retomar a mesma etapa depois da recuperação.
- Durante a confirmação de e-mail, interromper a rede e clicar em “Checar agora”. A tela informa falha de consulta. Restabelecer a rede e repetir a ação com a mesma conta.

## Mobile

Testar em DevTools:

```text
360 x 800
390 x 844
430 x 932
768 x 1024
```

- Card não estoura largura.
- Campos mantêm alvo de toque confortável.
- Hero não empurra o formulário para fora da tela sem necessidade.
- Navbar pública não quebra em duas linhas ruins.
- Modal de recuperação cabe na tela e mantém rolagem utilizável.

## Critério de aceite

Antes do commit local:

```powershell
npm.cmd run build
npm.cmd run functions:build
git status
```

Aceitar apenas com build verde e `working tree clean`.
