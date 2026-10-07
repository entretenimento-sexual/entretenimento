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
