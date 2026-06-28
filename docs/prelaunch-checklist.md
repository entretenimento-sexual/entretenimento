# Checklist de pre-lancamento

Este documento separa validacao tecnica de publicacao real. O projeto pode estar compilando e ainda assim nao estar pronto para mercado.

## Estado atual

- Deploy publico: bloqueado.
- `deploy:prod`: protegido por `validate:prod`.
- `validate:prod`: deve falhar enquanto o App Check de producao usar placeholder.
- Validacao tecnica sem deploy: usar os comandos manuais de pre-lancamento.

## Diretriz de arquitetura e produto

Antes de qualquer go/no-go, revisar o manifesto de interface, seguranca e negocio:

- [`docs/interface-security-business-manifesto.md`](./interface-security-business-manifesto.md)

Ele deve orientar decisoes sobre mobile-first, responsividade, acessibilidade, privacidade, seguranca, reatividade, Firebase, Angular, feedback ao usuario, debug para desenvolvimento e expansao futura para mobile.

## Comandos de pre-lancamento

Use estes comandos para validar o estado tecnico sem publicar:

```powershell
cd C:\entretenimento
npm.cmd run rules:build
npm.cmd run rules:check
npm.cmd run functions:build
npm.cmd run build:prod
npm.cmd run audit:prod
git restore firestore.rules
git status
```

Resultado esperado:

```txt
FINAL total: 0 (0 = OK)
functions:build sem erro
build:prod sem erro
audit:prod found 0 vulnerabilities
working tree clean
```

## Bloqueios obrigatorios antes de producao

- [ ] Marca definida.
- [ ] Busca de disponibilidade da marca.
- [ ] Estrategia de registro de marca.
- [ ] CNPJ aberto.
- [ ] CNAE e enquadramento definidos com contador.
- [ ] Conta bancaria empresarial.
- [ ] Processador de pagamento aprovado para o modelo de negocio.
- [ ] Contrato com empresa de pagamento revisado.
- [ ] Politica de privacidade publicada.
- [ ] Termos de uso publicados.
- [ ] Politica de conteudo proibido publicada.
- [ ] Politica de denuncia e remocao publicada.
- [ ] Politica de reembolso/cancelamento publicada.
- [ ] Canal de suporte definido.
- [ ] Procedimento de resposta a denuncias definido.
- [ ] Procedimento de exclusao de conta e dados definido.
- [ ] App Check de producao com chave real.
- [ ] Dominio real definido.
- [ ] Firebase Hosting/domino configurado.
- [ ] Sentry ou monitoramento externo configurado, se for ativado.

## Produto e UX

- [ ] Manifesto de interface, seguranca e negocio revisado e respeitado nas telas criticas.
- [ ] Cadastro completo e testado em mobile.
- [ ] Login completo e testado em mobile.
- [ ] Recuperacao de senha testada.
- [ ] Verificacao de e-mail revisada.
- [ ] Consentimento adulto claro e obrigatorio.
- [ ] Rotas bloqueadas para usuarios sem consentimento, quando aplicavel.
- [ ] Onboarding simples.
- [ ] Perfil de usuario responsivo.
- [ ] Upload de foto/video com feedback robusto.
- [ ] Estados de loading, vazio e erro em telas principais.
- [ ] Mensagens de erro amigaveis para usuario.
- [ ] Debug tecnico preservado para desenvolvimento.
- [ ] Acessibilidade basica: foco, teclado, labels e contraste.
- [ ] Layout revisado para telas pequenas.

## Moderacao e seguranca

- [ ] Botao de denuncia visivel onde necessario.
- [ ] Fila interna de denuncias validada.
- [ ] Historico de decisoes administrativas validado.
- [ ] Logs administrativos revisados.
- [ ] Bloqueio de usuario validado.
- [ ] Regras de Firestore revisadas por colecao sensivel.
- [ ] Regras de Storage revisadas para fotos, videos e avatar.
- [ ] Dados sensiveis nao expostos em console de producao.
- [ ] Regras de claims administrativas padronizadas.
- [ ] Procedimento manual para suspensao/banimento definido.

## Pagamentos

- [ ] Modelo financeiro definido: assinatura, gorjeta, comissao, saque ou combinacao.
- [ ] Processador aceita o segmento e o modelo de repasse.
- [ ] KYC/KYB entendido.
- [ ] Split definido.
- [ ] Reserva/retencao definida.
- [ ] Chargeback definido.
- [ ] Saque definido.
- [ ] Sandbox testado antes de qualquer cobranca real.
- [ ] Fluxo de erro de pagamento tratado.
- [ ] Webhooks planejados com idempotencia.

## Legal e operacao

- [ ] Termos revisados por profissional habilitado.
- [ ] Politica de privacidade revisada por profissional habilitado.
- [ ] Processo de LGPD documentado.
- [ ] Responsavel interno por atendimento definido.
- [ ] E-mail de suporte definido.
- [ ] E-mail juridico/privacidade definido.
- [ ] Plano de atendimento a incidentes definido.
- [ ] Plano de backup/exportacao de dados definido.
- [ ] Plano de remocao emergencial de conteudo definido.

## Criterio de go/no-go

O projeto so deve ser considerado para deploy publico quando todos os itens obrigatorios estiverem marcados e o comando abaixo passar:

```powershell
npm.cmd run validate:prod
```

O deploy real deve continuar restrito a:

```powershell
npm.cmd run deploy:prod
```

Nao usar deploy manual avulso para contornar o pipeline.
