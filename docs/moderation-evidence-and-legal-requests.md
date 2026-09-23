# Moderação, preservação de evidências e solicitações legais

Este documento descreve a arquitetura operacional da plataforma para denúncias de mídia com possível risco grave. Ele é um runbook técnico/compliance e não substitui análise jurídica específica do caso.

## Princípios

1. **Denúncia de usuário não é conclusão de crime.** O envio de uma denúncia cria um caso de moderação e pode acionar contenção técnica, mas não autoriza comunicação automática a autoridades.
2. **Conteúdo grave sai da distribuição rapidamente.** `minor_content_safety`, `illegal_content` e `sexual_boundary` colocam foto/vídeo em quarentena na primeira denúncia válida. Denúncias gerais exigem limiar antifraude antes da quarentena automática. `minor_safety` é reservado à suspeita de menoridade do responsável por um perfil e não equivale a conteúdo sexual envolvendo criança ou adolescente.
3. **Preservar é diferente de manter publicado.** A mídia pode ser removida da experiência pública e, ao mesmo tempo, ter uma cópia isolada para auditoria, revisão jurídica ou atendimento posterior a uma solicitação legal válida.
4. **Preservação não amplia acesso interno.** Evidência e jobs são backend-only. A sessão administrativa comum não recebe path de Storage, URL ou conteúdo preservado.
5. **Exclusão do produto não destrói evidência em retenção.** A exclusão canônica de foto/vídeo não alcança `system/moderation-evidence/...`.
6. **Compartilhamento externo é etapa separada.** Qualquer eventual fornecimento a autoridade exige base jurídica/procedimento aplicável, validação do solicitante, escopo mínimo necessário e trilha de auditoria.

## Fluxo técnico

```text
usuário denuncia
      ↓
validação callable
(App Check + auth + rate limit + policy)
      ↓
moderation_reports/{reportId}
      ↓
┌───────────────────────────────────────────────┐
│ risco grave?                                  │
│ minor_content_safety / illegal_content /      │
│ sexual_boundary                               │
└───────────────────────────────────────────────┘
      ↓ sim
quarentena imediata
HIDDEN / FLAGGED
      ↓
preservação backend-only
      ↓
moderation_evidence/{reportId}
+ system/moderation-evidence/{reportId}/...
      ↓
revisão humana de moderação
      ├── KEEP   → restaura conteúdo + libera evidência
      └── REMOVE → mantém fora do produto
                    ↓
              caso grave confirmado pela moderação
                    ↓
              moderation_legal_review_cases/{reportId}
                    ↓
              revisão jurídico/compliance
                    ↓
              eventual atendimento legal auditado
```

## Menoridade de perfil x conteúdo envolvendo menor

Os dois fluxos são deliberadamente distintos:

- `minor_safety` em `profile` significa **possível pessoa menor de 18 anos operando o perfil**. A denúncia é um sinal de segurança, não prova de idade, não conclui infração penal e não gera comunicação automática a autoridades. Ela entra na fila crítica; uma pessoa moderadora decide se há indícios suficientes para iniciar revalidação.
- `minor_content_safety` significa **possível criança ou adolescente em conteúdo sexual, íntimo ou exploratório**. Nas superfícies com backend especializado, a primeira denúncia válida provoca quarentena reversível e preservação técnica, sem aguardar volume de denúncias.
- A revalidação etária aceita mais de um caminho confiável de evidência. Data de nascimento informada pelo usuário serve apenas para triagem e não libera acesso adulto. Revisão documental, escalonamento de provedor e KYC de perfil podem ser usados conforme o caso, sem armazenar no caso a referência bruta do documento/provedor.
- O prazo de sete dias usado na revalidação de perfil é **meta operacional da plataforma**, não prazo legal de comprovação e não presunção de menoridade. Envio posterior continua aceito e fica auditado como fora da meta operacional.

## Prazos legais e operacionais

Revisão normativa conferida em 23/09/2026:

