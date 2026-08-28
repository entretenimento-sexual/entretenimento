// src/app/core/interfaces/logs/iadming-log.ts
import { Timestamp } from 'firebase/firestore';

export interface IAdminLog {
  adminUid: string;
  action: string;
  targetUserUid: string;
  details: any | null;
  timestamp: Timestamp;
}
