# Checklist local de autenticação

Use este checklist antes de fechar PRs que mexam em login, cadastro, recuperação de senha, navbar pública ou onboarding.

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
- `Lembrar de mim` não quebra o fluxo.

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

## Pós-login

- Usuário com e-mail não verificado vai para `/register/welcome?autocheck=1`.
- Usuário verificado com perfil incompleto vai para `/register/finalizar-cadastro`.
- Usuário verificado com perfil completo vai para `/dashboard/principal` ou rota protegida original.
- Conta suspensa/deletada segue para `/conta/status` quando aplicável.

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

Antes do PR:

```powershell
npm.cmd run build
npm.cmd run functions:build
git status
```

Aceitar apenas com build verde e `working tree clean`.
