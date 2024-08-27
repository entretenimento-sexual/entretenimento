// src\app\core\services\user-interactions.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { FirestoreService } from '../autentication/firestore.service';
import { AuthService } from '../autentication/auth.service';
import { doc, setDoc, collection, query, where, getDocs } from '@firebase/firestore';
import { UserProfileService } from '../user-profile/user-profile.service';

@Injectable({
  providedIn: 'root'
})
export class UserInteractionsService {
  amigos: IUserDados[] = [];

  constructor(
    private firestoreService: FirestoreService,
    private userProfileService: UserProfileService,
    private authService: AuthService
  ) { }

  async listFriends(userId: string): Promise<IUserDados[]> {
    const friendsQuery = query(collection(this.firestoreService.db, 'amigos'), where('userId1', '==', userId));
    const querySnapshot = await getDocs(friendsQuery);
    const friends = [];
    for (const docSnapshot of querySnapshot.docs) {
      const friendId = docSnapshot.data()['userId2']; // Corrigido para acessar userId2 corretamente
      const friendData = await this.userProfileService.getUserById(friendId);
      if (friendData) {
        friends.push(friendData);
      }
    }
    return friends;
  }


  async addFriend(userId: string, friendId: string): Promise<void> {
    const friendDoc = doc(this.firestoreService.db, `amigos/${userId}_${friendId}`);
    await setDoc(friendDoc, { userId1: userId, userId2: friendId });
  }

  async loadFriends(): Promise<void> {
    const currentUser = this.authService.currentUser;
    if (currentUser && currentUser.uid) {
      this.listFriends(currentUser.uid)
        .then(amigos => this.amigos = amigos)
        .catch(error => console.error("Erro ao buscar amigos:", error));
    }
  }
}
