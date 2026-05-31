export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface NoteListItem {
  id: string;
  title: string;
  updatedAt: number;
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'synced' | 'error';
  lastSync?: number;
  error?: string;
}

export interface NetworkStatus {
  online: boolean;
}
