# Documentação do projeto

Este diretório concentra documentos de governança técnica, produto, segurança e pré-lançamento.

## Ordem recomendada de leitura

1. [`interface-security-business-manifesto.md`](./interface-security-business-manifesto.md)  
   Diretrizes de interface, segurança, privacidade, responsividade, reatividade, negócio e expansão mobile.

2. [`prelaunch-checklist.md`](./prelaunch-checklist.md)  
   Checklist de validação técnica, bloqueios obrigatórios, produto, UX, moderação, segurança, pagamentos, legal e go/no-go.

## Regra de uso

Antes de alterar telas críticas, fluxos sensíveis ou rotas públicas, consulte o manifesto e confirme se a alteração respeita:

- mobile-first;
- acessibilidade;
- feedback robusto ao usuário;
- debug útil para desenvolvimento;
- segurança e privacidade;
- Angular/Firebase modernos;
- baixo impacto de bundle;
- expansão futura para app mobile.

Antes de qualquer publicação pública, use o checklist de pré-lançamento. O build passar não significa que o produto está pronto para mercado.
