// src/app/core/services/batepapo/room-services/room.service.ts
// Serviço para gerenciamento de salas de bate-papo usando Firestore
// Não esquecer os comentários e ferramentas de debug para facilitar a manutenção futura
import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, query, where, onSnapshot, getDocs, doc } from 'firebase/firestore';
import { Observable, defer, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { IRoom } from 'src/app/core/interfaces/interfaces-chat/room.interface';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class RoomService {
  private db = inject(Firestore);
  private notify = inject(ErrorNotificationService);
  private globalError = inject(GlobalErrorHandlerService);

  /** Guard de UID (evita listener/query inválida) */
  private requireUid(userId: string): string {
    const uid = (userId ?? '').trim();
    if (!uid) throw new Error('UID ausente para consulta de salas.');
    return uid;
  }

  private report(err: unknown, context: Record<string, unknown>): void {
    try {
      const e = new Error('[RoomService] operação falhou');
      (e as any).feature = 'rooms';
      (e as any).original = err;
      (e as any).context = context;
      (e as any).skipUserNotification = true; // evita toast duplicado no handler global
      this.globalError.handleError(e);
    } catch { /* noop */ }
  }

  async countUserRooms(userId: string): Promise<number> {
    const uid = this.requireUid(userId);

    try {
      // Firebase (firestore) direto: ok, mas mantenha claro que aqui NÃO é AngularFire Observable.
      const roomsCol = collection(this.db as any, 'rooms');
      const q = query(roomsCol, where('createdBy', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.length;
    } catch (error) {
      this.report(error, { op: 'countUserRooms', uid });
      this.notify.showError('Erro ao contar salas do usuário.');
      throw error;
    }
  }

  getUserRooms(userId: string): Observable<IRoom[]> {
    return defer(() => {
      const uid = this.requireUid(userId);

      const roomsCol = collection(this.db as any, 'rooms');
      const q = query(roomsCol, where('createdBy', '==', uid));

      return new Observable<IRoom[]>(observer => {
        const unsubscribe = onSnapshot(q, snapshot => {
          const rooms: IRoom[] = snapshot.docs.map(d => {
            const data = d.data() as any;
            return {
              id: d.id,
              roomName: data['roomName'],
              createdBy: data['createdBy'],
              participants: data['participants'] ?? [],
              creationTime: data['creationTime'] ?? data['createdAt'] ?? data['timestamp'] ?? new Date(),
              lastActivity: data['lastActivity'],
              description: data['description'],
              maxParticipants: data['maxParticipants'],
              isPrivate: data['isPrivate'],
              roomType: data['roomType'],
              visibility: data['visibility'],
            };
          });
          observer.next(rooms);
        }, err => {
          this.report(err, { op: 'getUserRooms', uid });
          this.notify.showError('Erro ao carregar salas do usuário.');
          observer.error(err);
        });

        return () => unsubscribe();
      });
    }).pipe(
      catchError(err => throwError(() => err))
    );
  }

  getRooms(userId: string): Observable<IRoom[]> {
    return defer(() => {
      const uid = this.requireUid(userId);

      const roomsCol = collection(this.db as any, 'rooms');
      const q = query(roomsCol, where('participants', 'array-contains', uid));

      return new Observable<IRoom[]>(observer => {
        const unsubscribe = onSnapshot(q, snapshot => {
          const rooms: IRoom[] = snapshot.docs.map(d => {
            const data = d.data() as any;
            return {
              id: d.id,
              roomName: data['roomName'],
              createdBy: data['createdBy'],
              participants: data['participants'] ?? [],
              creationTime: data['creationTime'] ?? data['createdAt'] ?? data['timestamp'] ?? new Date(),
              lastActivity: data['lastActivity'],
              description: data['description'],
              maxParticipants: data['maxParticipants'],
              isPrivate: data['isPrivate'],
              roomType: data['roomType'],
              visibility: data['visibility'],
            };
          });
          observer.next(rooms);
        }, err => {
          this.report(err, { op: 'getRooms', uid });
          this.notify.showError('Erro ao carregar as salas.');
          observer.error(err);
        });

        return () => unsubscribe();
      });
    });
  }

  getRoomById(roomId: string): Observable<IRoom> {
    return defer(() => {
      const id = (roomId ?? '').trim();
      if (!id) return throwError(() => new Error('roomId ausente.'));

      const roomRef = doc(this.db as any, 'rooms', id);

      return new Observable<IRoom>(observer => {
        const unsubscribe = onSnapshot(roomRef, snapshot => {
          if (!snapshot.exists()) {
            observer.error('Sala não encontrada.');
            return;
          }
          const data = snapshot.data() as any;
          observer.next({
            id: snapshot.id,
            roomName: data['roomName'],
            createdBy: data['createdBy'],
            participants: data['participants'] ?? [],
            creationTime: data['creationTime'] ?? data['createdAt'] ?? data['timestamp'] ?? new Date(),
            lastActivity: data['lastActivity'],
            description: data['description'],
            maxParticipants: data['maxParticipants'],
            isPrivate: data['isPrivate'],
            roomType: data['roomType'],
            visibility: data['visibility'],
          });
        }, err => {
          this.report(err, { op: 'getRoomById', roomId: id });
          this.notify.showError('Erro ao carregar informações da sala.');
          observer.error(err);
        });

        return () => unsubscribe();
      });
    });
  }
}
