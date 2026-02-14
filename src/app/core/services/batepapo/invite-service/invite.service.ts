// src/app/core/services/batepapo/invite.service.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, doc, getDocs, query, where, runTransaction,
  updateDoc, addDoc, Timestamp, setDoc, deleteDoc
} from 'firebase/firestore';
import { Observable, from, throwError, forkJoin } from 'rxjs';
import { map, catchError, switchMap, tap } from 'rxjs/operators';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { DistanceCalculationService } from '../../geolocation/distance-calculation.service';

@Injectable({ providedIn: 'root' })
export class InviteService {
  constructor(
    private db: Firestore, // ⬅️ injeta Firestore
    private errorNotifier: ErrorNotificationService,
    private firestoreQuery: FirestoreQueryService,
    private distanceService: DistanceCalculationService
  ) { }

  sendInvite(invite: Invite): Observable<void> {
    const invitesCollection = collection(this.db, 'invites');
    return from(addDoc(invitesCollection, invite)).pipe(
      map(() => void 0),
      catchError(error => {
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => error);
      })
    );
  }

  sendInviteToRoom(roomId: string, inviteData: Invite): Observable<void> {
    const inviteRef = doc(collection(this.db, `rooms/${roomId}/invites`));
    return from(setDoc(inviteRef, inviteData)).pipe(
      map(() => void 0),
      catchError(error => {
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => error);
      })
    );
  }

  sendInvitesToNearbyUsers(
    roomId: string,
    roomName: string,
    inviter: IUserDados,
    maxDistanceKm = 50
  ): Observable<void> {
    if (!inviter?.uid || !inviter.latitude || !inviter.longitude) {
      this.errorNotifier.showError('Dados do convidante inválidos.');
      return throwError(() => new Error('Dados do convidante inválidos.'));
    }

    return from(this.firestoreQuery.searchUsers([
      where('latitude', '>', 0),
      where('longitude', '>', 0),
    ])).pipe(
      map(users => users.filter(user => {
        const distance = this.distanceService.calculateDistanceInKm(
          inviter.latitude!, inviter.longitude!, user.latitude!, user.longitude!, maxDistanceKm
        );
        return user.uid !== inviter.uid && distance !== null;
      })),
      switchMap(nearbyUsers => {
        const now = Timestamp.fromDate(new Date());
        const expires = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
        const tasks = nearbyUsers.map(user =>
          this.createInvite({
            roomId, roomName,
            receiverId: user.uid,
            senderId: inviter.uid,
            status: 'pending',
            sentAt: now,
            expiresAt: expires,
          })
        );
        return forkJoin(tasks).pipe(map(() => void 0));
      }),
      tap(() => console.log('Convites enviados com sucesso.')),
      catchError(error => {
        this.errorNotifier.showError('Erro ao enviar convites.');
        return throwError(() => error);
      })
    );
  }

  createInvite(inviteData: Invite): Observable<void> {
    if (!inviteData.roomName?.trim()) {
      this.errorNotifier.showError('O nome da sala é obrigatório.');
      return throwError(() => new Error('Nome da sala é obrigatório.'));
    }
    return from(addDoc(collection(this.db, 'invites'), { ...inviteData })).pipe(
      map(() => void 0),
      catchError(error => {
        this.errorNotifier.showError('Erro ao criar convite.');
        return throwError(() => error);
      })
    );
  }

  updateInviteStatus(inviteId: string, status: 'accepted' | 'declined'): Observable<void> {
    const inviteRef = doc(this.db, `invites/${inviteId}`);
    return from(updateDoc(inviteRef, { status })).pipe(
      map(() => void 0),
      catchError(error => {
        this.errorNotifier.showError('Erro ao atualizar status do convite.');
        return throwError(() => error);
      })
    );
  }

  getInvites(userId: string): Observable<Invite[]> {
    const invitesQuery = query(collection(this.db, 'invites'), where('receiverId', '==', userId));
    return from(getDocs(invitesQuery)).pipe(
      map(snapshot =>
        snapshot.docs.map(d => ({ id: d.id, ...(d.data() as Invite) })) // 👈 agora vem o id
      ),
      catchError(error => {
        this.errorNotifier.showError('Erro ao carregar convites.');
        return throwError(() => error);
      })
    );
  }

  sendInviteWithTransaction(invite: Invite): Observable<void> {
    return from(runTransaction(this.db, async (transaction) => {
      const inviteRef = doc(collection(this.db, 'invites'));
      const existing = query(
        collection(this.db, 'invites'),
        where('receiverId', '==', invite.receiverId),
        where('roomId', '==', invite.roomId)
      );
      const snap = await getDocs(existing);
      if (!snap.empty) throw new Error('Convite já existente.');
      transaction.set(inviteRef, invite);
    })).pipe(
      map(() => void 0),
      catchError(error => {
        this.errorNotifier.showError('Erro ao enviar convite.');
        return throwError(() => error);
      })
    );
  }

  updateExpiredInvites(): Observable<void> {
    const now = Timestamp.fromDate(new Date());
    const invitesCol = collection(this.db, 'invites');
    const q = query(invitesCol, where('status', '==', 'pending'), where('expiresAt', '<=', now));
    return from(getDocs(q)).pipe(
      switchMap(snapshot => forkJoin(snapshot.docs.map(d => updateDoc(d.ref, { status: 'expired' })))),
      map(() => void 0),
      catchError(error => {
        console.log('Erro ao atualizar convites expirados:', error);
        return throwError(() => error);
      })
    );
  }

  deleteExpiredInvites(): Observable<void> {
    const invitesCol = collection(this.db, 'invites');
    const q = query(invitesCol, where('status', '==', 'expired'));
    return from(getDocs(q)).pipe(
      switchMap(snapshot => forkJoin(snapshot.docs.map(d => deleteDoc(d.ref)))),
      map(() => void 0),
      catchError(error => {
        console.log('Erro ao remover convites expirados:', error);
        return throwError(() => error);
      })
    );
  }
}
