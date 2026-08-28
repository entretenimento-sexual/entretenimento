// src/app/core/firebase/firebase.tokens.ts
import { InjectionToken } from '@angular/core';

// ✅ Tipos vindos do AngularFire (compatíveis com o que o AppModule fornece)
import type { FirebaseApp } from '@angular/fire/app';
import type { Auth } from '@angular/fire/auth';
import type { Firestore } from '@angular/fire/firestore';

export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');
export const FIREBASE_DB = new InjectionToken<Firestore>('FIREBASE_DB');
