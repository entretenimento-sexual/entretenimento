// core/services/authentication/auth.service.ts
import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { GoogleAuthProvider, FacebookAuthProvider } from "firebase/auth";
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  constructor(private auth: AngularFireAuth) { }

  signup(email: string, password: string) {
    return this.auth.createUserWithEmailAndPassword(email, password);
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
}
