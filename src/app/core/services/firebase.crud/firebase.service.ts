// firebase.service.ts
import { Injectable } from '@angular/core';
import { collectionData, doc, docData, Firestore, setDoc, deleteDoc, updateDoc, collection } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {

  constructor(private firestore: Firestore) { }

  addData(collection: string, data: any) {
    const docRef = doc(this.firestore, collection);
    return setDoc(docRef, data);
  }

  getData(collectionName: string) {
    return collectionData(collection(this.firestore, collectionName));
  }

  updateData(collection: string, id: string, data: any) {
    const docRef = doc(this.firestore, collection, id);
    return updateDoc(docRef, data);
  }

  deleteData(collection: string, id: string) {
    const docRef = doc(this.firestore, collection, id);
    return deleteDoc(docRef);
  }

}
