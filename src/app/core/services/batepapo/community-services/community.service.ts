//src\app\core\services\batepapo\community.service.ts
import { Injectable } from '@angular/core';
import { getFirestore, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { Observable } from 'rxjs';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { Community } from 'src/app/core/interfaces/interfaces-chat/community.interface';

@Injectable({
  providedIn: 'root'
})
export class CommunityService {
  private db = getFirestore();

  constructor() { }

  /**
   * Cria uma nova comunidade.
   * @param communityData Dados da comunidade (nome, descrição, criador, etc.)
   */
  async createCommunity(communityData: Omit<Community, 'id' | 'createdAt'>): Promise<string> {
    console.log('Criando nova comunidade com dados:', communityData);
    const community = {
      ...communityData,
      createdAt: serverTimestamp()
    };

    try {
      const communityRef = await addDoc(collection(this.db, 'communities'), community);
      console.log('Comunidade criada com sucesso, ID:', communityRef.id);
      return communityRef.id;
    } catch (error) {
      console.error('Erro ao criar comunidade:', error);
      throw error;
    }
  }

  /**
   * Obtém as comunidades criadas pelo usuário.
   * @param userId ID do usuário.
   */
  getUserCommunities(userId: string): Observable<Community[]> {
    console.log('Obtendo comunidades criadas pelo usuário com ID:', userId);
    const communitiesRef = collection(this.db, 'communities');
    const userCommunitiesQuery = query(communitiesRef, where('createdBy', '==', userId));

    return new Observable(observer => {
      const unsubscribe = onSnapshot(userCommunitiesQuery, snapshot => {
        const communities = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data() as Community
        }));
        observer.next(communities);
      }, error => {
        console.error('Erro ao carregar comunidades do usuário:', error);
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }

  /**
   * Atualiza dados de uma comunidade.
   * @param communityId ID da comunidade.
   * @param updateData Dados a serem atualizados.
   */
  async updateCommunity(communityId: string, updateData: Partial<Community>): Promise<void> {
    console.log('Atualizando comunidade ID:', communityId, 'com dados:', updateData);
    try {
      const communityRef = doc(this.db, 'communities', communityId);
      await updateDoc(communityRef, updateData);
      console.log('Comunidade atualizada com sucesso.');
    } catch (error) {
      console.error('Erro ao atualizar comunidade:', error);
      throw error;
    }
  }

  /**
   * Deleta uma comunidade.
   * @param communityId ID da comunidade a ser deletada.
   */
  async deleteCommunity(communityId: string): Promise<void> {
    console.log('Deletando comunidade com ID:', communityId);
    try {
      const communityRef = doc(this.db, 'communities', communityId);
      await deleteDoc(communityRef);
      console.log('Comunidade deletada com sucesso.');
    } catch (error) {
      console.error('Erro ao deletar comunidade:', error);
      throw error;
    }
  }

  /**
   * Gerencia convites para uma comunidade.
   * @param inviteData Dados do convite.
   */
  async sendInvite(inviteData: Omit<Invite, 'id'>): Promise<void> {
    console.log('Enviando convite para comunidade com dados:', inviteData);
    const invite = {
      ...inviteData,
      sentAt: serverTimestamp(),
      status: 'pending'
    };

    try {
      await addDoc(collection(this.db, 'invites'), invite);
      console.log('Convite enviado com sucesso.');
    } catch (error) {
      console.error('Erro ao enviar convite:', error);
      throw error;
    }
  }

  /**
   * Observa membros de uma comunidade.
   * @param communityId ID da comunidade.
   */
  observeCommunityMembers(communityId: string): Observable<any[]> {
    console.log('Observando membros da comunidade ID:', communityId);
    const membersRef = collection(this.db, `communities/${communityId}/members`);
    return new Observable(observer => {
      const unsubscribe = onSnapshot(membersRef, snapshot => {
        const members = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        observer.next(members);
      }, error => {
        console.error('Erro ao observar membros da comunidade:', error);
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }
}