- **Aferição de idade:** o Decreto nº 12.880/2026 exige proporcionalidade, confiabilidade, minimização, privacidade, inclusão, transparência e auditabilidade. Também exige meio adequado para contestação da idade ou faixa etária. Para sinais fornecidos por lojas de aplicações e sistemas operacionais, a contestação/retificação com evidência adicional deve receber decisão fundamentada em **prazo razoável**. Não foi identificado prazo legal fixo de sete dias para o usuário desta plataforma responder a uma revalidação.
- **Conteúdo de aparente exploração/abuso sexual, sequestro ou aliciamento:** a Lei nº 15.211/2025 e o Decreto nº 12.880/2026 estabelecem dever de remoção/comunicação; quando o fornecedor identifica material criminoso nas hipóteses regulamentadas, a remoção é imediata e o material/dados associados devem ser preservados para o encaminhamento cabível.
- **Prazo do reporte ao Centro Nacional/PF:** a Lei nº 15.211/2025 determina que requisitos e prazos sejam definidos em regulamento, e o Decreto nº 12.880/2026 delega a ato do Ministério da Justiça e Segurança Pública os protocolos, requisitos e prazos. Em 21/09/2026, o MJSP anunciou oficialmente uma portaria que estabelece o fluxo de comunicação direta de crimes contra crianças e adolescentes ao Centro Nacional da Polícia Federal. A notícia oficial consultada em 23/09/2026 não publica o número do ato nem prazos numéricos. Reportagens sobre a minuta anterior mencionaram 12 horas para risco crível/iminente/em curso, 72 horas para determinados casos de violência sexual e até sete dias para outras ocorrências, mas esses números não devem ser hardcoded até conferência do texto normativo oficial publicado e de seu âmbito exato de incidência.
- **Retenção:** o art. 27, § 2º, da Lei nº 15.211/2025 remete ao prazo do art. 15 do Marco Civil da Internet para dados associados ao relatório, com possibilidade de extensão por requerimento legal. O Decreto nº 12.880/2026 também disciplina a destinação do material após confirmação de recebimento; qualquer rotina de exclusão/preservação deve seguir o procedimento jurídico vigente, não uma regra interna isolada.
- **Recursos de retirada de conteúdo:** o art. 30 da Lei nº 15.211/2025 exige que o fornecedor defina prazos procedimentais para recurso e resposta. Esses prazos devem ser política publicada e auditável; não devem ser confundidos com o prazo operacional de revalidação etária.

Nenhum SLA jurídico deve ser inventado no código. Prazos legais/regulatórios devem ser configurados somente quando houver fonte normativa identificada e revisão de compliance.

## Evidência binária de foto/vídeo

A preservação copia o ativo publicado para namespace isolado:

```text
system/moderation-evidence/{reportId}/photo
system/moderation-evidence/{reportId}/video
```

O manifesto `moderation_evidence/{reportId}` registra metadados técnicos úteis para integridade e auditoria, incluindo `generation`, MD5/CRC32C quando fornecidos pelo Storage, tipo de conteúdo, tamanho, identificadores da mídia e timestamps de preservação.

A cópia não é disponibilizada ao frontend e não recebe URL assinada por nenhum fluxo atual.

## Evidência textual

Comentários de vídeo denunciados recebem snapshot backend-only no momento da denúncia, dentro da mesma transação do report. Isso evita que uma posterior decisão de remoção — que limpa o texto no produto — elimine o único exemplar disponível para auditoria.

Se a denúncia for rejeitada (`KEEP`), o snapshot é liberado. Se a remoção for confirmada (`REMOVE`), ele permanece submetido à política de retenção aplicável.

## Proteção contra destruição concorrente

Enquanto uma publicação está `FLAGGED`:

- o proprietário não pode excluir a foto/vídeo;
- edição/sincronização de foto não substitui o ativo publicado;
- a foto não pode ser republicada para sobrescrever a quarentena;
- a foto não pode ser definida como capa;
- o fluxo legado de `unpublishPhoto` é fail-closed;
- exclusões canônicas usam precondition de versão da publicação quando disponível.

O bypass `allowQuarantined: true` existe somente em chamadas internas da moderação após a preservação necessária.

## Retry e consistência

Falhas transitórias de Storage geram job em:

```text
moderation_evidence_preservation_jobs/{reportId}
```

