# Manifesto de interface, segurança e negócio

Este documento consolida as diretrizes de produto para decisões de interface, segurança, privacidade, performance e evolução comercial da plataforma.

## Filosofia de interface

O projeto segue uma abordagem **mobile-first**, antecipando futuras compilações nativas e experiências instaláveis. A interface deve performar de forma consistente em smartphones pequenos, tablets, notebooks, desktops e telas grandes, em modo retrato ou paisagem.

As telas devem manter visual moderno, clean e minimalista, com leitura rápida, navegação objetiva, hierarquia clara e estados de feedback evidentes. O design deve se inspirar nas grandes plataformas globais, sem copiar identidade visual de terceiros.

## Responsividade e acessibilidade

Toda implementação visual deve considerar:

- adaptação fluida entre diferentes larguras e alturas de tela;
- alvos de toque confortáveis em mobile;
- suporte real a modo claro e escuro;
- suporte a alto contraste;
- respeito a preferências de movimento reduzido;
- semântica acessível com labels, `aria-*` e estados vivos quando necessário;
- navegação clara por teclado e foco visível.

A solução não deve depender de medidas paliativas. Ajustes visuais precisam ser concretos, sustentáveis e compatíveis com expansão futura.

## Segurança e privacidade

Segurança e privacidade são pilares inegociáveis. A plataforma deve priorizar sigilo, controle de exposição, proteção contra abuso e redução de risco de comprometimento de dados ou identidade.

As decisões devem seguir o padrão rígido esperado de produtos de grande escala, usando Angular, Firebase, regras de segurança, App Check, autenticação, validações client/server e tratamento centralizado de erros.

Fluxos sensíveis, como denúncia, bloqueio, links externos, fotos, chat, salas, convites e preferências, devem sempre ter:

- feedback claro para o usuário;
- mensagens objetivas e não alarmistas;
- validações robustas;
- tratamento de erro centralizado;
- logs e contexto suficientes para debug de desenvolvimento;
- nenhuma exposição desnecessária de dados internos.

## Reatividade e estado

A arquitetura deve priorizar recursos modernos do Angular, Observables, sinais quando adequados, `async` pipe, cancelamento de listeners e estado previsível. Quando fizer sentido, usar cache, NgRx e seletores tipados para reduzir recomputação, melhorar previsibilidade e manter a interface reativa.

Listeners Firebase devem ser iniciados apenas quando houver contexto válido de autenticação, permissão e escopo. Mudanças de `uid`, rota ou sessão devem cancelar assinaturas anteriores corretamente.

## Negócio e experiência de produto

O produto deve sustentar uma experiência discreta, profissional, confiável e rentável. A interação entre usuários deve ser objetiva, segura e compatível com o propósito da plataforma, sem expor identidade, rotina, dados pessoais ou links sensíveis sem controle.

Monetização, planos, destaque, descoberta, fotos, chat e salas devem evoluir com base em segurança, clareza e valor percebido. Recursos pagos precisam ser compreensíveis, mas sem comprometer a usabilidade básica e a confiança do usuário.

## Critério para novas alterações

Antes de implementar uma nova alteração, revisar se ela:

- respeita mobile-first;
- mantém acessibilidade;
- preserva nomes de métodos e fluxos existentes quando possível;
- não introduz gambiarra visual ou lógica;
- não enfraquece privacidade ou segurança;
- usa Angular/Firebase de forma moderna;
- mantém feedback robusto para usuário e debug útil para dev;
- evita aumento desnecessário de bundle;
- é compatível com expansão para app mobile.

Este manifesto deve orientar decisões futuras de interface, segurança e negócio, especialmente nas áreas públicas, sociais, moderação, chat, pagamentos, perfis, fotos e preferências.
