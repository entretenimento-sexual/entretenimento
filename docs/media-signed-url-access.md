# Autorização de mídias por URL temporária

## Fonte de autoridade

- A Function é a fronteira de emissão. O backend consulta lifecycle e elegibilidade da conta em cada lote de autorização, e para mídias públicas também consulta exposição da publicação, vínculo social e bloqueio bilateral.
- O frontend mantém URLs apenas em memória, particionadas por sessão/UID e versão do ativo; troca de sessão descarta resultados atrasados. NgRx e snapshots persistentes não devem armazenar URLs assinadas.
- Fotos e vídeos públicos têm TTL técnico de cinco minutos. Vídeos privados preservam, por compatibilidade com o playback e refresh atuais, dez minutos. Em ambos os casos um deadline de acesso da conta pode encurtar o TTL, mas **não** estende o prazo.
- Vídeo público obtém poster em PREVIEW e playback somente sob demanda. O mesmo princípio vale para a biblioteca privada, evitando assinar arquivos de vídeo desnecessariamente.
- A Function `getPrivateVideoAccessUrls` revalida `assertInteractionAccess` uma vez por lote. O aumento de custo é de uma leitura do documento do usuário por chamada; não há proxy de bytes pelo backend.

## Limite de revogação

URL V4 já emitida é uma credencial bearer independente da sessão Angular. Suspensão, bloqueio, exclusão de uma publicação ou logout impedem novas emissões após propagação do estado ao backend, mas não invalidam automaticamente URLs emitidas antes da decisão. O limite residual é o prazo remanescente da assinatura, além de downloads/respostas cacheadas já obtidos. URLs não impedem cópia, gravação nem captura de tela.

Para incidentes que exigem interrupção antes do vencimento, avaliar uma ação operacional explícita sobre o objeto de Storage (quarentena/indisponibilização, preservando evidência quando cabível). Gateways com autorização por requisição ou segmentação com nova autorização devem ser reservados a um requisito comprovado de revogação forte: proxy indiscriminado de vídeo elevaria tráfego, processamento, latência e custo.

No Storage Emulator, a implementação utiliza download token técnico determinístico e **não implementa a expiração V4 real**. Testes que exigem expiração criptográfica devem usar ambiente controlado de integração fora do emulador.

## Verificações de regressão

- Bloquear novas autorizações após suspensão/inativação/termos ou consentimento pendentes.
- Troca A→B ou logout durante chamada em voo não podem repovoar cache com URL antiga.
- URLs públicas e privadas respeitam o deadline de Account Access quando disponível.
- Vídeos longos e seeks/Range devem ser testados antes de reduzir TTL do playback privado.
- Não renovar periodicamente URLs de playback de vídeo que ainda não está em uso; não colocar URLs em logs ou métricas.


## Biblioteca privada: emissão sob demanda e custo

- `watchPrivateVideos$` permanece como nome de compatibilidade, mas emite apenas metadados e capas temporárias. **Não emite URLs de playback**. A renovação de oito minutos atende apenas as capas enquanto houver assinantes da UI.
- `hydrateOwnedVideoAccess$` é a API explícita para acesso de playback. Consumidores devem chamá-la somente quando um vídeo efetivamente for reproduzido; não utilizar para carregar uma grade/lista inteira.
- O cache LRU de capas usa somente memória, no máximo 128 entradas, particionado por sessão, UID, vídeo e revisão. Um deadline de dois minutos e trinta segundos antecipa a expiração de URLs de dez minutos. Mutações frequentes de metadados reutilizam a URL ainda elegível, evitando novas leituras/assinaturas.
- Solicitações PREVIEW concorrentes com o mesmo lote e sessão são compartilhadas enquanto estiverem em voo, inclusive quando novos snapshots substituem o Observable anterior. Respostas antigas são descartadas na troca de sessão, inclusive logout seguido de novo login do mesmo UID.
- O backend continua sendo autoridade em cada emissão. Cache Angular não garante revogação imediata de uma URL previamente assinada nem concede autorização nova.
- Não é necessário proxy, worker de renovação, polling global ou persistência adicional para esse fluxo. O benefício econômico é evitar assinatura de arquivos completos sem reprodução, coalescer requisições e eliminar renovações de posters causadas apenas por emissões repetidas de metadados.

## Capas privadas por visibilidade e ciclo de vida

- Na biblioteca do perfil, os cards são renderizados imediatamente com os metadados do NgRx e um placeholder estável; capas temporárias são pedidas somente para cards dentro da viewport ou da margem de 320px do `IntersectionObserver`. O `loading="lazy"` do navegador permanece ativo.
- Entradas simultâneas são agrupadas por 75 ms e enviadas em um único lote. Não se envia nenhum vídeo fora da lista corrente do proprietário; o limite continua 60.
- Ao sair da margem, o card deixa de receber URL na projeção efêmera; se retornar, a capa ainda válida é reaproveitada do cache de sessão, sem nova assinatura.
- Sem suporte a `IntersectionObserver`, o navegador conserva o carregamento clássico da grade, evitando cards permanentemente sem capa. Na renderização SSR não se dispara autorização especulativa.
- O timer de oito minutos só está ativo quando a aba está visível e a UI tem assinantes. `visibilitychange` para oculto interrompe o timer e evita novas chamadas; ao voltar, o sistema reconcilia apenas os cards próximos e só renova URLs perto da expiração.
- Medição com privacidade: debug local opt-in `DEBUG_MEDIA=1` registra apenas quantidades totais/próximas/puladas; a callable de PREVIEW registra amostras de 5% dos tamanhos de lote, capas liberadas e falhas no Cloud Logging, **sem UID, ID do vídeo, URLs, paths ou novos documentos no Firestore**. Trata-se de proxies de trabalho evitado, não de valor financeiro faturado. A amostragem pode gerar custo mínimo de ingestão de logs; avaliar com o billing real.
- Não confundir proximidade visual com visualização real, nem usar esses indicadores como prova de reprodução, exposição comercial ou elegibilidade de monetização.
