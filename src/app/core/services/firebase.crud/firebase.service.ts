// firebase.service.ts
import { Injectable } from '@angular/core';
import { collectionData, doc, docData, Firestore, setDoc, deleteDoc, updateDoc, collection } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {

  constructor(private firestore: Firestore) {
    console.log('Serviço Firestore inicializado'); // Log quando o serviço é inicializado
  }

  addData(collection: string, data: any) {
    console.log('Adicionando dados para coleção:', collection, data); // Log antes de adicionar os dados
    const docRef = doc(this.firestore, collection);
    return setDoc(docRef, data);
  }

  getData(collectionName: string) {
    console.log('Obtendo dados da coleção:', collectionName); // Log antes de obter os dados
    const data = collectionData(collection(this.firestore, collectionName));
    console.log('Dados obtidos:', data); // Log depois de obter os dados
    return data;
  }

  updateData(collection: string, id: string, data: any) {
    console.log('Atualizando dados para ID:', id, 'na coleção:', collection, 'com os dados:', data); // Log antes de atualizar os dados
    const docRef = doc(this.firestore, collection, id);
    return updateDoc(docRef, data);
  }

  deleteData(collection: string, id: string) {
    console.log('Excluindo dados com ID:', id, 'da coleção:', collection); // Log antes de excluir os dados
    const docRef = doc(this.firestore, collection, id);
    return deleteDoc(docRef);
  }

}
