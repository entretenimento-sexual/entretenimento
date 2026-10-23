# Módulo Media — redistribuição e intenção pública do perfil

## Política de circulação da mídia

- **Visualização**: o backend concede URLs temporárias apenas após verificar
  idade, estado da conta, bloqueios, moderação e audiência da publicação. O
  navegador pode conservar uma URL durante a validade residual; impedir todo
  download/captura é tecnicamente impossível para mídia reproduzível.
- **Download de terceiros**: não oferecer botão de download, exportação de URL
  assinada, reenvio de arquivo nem APIs de download. O player usa
  `controlsList="nodownload"` como redução de superfície, não DRM.
- **Compartilhamento externo**: apenas o proprietário com sessão confirmada
  pode acionar a criação do link canônico `/media/video/<owner>/<video>`.
  O link nunca contém URL assinada. O acesso de quem o receber segue sujeito
  à autorização no momento da abertura.
- **Compartilhamento interno**: enviar somente referência identificadora em
  conversa. A callable e o playback devem revalidar permissões do emissor,
  audiência, bloqueios e estado do conteúdo para cada destinatário.
- **Revogação**: retirar publicação e atualizar projeções desabilita novos
  acessos; não prometer eliminação retroativa de arquivos capturados ou URLs
  temporárias ainda válidas. Registrar limites de expiração/observabilidade.
- **Controles futuros do autor**: caso se permita compartilhar além do
  proprietário, exigir consentimento explícito por publicação, backend como
  autoridade, revogação e teste de não regressão. Não ativado nesta fase.

## Perfil pessoal vs. perfil profissional (preparação, sem ativação)

Eixos que não podem ser confundidos:

1. **Assinatura/pagamento à plataforma**: `free/basic/premium/vip` não diz
   nada sobre atividade profissional e nunca muda a categoria do perfil.
2. **Intenção pública**: `PERSONAL_SOCIAL` ou `PROFESSIONAL`; declaração
   voluntária do titular. Não inferir intenção financeira de imagens, nome,
   roupas, preferências ou padrões de interação.
3. **Verificação independente**: o rótulo profissional público exige
   `BACKEND_VERIFIED`, fluxo de comprovação e revisão compatível com a
   política da plataforma. O grant de organização
   `evaluateVerifiedCommercialAuthority` não constitui automaticamente
   verificação de perfil profissional pessoal.
4. **Publicação do rótulo**: opção `publishLabel`, projeção pública
   versionada, com retirada imediata quando a verificação expirar ou a
   escolha for revogada. Contas legadas sem projeção não recebem rótulo.
5. **Separação de conteúdo**: eventual classificação do propósito de uma
   publicação é distinta da categoria do perfil. Exposição, classificação,
   monetização, boosts e ranking precisam de contrato explícito e auditoria
   próprios antes de ativação.
6. **Segurança e moderação**: proibir falsos selos, anúncios enganosos,
   ofertas ilícitas, aliciamento, coerção e uso de rótulo para contornar as
   exigências gerais de segurança/idade. Não habilitar marketplace,
   pagamentos entre usuários ou intermediação de serviços por esta mudança.

O contrato puro em `profile-purpose-presentation.policy.ts` fica pronto
para a projeção backend future. Ele não altera Firestore, perfis existentes,
rankeamento, ações comerciais ou UI de perfil enquanto a verificação canônica
não estiver implementada.

## Contrato futuro por publicação

`PublicMediaPurposeProjection` é separado de `PublicProfilePurposeProjection`.
Uma conta profissional pode publicar uma mídia pessoal, sem receber um selo
profissional nesse item. Só uma publicação `PROFESSIONAL_PORTFOLIO` cuja
projeção de proprietário esteja `BACKEND_VERIFIED` com `publishLabel=true`
pode apresentar o rótulo profissional. Publicações legadas e declarações
sem verificação permanecem sem selo. A implementação atual prepara tipos,
decisões puras e regressões, mas **não ativa campos graváveis nem projeções
públicas** antes da autoridade correspondente existir no backend.
