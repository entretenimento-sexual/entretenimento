# D.2.1A — Auditoria das três réplicas e contabilidade de tentativas

Base 1cd7118: três workflows e Quality Gate / aggregate aprovados.
Angular 3384/3384, RequestsRepo 11/11, Rules 391/391. Cada réplica
recuperou 181 mensagens, 20 PASS e zero respostas HTTP 429.

Artefatos r1=15129116204, r2=15128641588, r3=15128297207.
Carga original: respostas 22/15/18; inícios registrados pelo logger
24/23/25; ERR_ABORTED 2/8/7. Mediana de respostas 18; mediana de
inícios 24. Carga total: respostas 47/36/40, inícios 52/51/53.
Por origem total: session 38/38/39, canonical-event 12/12/12,
poll 2/0/2, profile 0/1/0. Profile join em r1/r3; leitura fresca em r2.
As 12 consultas canônicas por réplica são consistentes.
Os documentos do navegador são recriados por page.goto no roteiro
(incluindo deep links), abortando requisições em voo. Contar respostas
apenas distorce a comparação. ERR_ABORTED no cliente não prova
cancelamento no servidor; inícios não são operações Firestore faturadas.
Não comparar inícios com referências históricas de respostas como se
fossem a mesma métrica.

Correção restrita à certificação: cada POST observado pelo Playwright
agora tem um registro por tentativa, com status HTTP e falha de
transporte independentes. Mantém os artefatos antigos e a carga
original; adiciona pending-read-attempts.json e pending-read-accounting.json,
eventos document-request e testes unitários do particionamento.
Nenhuma URL completa, UID, token ou payload armazenado pela nova métrica.
Sem alteração na autorização, polling, quotas ou código funcional.
As três réplicas e todos os gates existentes continuam obrigatórios.

Não há evidência de que a leitura fresca de perfil em r2 seja
redundância eliminável sem enfraquecer a garantia de frescor.
A homologação funcional de 1cd7118 não equivale a uma economia
quantitativa demonstrada. D.2.2 permanece condicionada à certificação
quantitativa; medir também navegação SPA controlada e custo backend
em etapa complementar.
