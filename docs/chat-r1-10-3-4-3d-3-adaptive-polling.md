# CHAT-R1.10.3.4.3D.3 — Polling adaptativo

Base homologada: 0225f1c. Implementação sujeita à certificação independente; **não homologada**.

## Auditoria
RequestsRepo mantinha um timer de 60 s por direção/geração, independentemente de saúde do listener, conectividade ou visibilidade. O compartilhamento, a invalidação canônica direcional e a proteção de sessão já existiam; não eram o problema. A consulta periódica saudável podia repetir uma leitura sem alteração canônica. NetworkStatusService capturava o estado inicial na construção; agora captura na assinatura da fonte, inclusive após refCount zero.

## Política
- Listener confirmado pelo servidor, revisão válida e visível: 120 s.
- Listener confirmado e oculto: 180 s.
- Listener degradado/revisão desconhecida: 60 s, inclusive oculto.
- Offline explícito: suspende a periodicidade dos watches; operações explícitas mantêm seu contrato de erro. Reconexão/retorno à visibilidade reconciliam, com coalescência de 5 s desde o último início. Metadados de cache não avançam revisões.
- Um relógio por direção/geração; mudanças de política não cancelam leitura em curso. Invalidação canônica ainda invalida a geração anterior. Compartilhamento SessionReadInFlight, exhaustMap, takeUntil e resetOnRefCountZero preservados. Erros mantêm o tratamento centralizado e os retries existentes.
- Prazos são de agendamento enquanto o navegador executa; não garantem resposta de rede nem execução em aba congelada. Nenhuma alteração de quotas, autorização ou cache de respostas.

Projeção em repouso online, por direção: 60 consultas/h na base, 30/h visível (-50%) e 20/h oculto (-66,7%), excluindo bootstrap, eventos e retornos. Degradado mantém 60/h. São projeções, não resultados de Chromium.

## Certificação
Base: 3.386 testes Angular, 63 cenários Chromium, 191 tentativas das três cargas (148 HTTP, 40 abortos, 3 inconclusivas), 13 SPA por réplica, 24 resiliência, zero HTTP 429, zero consultas em 65 s após logout, 181 mensagens recuperadas nas três réplicas.
Preservadas as quatro cargas. SPA aguarda até 205 s pelo novo prazo de polling. Resiliência mantém e amplia a observação anônima para 185 s. Nova carga adaptativa separada: 65 s visível e 65 s oculto sem polling, retorno, offline real 65 s, reconexão, mutação canônica direcional, logout e 185 s anônimos. Visibilidade é entrada DOM controlada, não prova de throttling real do SO. Teste virtual verifica deadlines, degradação, isolamento e descarte. Artefatos: adaptive-polling-samples.json, pending-read-accounting.json, result.json. Contabilização das quatro cargas anteriores separada da nova. Valores reais e regressões dependem do CI; não homologar nesta intervenção.
