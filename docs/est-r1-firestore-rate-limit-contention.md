# EST-R1.3 — contenção transacional de quotas

Base: 9879083b, CI integralmente aprovada. A fila local serializa somente
consumeBackendRateLimitQuota por ID canônico action/subject, sem alterar
hash, coleção, política, custo, schema, expiração ou decisão de quota.
Cada solicitação admitida executa sua própria transação. Não existe cache
positivo, fusão de permissões ou bypass de transação. O cache negativo é
reavaliado após espera; só a negativa de quota alimenta esse cache.

Limites locais: 16 aguardando por documento, 2048 documentos ativos por
processo, até 5 segundos de espera (não de execução). Excesso retorna
unavailable, sem autorização ou cache de bloqueio. A transação já iniciada
não é interrompida; sua fila avança após conclusão ou erro. Relógio real
é lido ao adquirir a fila; timestamp explícito de testes permanece intacto.
A decisão transacional e retries do SDK continuam sendo autoridade entre
instâncias. Não há retry adicional que possa duplicar consumo ambíguo.

consumeBackendRateLimitQuotaInTransaction permanece sem alteração: quem
combina efeitos de domínio e quota mantém atomicidade na transação externa.
A fila não serializa instâncias distintas nem transações externas e não
promete eliminar toda contenção no Firestore. Homologação com emulador,
medição de latência/erros e carga concorrente multi-instância ainda exigidas.
Testes puros da fila cobrem contabilização ponderada, isolamento de chaves,
falha, saturação e expiração; não são testes de Firestore real.
