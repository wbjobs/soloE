const API_BASE = 'http://localhost:3000/api';

export interface NoteListItem {
  id: string;
  title: string;
  updatedAt: number;
}

export interface SyncRequest {
  updates: number[];
  clientVersion: number;
}

export interface SyncResponse {
  success: boolean;
  serverUpdates: number[];
  serverVersion: number;
}

export interface GetNoteResponse {
  id: string;
  title: string;
  content: string;
  yjsState: number[];
  version: number;
  updatedAt: number;
}

export interface CreateNoteRequest {
  title: string;
  initialContent?: string;
}

export interface CreateNoteResponse {
  id: string;
  title: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryItem {
  id: number;
  title: string;
  version: number;
  createdAt: number;
}

export interface HistoryDetail {
  id: number;
  title: string;
  content: string;
  yjsState: number[];
  version: number;
  createdAt: number;
}

export interface RollbackResponse {
  success: boolean;
  note: {
    id: string;
    title: string;
    content: string;
    version: number;
    updatedAt: number;
  };
}

export class ApiService {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    return response.json();
  }

  async getNotes(): Promise<{ notes: NoteListItem[] }> {
    return this.request('/notes');
  }

  async getNote(id: string): Promise<GetNoteResponse> {
    return this.request(`/notes/${id}`);
  }

  async createNote(data: CreateNoteRequest): Promise<CreateNoteResponse> {
    return this.request('/notes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async syncNote(id: string, data: SyncRequest): Promise<SyncResponse> {
    return this.request(`/notes/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getNoteHistory(noteId: string): Promise<{ history: HistoryItem[] }> {
    return this.request(`/notes/${noteId}/history`);
  }

  async getHistoryDetail(noteId: string, historyId: number): Promise<HistoryDetail> {
    return this.request(`/notes/${noteId}/history/${historyId}`);
  }

  async rollbackToVersion(noteId: string, historyId: number): Promise<RollbackResponse> {
    return this.request(`/notes/${noteId}/history/${historyId}/rollback`, {
      method: 'POST',
    });
  }
}

export const apiService = new ApiService();
