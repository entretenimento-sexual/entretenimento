// src/app/core/services/data-handling/firestore-query.service.ts
import { Injectable } from '@angular/core';
import {
  Firestore, collection, query, where, onSnapshot, QueryConstraint, Timestamp
} from 'firebase/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap, take } from 'rxjs/operators';

import { IUserDados } from '../../interfaces/iuser-dados';
import { CacheService } from '../general/cache/cache.service';
import { FirestoreService } from './firestore.service';
import { FirestoreUserQueryService } from './firestore-user-query.service';
import { GlobalErrorHandlerService } from '../../services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class FirestoreQueryService {
  // memoize streams para evitar múltiplos onSnapshot para a mesma consulta
  private readonly liveStreams = new Map<string, Observable<any[]>>();

  constructor(
    private readonly firestoreService: FirestoreService,
    private readonly cacheService: CacheService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService
  ) { }

  // ————————————————————————————————————————
  // Helpers

  getFirestoreInstance(): Firestore {
    return this.firestoreService.getFirestoreInstance();
  }

  /** Converte uma query em stream reativa (onSnapshot), com compartilhamento */
  private queryToLive$<T>(
    collectionName: string,
    constraints: QueryConstraint[],
    opts?: { idField?: string; key?: string }
  ): Observable<T[]> {
    const db = this.getFirestoreInstance();
    const colRef = collection(db, collectionName);
    const q = query(colRef, ...constraints);

    const key = opts?.key ?? `${collectionName}:${constraints.map(c => (c as any)?._query?.E || c.type || 'q').join('|')}`;

    if (!this.liveStreams.has(key)) {
      const live$ = new Observable<T[]>((observer) => {
        const unsubscribe = onSnapshot(
          q,
          (snap) => {
            const rows = snap.docs.map((d) => {
              const data = d.data() as T;
              return opts?.idField ? ({ ...data, [opts.idField]: d.id } as T) : data;
            });
            observer.next(rows);
          },
          (err) => {
            this.globalError.handleError(err);
            this.notify.showError?.('Erro ao ouvir atualizações do Firestore.');
            observer.error(err);
          }
        );
        return () => unsubscribe();
      }).pipe(
        // 🔁 garante 1 listener por key + reentrega o último valor aos novos subscribers
        shareReplay({ bufferSize: 1, refCount: true })
      );

      this.liveStreams.set(key, live$);
    }

    return this.liveStreams.get(key)! as Observable<T[]>;
  }

  /** Reatividade por “recentes”: usuários com lastSeen dentro de windowMs (default: 45s) */
  getRecentlyOnline$(windowMs = 45_000): Observable<IUserDados[]> {
    // para otimizar, escutamos quem passou por aqui nos últimos 5 minutos
    const fiveMinAgo = Timestamp.fromMillis(Date.now() - 5 * 60_000);
    const key = `recent:lastSeen>=${fiveMinAgo.toMillis()}`;

    return this.queryToLive$<IUserDados>('users', [where('lastSeen', '>=', fiveMinAgo)], {
      idField: 'uid',
      key
    }).pipe(
      map(list => {
        const cutoff = Date.now() - windowMs;
        return list.filter(u => {
          // aceita Timestamp do Firestore ou número/Date eventual
          const t = u && (u as any).lastSeen;
          const ms =
            t instanceof Timestamp ? t.toMillis() :
              typeof t === 'number' ? t :
                t?.toDate?.() instanceof Date ? (t.toDate() as Date).getTime() :
                  0;
          return ms >= cutoff; // “online recente”
        });
      }),
      catchError(() => of([] as IUserDados[]))
    );
  }

  getDocumentById<T>(collectionName: string, id: string): Observable<T | null> {
    return this.firestoreService.getDocument<T>(collectionName, id);
  }

  getDocumentsByQuery<T>(collectionName: string, constraints: QueryConstraint[]): Observable<T[]> {
    return this.firestoreService.getDocuments<T>(collectionName, constraints);
  }

  // ————————————————————————————————————————
  // “All users” pode ficar com cache, pois não exige tempo real
  getAllUsers(): Observable<IUserDados[]> {
    const cacheKey = 'allUsers';
    return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
      switchMap(cached => {
        if (cached) return of(cached);
        return this.getDocumentsByQuery<IUserDados>('users', []).pipe(
          map(users => {
            this.cacheService.set(cacheKey, users, 600_000); // 10 min
            return users;
          }),
          catchError(err => {
            console.log('[FirestoreQueryService] Erro ao buscar todos os usuários:', err);
            return of<IUserDados[]>([]);
          })
        );
      })
    );
  }

  // ————————————————————————————————————————
  // ONLINE — versão reativa (recomendada)
  getOnlineUsers$(): Observable<IUserDados[]> {
    return this.queryToLive$IUser('isOnline:true', [where('isOnline', '==', true)]);
  }
  private queryToLive$IUser(key: string, constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.queryToLive$<IUserDados>('users', constraints, { idField: 'uid', key }).pipe(
      catchError(() => of([] as IUserDados[]))
    );
  }

  // ONLINE — leitura única (retrocompat), **sem cache** para não travar a UI
  getOnlineUsers(): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', [where('isOnline', '==', true)]).pipe(
      take(1),
      catchError(() => of([] as IUserDados[]))
    );
  }

  // ————————————————————————————————————————
  // Filtros adicionais

  getUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', [where('municipio', '==', municipio)]);
  }

  // 🔁 Reativo por município (online)
  getOnlineUsersByMunicipio$(municipio: string): Observable<IUserDados[]> {
    return this.queryToLive$IUser(`isOnline:true|mun:${municipio}`, [
      where('isOnline', '==', true),
      where('municipio', '==', municipio)
    ]);
  }

  // compat atual (não-reativo)
  getOnlineUsersByMunicipio(municipio: string): Observable<IUserDados[]> {
    return this.getOnlineUsers().pipe(
      map(users => users.filter(u => u.municipio === municipio))
    );
  }

  // Removida a variação manual de onSnapshot: use a versão $ acima
  // Mantive um alias reativo por "região", caso queira
  getOnlineUsersByRegion(municipio: string): Observable<IUserDados[]> {
    return this.getOnlineUsersByMunicipio$(municipio);
  }

  getSuggestedProfiles(): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', []);
  }

  getProfilesByOrientationAndLocation(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', [
      where('gender', '==', gender),
      where('orientation', '==', orientation),
      where('municipio', '==', municipio),
    ]);
  }

  getUserFromState(uid: string): Observable<IUserDados | null> {
    return this.firestoreUserQuery.getUserWithObservable(uid);
  }

  searchUsers(constraints: QueryConstraint[]): Observable<IUserDados[]> {
    return this.getDocumentsByQuery<IUserDados>('users', constraints);
  }
}
