import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFireDatabase } from '@angular/fire/compat/database';
import { GoogleAuthProvider, FacebookAuthProvider } from "firebase/auth";
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  constructor(private auth: AngularFireAuth, private db: AngularFireDatabase) { }

  signup(email: string, password: string, role: 'xereta' | 'animando' | 'decidido' | 'articulador' | 'extase') {
    return this.auth.createUserWithEmailAndPassword(email, password).then(data => {
      // verifique se o usuário não é nulo antes de usá-lo
      if (data.user) {
        return this.db.object(`/users/${data.user.uid}`).set({
          role: role
        });
      }
      throw new Error('User creation failed');
    });
  }

  login(email: string, password: string) {
    return this.auth.signInWithEmailAndPassword(email, password);
  }

  logout() {
    return this.auth.signOut();
  }

  googleLogin() {
    const provider = new GoogleAuthProvider();
    return this.auth.signInWithPopup(provider);
  }

  facebookLogin() {
    const provider = new FacebookAuthProvider();
    return this.auth.signInWithPopup(provider);
  }

  getToken(): Observable<string | null> {
    return this.auth.idToken;
  }

  updateUserRole(userId: string, role: 'xereta' | 'animando' | 'decidido' | 'articulador' | 'extase'): Promise<void> {
    return this.db.object(`/users/${userId}`).update({
      role: role
    });
  }

  isLoggedIn(): boolean {
    return this.isUserAuthenticated();
  }

  getUserProfile(): Promise<string | null> {
    return this.getCurrentUserRole();
  }

  isUserAuthenticated(): boolean {
    const user = this.auth.currentUser;
    return !!user;
  }

  async getCurrentUserRole(): Promise<string | null> {
    const user = await this.auth.currentUser;
    if (user) {
      const userSnapshot = await this.db.object(`/users/${user.uid}`).valueChanges().toPromise();
      return (userSnapshot as any)?.role || null;

    }
    return null;
  }

  async hasExtaseProfile(): Promise<boolean> {
    const role = await this.getCurrentUserRole();
    return role === 'extase';
  }
}
