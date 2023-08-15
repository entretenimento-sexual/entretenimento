// src\app\user-profile\user-profile.service.ts
import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore'; // Importe o AngularFirestore
import { Observable } from 'rxjs';
import { User } from 'src/app/core/interfaces/user.interface';
import { filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class UserProfileService {
  constructor(private firestore: AngularFirestore) { }

  getUserProfile(userId: string): Observable<User> {
    this.firestore.collection('users').doc(userId).valueChanges().subscribe(data => {
      console.log('Dados do Firestore:', data);
    });

    return this.firestore.collection('users').doc(userId).valueChanges().pipe(
      filter(user => !!user)
    ) as Observable<User>;
  }

  updateUserProfile(userId: string, userProfile: User): Promise<void> {
    return this.firestore.collection('contas').doc(userId).update(userProfile);

    // Implemente a lógica para atualizar o perfil do usuário aqui.
    // Normalmente, isso envolve o envio de uma solicitação HTTP.
    // Como ainda não temos a API, vamos retornar um Observable mockado.

  }
  getUserPhotos(userId: string) {
    // Suponho que esteja usando o AngularFirestore para fazer isso
    return this.firestore.collection('photos', ref => ref.where('userId', '==', userId)).valueChanges();
  }

}

