# Auditoria de densidade visual

## Objetivo

A interface deve priorizar conteúdo, decisão e ação. Cabeçalhos decorativos, textos introdutórios e cartões não devem repetir informações que já estão claras pela navegação ou pelo próprio conteúdo.

## Contrato das telas principais

Nas superfícies de uso frequente:

1. existe no máximo um `h1`;
2. o cabeçalho usa um título curto e ações próximas;
3. não se combina `eyebrow/overline`, título e subtítulo introdutório na mesma tela;
4. estados vazios e de erro podem explicar o próximo passo;
5. textos de segurança, cobrança, privacidade e conformidade são preservados quando evitam uma decisão incorreta;
6. funcionalidades inexistentes não ocupam cartões permanentes na interface;
7. dados repetidos em hero, resumo e seção aparecem somente no local mais útil.

## Comandos

Relatório global, sem bloquear o processo:

```powershell
npm.cmd run audit:visual
```

Validação das superfícies críticas:

```powershell
npm.cmd run audit:visual:strict
```

O modo estrito faz parte de `build:safe`, `validate:local` e `validate:prod`.

## O que o relatório mede

Nos templates:

- quantidade de `h1` e demais headings;
- combinação de eyebrow/overline, título e subtítulo;
- quantidade aproximada de cards, heroes e panels;
- páginas com hierarquia excessivamente fragmentada.

Nos estilos:

- sombras;
- gradientes;
- pílulas com raio máximo;
- uso de `!important`.

Os indicadores de CSS são informativos. Uma sombra ou gradiente pode ser legítimo; o relatório serve para localizar concentração decorativa, não para impor design monocromático.

## Superfícies críticas atuais

- cabeçalho global;
- Hoje;
- Feed;
- Conta;
- Notificações;
- Convites;
- Salas;
- Preferências;
- Administração;
- galerias públicas recentes, top e turbinadas.

## Exceções deliberadas

Textos adicionais continuam permitidos em:

- consentimento e maioridade;
- exclusão e suspensão de conta;
- pagamento e assinatura;
- denúncias e moderação;
- erros que exigem recuperação orientada;
- formulários nos quais a explicação evita preenchimento incorreto.

A exceção deve existir por necessidade funcional, jurídica ou de segurança, não para preencher espaço visual.
