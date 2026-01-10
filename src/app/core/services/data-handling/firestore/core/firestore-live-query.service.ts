// src/app/core/services/data-handling/firestore-live-query.service.ts
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, onSnapshot, query, QueryConstraint } from 'firebase/firestore';
import { Observable, defer, throwError } from 'rxjs';
import { catchError, finalize, shareReplay } from 'rxjs/operators';
import { GlobalErrorHandlerService } from '../../../error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../../error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class FirestoreLiveQueryService {
  /**
   * Cache de streams por key.
   * Importante: a key PRECISA distinguir queries diferentes.
   * Se colidir, você “reaproveita” o stream errado (bug fantasma).
   */
  private readonly liveStreams = new Map<string, Observable<any[]>>();

  constructor(
    private readonly db: Firestore,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService
  ) { }

  getFirestoreInstance(): Firestore {
    return this.db;
  }

  /**
   * Stream realtime (onSnapshot) com cache por key + shareReplay(refCount).
   *
   * ✅ Correção principal:
   * - A key agora considera detalhes dos QueryConstraints (não só “tipo”).
   * - Também considera idField (pois muda o shape do retorno).
   * - Se algo der errado na montagem da key, cai para “sem cache” (evita colisão silenciosa).
   *
   * ✅ Correção secundária:
   * - Tudo é criado via defer() para capturar throws síncronos (ex.: collectionName inválido)
   *   e encaminhar pro handler centralizado.
   */
  liveQuery$<T>(
    collectionName: string,
    constraints: QueryConstraint[] = [],
    opts?: { idField?: string; key?: string }
  ): Observable<T[]> {
    const idField = opts?.idField;
    const explicitKey = (opts?.key ?? '').trim();

    // 1) Key explícita tem prioridade total (controle do chamador).
    // 2) Sem key explícita: tenta gerar uma key “forte” (sem colisões comuns).
    // 3) Se ainda assim falhar (muito improvável), roda sem cache.
    const autoKey = !explicitKey ? this.buildKey(collectionName, constraints, { idField }) : null;
    const key = explicitKey || autoKey || null;

    // Cache só se tiver key válida
    if (key) {
      const existing = this.liveStreams.get(key);
      if (existing) return existing as Observable<T[]>;
    }

    const source$ = defer(() => {
      // Validações mínimas (evita throws imprevisíveis)
      const col = (collectionName ?? '').trim();
      if (!col) {
        return throwError(() => this.enrichError(new Error('collectionName inválido.'), {
          collectionName,
          constraintsCount: constraints?.length ?? 0,
        }));
      }

      // Monta a query dentro do defer (captura erros síncronos)
      const colRef = collection(this.db as any, col);
      const q = query(colRef, ...(constraints ?? []));

      return new Observable<T[]>((observer) => {
        const unsubscribe = onSnapshot(
          q,
          (snap) => {
            const rows = snap.docs.map((d) => {
              const data = d.data() as T;

              // idField muda o shape — por isso entra na key também
              return idField ? ({ ...(data as any), [idField]: d.id } as T) : data;
            });

            observer.next(rows);
          },
          (err) => {
            // Tratamento centralizado: log/observabilidade + feedback ao usuário
            this.globalError.handleError(
              this.enrichError(err, {
                collectionName: col,
                keyUsed: key ?? '(no-cache)',
                idField: idField ?? null,
                constraintsSig: this.safeConstraintsSig(constraints),
                source: 'FirestoreLiveQueryService.liveQuery$',
              })
            );

            // Notificação visual (se existir no serviço)
            // Evita vazar detalhes internos, mas dá contexto suficiente.
            const code = String((err as any)?.code ?? '').toLowerCase();
            const msg =
              code === 'permission-denied'
                ? 'Sem permissão para ouvir atualizações.'
                : 'Erro ao ouvir atualizações do Firestore.';

            this.notify.showError?.(msg);

            observer.error(err);
          }
        );

        return () => unsubscribe();
      });
    }).pipe(
      // ✅ remove do cache quando o último subscriber sair (refCount) OU se o stream der erro
      finalize(() => {
        if (key) this.liveStreams.delete(key);
      }),
      // ✅ compartilha o listener entre subscribers e encerra quando não houver inscritos
      shareReplay({ bufferSize: 1, refCount: true }),
      // ✅ se qualquer coisa “escapar”, cai no tratamento centralizado
      catchError((err) => {
        this.globalError.handleError(
          this.enrichError(err, {
            collectionName,
            keyUsed: key ?? '(no-cache)',
            idField: idField ?? null,
            source: 'FirestoreLiveQueryService.liveQuery$ (outer)',
          })
        );
        this.notify.showError?.('Erro ao ouvir atualizações do Firestore.');
        return throwError(() => err);
      })
    );

    if (key) this.liveStreams.set(key, source$ as Observable<any[]>);

    return source$;
  }

  /**
   * ✅ Key “forte” para evitar colisões.
   * Antes era só `collectionName + tipoDosConstraints`, o que colide fácil:
   * - where(municipio=='RJ') e where(municipio=='SP') -> ambos “where”
   *
   * Agora:
   * - inclui idField
   * - inclui assinatura estável dos constraints (com serialização segura)
   * - limita tamanho (hash) para evitar keys gigantes
   */
  private buildKey(
    collectionName: string,
    constraints: QueryConstraint[],
    opts?: { idField?: string }
  ): string | null {
    try {
      const col = (collectionName ?? '').trim();
      if (!col) return null;

      const idField = (opts?.idField ?? '').trim();
      const sig = this.safeConstraintsSig(constraints);

      const raw = `col=${col}|idField=${idField || '-'}|q=${sig}`;
      // Evita keys enormes (local) — hash estável
      return raw.length > 600 ? `fs_live:${this.hashString(raw)}` : `fs_live:${raw}`;
    } catch {
      // Se falhar por qualquer motivo, NÃO cacheia (melhor do que colidir)
      return null;
    }
  }

  /**
   * Produz uma assinatura estável dos QueryConstraints.
   * Faz “best effort”: tenta extrair props internas (inclusive não-enumeráveis)
   * com limite de profundidade e sem risco de ciclo infinito.
   */
  private safeConstraintsSig(constraints: QueryConstraint[] = []): string {
    const parts = (constraints ?? []).map((c) => this.constraintToSig(c));
    const joined = parts.join('&');
    return joined.length > 900 ? this.hashString(joined) : joined;
  }

  private constraintToSig(c: any): string {
    if (!c) return 'q:null';

    const type = String(c?.type ?? c?._type ?? c?.constructor?.name ?? 'q');

    // tenta capturar detalhes relevantes sem depender de API pública instável
    const snapshot = this.safeStableStringify(c, 3);
    // reduz ruído: se ficar vazio, ao menos diferencia por tipo
    return snapshot && snapshot !== '{}' ? `${type}:${snapshot}` : `${type}`;
  }

  /**
   * Stringify estável:
   * - inclui props não-enumeráveis (getOwnPropertyNames)
   * - ordena chaves
   * - limita profundidade
   * - trata objetos “conhecidos” (Timestamp/FieldPath/etc) por toString/canonical
   */
  private safeStableStringify(value: any, maxDepth = 3): string {
    const seen = new WeakSet<object>();

    const normalize = (v: any, depth: number): any => {
      if (v === null || v === undefined) return v;
      const t = typeof v;

      if (t === 'string' || t === 'number' || t === 'boolean') return v;

      // BigInt não serializa em JSON padrão
      if (t === 'bigint') return v.toString();

      // Funções não entram (evita ruído)
      if (t === 'function') return '[fn]';

      // Datas
      if (v instanceof Date) return v.toISOString();

      // Timestamp-like (firebase)
      if (typeof v?.toMillis === 'function') return `ts:${v.toMillis()}`;
      if (typeof v?.seconds === 'number' && typeof v?.nanoseconds === 'number') {
        return `ts:${v.seconds}.${v.nanoseconds}`;
      }

      // FieldPath-like
      if (typeof v?.canonicalString === 'function') return `fp:${v.canonicalString()}`;
      if (typeof v?.toString === 'function' && v?.toString !== Object.prototype.toString) {
        const s = v.toString();
        // evita [object Object]
        if (s && s !== '[object Object]') return s;
      }

      if (Array.isArray(v)) {
        if (depth <= 0) return '[array]';
        return v.map((x) => normalize(x, depth - 1));
      }

      if (t === 'object') {
        if (seen.has(v)) return '[cycle]';
        seen.add(v);

        if (depth <= 0) return '[object]';

        const out: Record<string, any> = {};
        const keys = Object.getOwnPropertyNames(v).sort();

        for (const k of keys) {
          // corta ruído de campos gigantes se aparecerem
          if (k.length > 60) continue;
          try {
            out[k] = normalize(v[k], depth - 1);
          } catch {
            out[k] = '[unreadable]';
          }
        }

        return out;
      }

      // fallback
      return String(v);
    };

    try {
      return JSON.stringify(normalize(value, maxDepth));
    } catch {
      return '{}';
    }
  }

  /** Hash simples e estável (djb2) para reduzir tamanho de key */
  private hashString(input: string): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    // unsigned
    return (hash >>> 0).toString(16);
  }

  /** Enriquecimento de erro com contexto (sem quebrar o handler global) */
  private enrichError(err: any, context: Record<string, unknown>): any {
    try {
      // se já for Error, anexa contexto
      if (err instanceof Error) {
        (err as any).context = { ...(err as any).context, ...context };
        return err;
      }

      // se vier objeto simples do firebase, embrulha
      const e = new Error(String(err?.message ?? err ?? 'Firestore error'));
      (e as any).original = err;
      (e as any).code = err?.code;
      (e as any).context = context;
      return e;
    } catch {
      return err;
    }
  }
}// linha 302
