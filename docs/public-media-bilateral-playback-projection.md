# Projeção derivada de acesso bilateral à mídia pública

A autoridade do bloqueio permanece em `users/{uid}/blocks/{peerUid}`, consultada
pelas Firestore Rules e Functions antes de cada nova URL assinada. A projeção
`public_media_access/{viewerUid}/owners/{ownerUid}` é **somente um sinal de
revogação da UI**, não uma concessão de acesso ou política de maioridade.

- O backend mantém ambas as perspectivas na mesma transação de block/unblock,
  independentemente de amizade, com `{ available: boolean, version: 1, updatedAt }`.
- Somente o espectador lê por `get` seu documento; não há `list` nem escrita
  de cliente. Nenhum campo inclui autor, direção, motivo ou evidência de bloqueio.
- A Callable `reconcilePublicMediaAccess`, autenticada e limitada por quota,
  reconcilia apenas um par em caso de documento antigo/ausente. Ela lê os dois
  bloqueios em transação, escreve **apenas na projeção do solicitante** e
  retorna `{ reconciled: true }`. A consulta passiva de um vídeo não cria um
  registro reverso de visita na área privada do autor.
- A UI observa a projeção do **vídeo aberto**, não cada card e não faz polling.
  Falha de reconciliação nega a observação; na reconciliação bem-sucedida aguarda
  o snapshot atualizado antes de decidir.
- Contas e mídia continuam sujeitas às validações backend de sessão, lifecycle,
  bloqueios, publicação e moderação. URLs V4 já assinadas não são revogadas
  retroativamente, podendo durar até cinco minutos.
- A disponibilidade binária, consultada para um par específico, não garante
  ocultação absoluta da existência de uma restrição. Não comunica sua direção.
- Em release, Functions e regras correspondentes precisam ser disponibilizadas
  junto com o frontend; clientes antigos não devem ser utilizados como
  evidência de funcionamento desta observação. Nenhum deploy é feito aqui.

## Expurgo da projeção
- `ownerUid` é armazenado em cada projeção para permitir exclusão paginada
  de referências passivas ao autor; o campo replica o UID presente no caminho.
- A retenção de vínculos arquiva bloqueios e eventos em `block_security_audit`
  antes de apagar os estados operacionais. A remoção de cada bloqueio elimina
  atomicamente as projeções correspondentes.
- O expurgo de `relationship_edges` remove também projeções pertencentes à
  conta e referências inbound via índice de collection group `owners.ownerUid`.
  Se houver paginação incompleta, a finalização é bloqueada para novo retry.
- A checagem de bloqueios na emissão de URLs continua usando estados canônicos,
  jamais essas projeções derivadas.

## Serialização com exclusão de conta
- O documento canônico do proprietário precisa continuar com `accountStatus=active`
  no momento da transação. Contas `pending_deletion`, `deleted` ou ausentes
  não podem criar novas projeções; documentos derivados antigos são removidos.
- A reconciliação lê o documento do proprietário na mesma transação que
  escreve a projeção. A transição de lifecycle concorrente provoca retry
  transacional e impede que uma leitura antiga de `active` recrie registros
  após a limpeza paginada.