O scheduler `retryPendingModerationEvidencePreservation` tenta novamente periodicamente. Se uma decisão `REMOVE` já ocorreu, a exclusão do produto só é finalizada depois de `evidencePreservationStatus = PRESERVED`.

A finalização da preservação revalida o report dentro de transação. Se a denúncia tiver sido rejeitada/liberada enquanto a cópia estava em andamento, o objeto de evidência é apagado em vez de ser recriado como evidência ativa.

## Revisão jurídico/compliance

Casos graves com decisão de moderação `REMOVE` geram:

```text
moderation_legal_review_cases/{reportId}
```

Estado inicial:

```text
status: PENDING_LEGAL_REVIEW
authorityDisclosureStatus: NOT_EVALUATED
automaticDisclosure: false
accessPolicy: BACKEND_ONLY
```

Esse caso representa **necessidade de avaliação**, não conclusão penal. O módulo de mídia não possui endpoint de transmissão automática a autoridades e não deve ganhar um sem fluxo jurídico/compliance próprio.

## Atendimento a autoridades

Antes de qualquer fornecimento de dados ou conteúdo preservado, o procedimento futuro deve exigir, no mínimo:

- identificação e validação do órgão/autoridade solicitante;
- tipo de solicitação e fundamento/procedimento legal aplicável;
- identificadores e período claramente delimitados;
- separação entre preservação de dados e entrega efetiva;
- minimização do conjunto fornecido;
- autorização interna compatível com o nível de sensibilidade;
- registro imutável de quem revisou, autorizou e realizou o fornecimento;
- hash/integridade dos arquivos exportados quando aplicável;
- registro de data/hora e escopo de cada exportação;
- política de encerramento/retenção após cessar a obrigação de preservação.

## Referências normativas que afetam a arquitetura

A implementação deve ser mantida em revisão jurídica contínua, especialmente em relação a:

- Lei 12.965/2014 (Marco Civil da Internet), incluindo guarda e fornecimento de registros de acesso a aplicações;
- Decreto 8.771/2016, com alterações posteriores;
- Decreto 12.975/2026, inclusive requisitos relacionados à individualização por porta lógica de origem e procedimentos de preservação/cooperação;
- Lei 15.211/2025 (proteção de crianças e adolescentes em ambientes digitais), em vigor desde 2026, especialmente nos fluxos de possível exploração/abuso sexual de crianças e adolescentes.

A existência de uma categoria interna `minor_safety` não substitui a classificação jurídica necessária para aplicar obrigações específicas.

## Gap P0/P1: registros de acesso a aplicações

Na auditoria atual do repositório não foi localizado um domínio dedicado para retenção de registros de acesso a aplicações com IP/origem, porta lógica quando aplicável, timestamp e política de retenção legal.

**Não corrigir esse gap gravando IP informado pelo cliente em `moderation_reports`.** Isso seria facilmente falsificável e misturaria finalidades.

A solução deve nascer em infraestrutura confiável, considerando que parte relevante do tráfego do app usa Firebase diretamente e não passa por uma única Cloud Function. O desenho deve avaliar, entre outros componentes:

- Cloud Logging e logs de infraestrutura Firebase/GCP disponíveis;
- pontos de borda/serviços que efetivamente observam IP e porta de origem;
- pseudonimização de referência de conta/sessão sem perder capacidade de individualização legal;
- retenção padrão de seis meses quando aplicável e mecanismo de legal hold;
- criptografia, segregação de acesso e trilha de auditoria de consultas/exportações;
- minimização e descarte ao fim do prazo/obrigação.

Esse subsistema deve ser tratado como projeto de compliance/infraestrutura próprio e testado antes de a plataforma afirmar capacidade completa de atendimento a solicitações de registros de acesso.

## Regras de acesso atuais

As Firestore Rules negam acesso direto do cliente — inclusive sessão admin comum — a:

```text
moderation_evidence/{id}
moderation_evidence_preservation_jobs/{id}
moderation_legal_review_cases/{id}
```

As Storage Rules atuais não oferecem ao cliente acesso ao namespace `system/moderation-evidence/...`.

Qualquer futura ferramenta jurídica deverá manter essa separação e utilizar backend autorizado com logging de cada operação.
