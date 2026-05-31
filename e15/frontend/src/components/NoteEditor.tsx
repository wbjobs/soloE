import { createSignal, onMount, onCleanup, createEffect, For } from 'solid-js';
import { YjsDocManager, createNoteId, mergeUpdates } from '../utils/yjs';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { apiService, HistoryItem, HistoryDetail } from '../services/api';

interface NoteEditorProps {
  noteId?: string;
  onNoteCreated?: (id: string) => void;
}

export const NoteEditor = (props: NoteEditorProps) => {
  const { online } = useNetworkStatus();
  const [title, setTitle] = createSignal('');
  const [content, setContent] = createSignal('');
  const [syncStatus, setSyncStatus] = createSignal<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [lastSync, setLastSync] = createSignal<number | undefined>();
  const [version, setVersion] = createSignal(0);
  const [currentNoteId, setCurrentNoteId] = createSignal<string | undefined>(props.noteId);
  const [showHistory, setShowHistory] = createSignal(false);
  const [history, setHistory] = createSignal<HistoryItem[]>([]);
  const [selectedHistory, setSelectedHistory] = createSignal<HistoryDetail | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = createSignal(false);
  const [isRollingBack, setIsRollingBack] = createSignal(false);
  
  let docManager: YjsDocManager | null = null;
  let pendingUpdates: Uint8Array[] = [];
  let syncTimeout: ReturnType<typeof setTimeout> | null = null;
  let isSyncing = false;

  const initializeDoc = async (noteId: string) => {
    if (docManager) {
      docManager.destroy();
      docManager = null;
    }

    docManager = new YjsDocManager({
      docName: noteId,
      onUpdate: (update: Uint8Array) => {
        pendingUpdates.push(update);
        scheduleSync();
      }
    });

    await docManager.whenSynced();
    
    if (online()) {
      try {
        const noteData = await apiService.getNote(noteId);
        if (noteData.yjsState && noteData.yjsState.length > 0) {
          const serverState = new Uint8Array(noteData.yjsState);
          docManager.applyUpdate(serverState);
        }
        setVersion(noteData.version);
      } catch (e) {
        console.error('Failed to fetch note state:', e);
      }
    }
    
    updateUIFromDoc();
    setShowHistory(false);
    setHistory([]);
    setSelectedHistory(null);
  };

  const updateUIFromDoc = () => {
    if (!docManager) return;
    setTitle(docManager.getTitleContent() || 'Untitled Note');
    setContent(docManager.getContent());
  };

  const scheduleSync = () => {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
    syncTimeout = setTimeout(() => {
      if (online() && currentNoteId() && !isSyncing) {
        syncWithServer(currentNoteId()!);
      }
    }, 1000);
  };

  const syncWithServer = async (noteId: string) => {
    if (!docManager || pendingUpdates.length === 0 || isSyncing) return;

    isSyncing = true;
    setSyncStatus('syncing');
    
    try {
      const mergedUpdates = mergeUpdates(pendingUpdates);
      pendingUpdates = [];

      const response = await apiService.syncNote(noteId, {
        updates: Array.from(mergedUpdates),
        clientVersion: version()
      });

      if (response.success && response.serverUpdates.length > 0) {
        const serverUpdates = new Uint8Array(response.serverUpdates);
        docManager.applyUpdate(serverUpdates);
        updateUIFromDoc();
      }

      setVersion(response.serverVersion);
      setLastSync(Date.now());
      setSyncStatus('synced');
      
      setTimeout(() => setSyncStatus('idle'), 2000);
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncStatus('error');
    } finally {
      isSyncing = false;
    }
  };

  const fetchFromServer = async (noteId: string) => {
    if (!docManager || !online()) return;
    
    try {
      const noteData = await apiService.getNote(noteId);
      if (noteData.yjsState && noteData.yjsState.length > 0) {
        const serverState = new Uint8Array(noteData.yjsState);
        docManager.applyUpdate(serverState);
        updateUIFromDoc();
      }
      setVersion(noteData.version);
    } catch (e) {
      console.error('Failed to fetch note:', e);
    }
  };

  const loadHistory = async () => {
    if (!currentNoteId() || !online()) return;
    
    setIsLoadingHistory(true);
    try {
      const response = await apiService.getNoteHistory(currentNoteId()!);
      setHistory(response.history);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const viewHistoryVersion = async (historyId: number) => {
    if (!currentNoteId() || !online()) return;
    
    try {
      const detail = await apiService.getHistoryDetail(currentNoteId()!, historyId);
      setSelectedHistory(detail);
    } catch (error) {
      console.error('Failed to load history detail:', error);
    }
  };

  const rollbackToVersion = async (historyId: number) => {
    if (!currentNoteId() || !online() || !docManager) return;
    
    setIsRollingBack(true);
    try {
      const response = await apiService.rollbackToVersion(currentNoteId()!, historyId);
      
      if (response.success && response.note.yjsState && response.note.yjsState.length > 0) {
        const serverState = new Uint8Array(response.note.yjsState);
        docManager.applyUpdate(serverState);
        updateUIFromDoc();
        setVersion(response.note.version);
      }
      
      setShowHistory(false);
      setSelectedHistory(null);
      await loadHistory();
    } catch (error) {
      console.error('Failed to rollback:', error);
    } finally {
      setIsRollingBack(false);
    }
  };

  const handleTitleChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const newTitle = target.value;
    setTitle(newTitle);
    if (docManager) {
      docManager.setTitleContent(newTitle);
    }
  };

  const handleContentChange = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    const newContent = target.value;
    setContent(newContent);
    if (docManager) {
      docManager.setContent(newContent);
    }
  };

  const createNewNote = async () => {
    const newNoteId = createNoteId();
    setCurrentNoteId(newNoteId);
    
    try {
      if (online()) {
        await apiService.createNote({
          title: 'Untitled Note',
          initialContent: ''
        });
      }
    } catch (error) {
      console.error('Create note failed:', error);
    }
    
    await initializeDoc(newNoteId);
    
    if (props.onNoteCreated) {
      props.onNoteCreated(newNoteId);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatLastSync = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const toggleHistory = async () => {
    const newState = !showHistory();
    setShowHistory(newState);
    if (newState) {
      await loadHistory();
    } else {
      setSelectedHistory(null);
    }
  };

  createEffect(() => {
    const noteId = props.noteId;
    if (noteId && noteId !== currentNoteId()) {
      setCurrentNoteId(noteId);
      initializeDoc(noteId);
    }
  });

  createEffect(() => {
    if (online() && currentNoteId() && docManager) {
      fetchFromServer(currentNoteId()!);
    }
  });

  onMount(() => {
    if (props.noteId) {
      initializeDoc(props.noteId);
    }
  });

  onCleanup(() => {
    if (docManager) {
      docManager.destroy();
    }
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
  });

  return (
    <div class="h-screen w-screen flex bg-gray-100">
      <div class="flex-1 flex flex-col">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div class="flex items-center gap-3 flex-1">
            <input
              type="text"
              value={title()}
              onInput={handleTitleChange}
              placeholder="Note title..."
              class="text-2xl font-bold text-gray-800 bg-transparent border-none outline-none flex-1"
            />
          </div>
          <div class="flex items-center gap-4">
            {currentNoteId() && (
              <button
                onClick={toggleHistory}
                class="flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors"
                classList={{
                  'bg-blue-100 text-blue-700': showHistory(),
                  'bg-gray-100 text-gray-700 hover:bg-gray-200': !showHistory()
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                History
              </button>
            )}
            <div class="flex items-center gap-2 text-sm">
              {online() ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2">
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                    <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                    <path d="M12.83 16.38a5 5 0 0 0-1.66 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                  </svg>
                  <span class="text-green-600">Online</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                    <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                    <path d="M12.83 16.38a5 5 0 0 0-1.66 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                  </svg>
                  <span class="text-red-600">Offline</span>
                </>
              )}
            </div>
            <div class="flex items-center gap-2 text-sm">
              {syncStatus() === 'syncing' && (
                <>
                  <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                    <path d="M21 3v5h-5"></path>
                  </svg>
                  <span class="text-orange-600">Syncing...</span>
                </>
              )}
              {syncStatus() === 'synced' && (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span class="text-green-600">Synced</span>
                </>
              )}
              {syncStatus() === 'error' && (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                  <span class="text-red-600">Sync failed</span>
                </>
              )}
              {syncStatus() === 'idle' && lastSync() && (
                <span class="text-gray-500">
                  Last sync: {formatLastSync(lastSync()!)}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div class="flex-1 p-6 overflow-auto">
          {currentNoteId() ? (
            <textarea
              value={content()}
              onInput={handleContentChange}
              placeholder="Start typing your note here..."
              class="w-full h-full p-4 text-gray-700 bg-white rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none resize-none text-base leading-relaxed"
            />
          ) : (
            <div class="flex flex-col items-center justify-center h-full text-gray-500">
              <p class="text-lg mb-4">No note selected</p>
              <button
                onClick={createNewNote}
                class="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Create New Note
              </button>
            </div>
          )}
        </div>
        
        <div class="px-6 py-3 border-t border-gray-200 bg-white">
          <div class="flex items-center justify-between text-sm text-gray-500">
            <span>Characters: {content().length}</span>
            <span>Words: {content() ? content().split(/\s+/).filter(Boolean).length : 0}</span>
            <span>Version: {version()}</span>
          </div>
        </div>
      </div>

      {showHistory() && (
        <div class="w-80 border-l border-gray-200 bg-white flex flex-col">
          <div class="p-4 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold text-gray-800">Version History</h3>
              <button
                onClick={() => setShowHistory(false)}
                class="p-1 hover:bg-gray-100 rounded"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          {isLoadingHistory() ? (
            <div class="flex-1 flex items-center justify-center">
              <svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                <path d="M21 3v5h-5"></path>
              </svg>
            </div>
          ) : selectedHistory() ? (
            <div class="flex-1 flex flex-col overflow-hidden">
              <div class="p-4 border-b border-gray-100">
                <button
                  onClick={() => setSelectedHistory(null)}
                  class="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                  Back to list
                </button>
              </div>
              <div class="flex-1 overflow-auto p-4">
                <h4 class="font-medium text-gray-800 mb-2">{selectedHistory()!.title}</h4>
                <p class="text-xs text-gray-500 mb-3">
                  Version {selectedHistory()!.version} • {formatDate(selectedHistory()!.createdAt)}
                </p>
                <div class="bg-gray-50 rounded p-3 text-sm text-gray-700 whitespace-pre-wrap mb-4 max-h-64 overflow-auto">
                  {selectedHistory()!.content || '(Empty)'}
                </div>
                <button
                  onClick={() => rollbackToVersion(selectedHistory()!.id)}
                  disabled={isRollingBack()}
                  class="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isRollingBack() ? 'Rolling back...' : 'Restore this version'}
                </button>
              </div>
            </div>
          ) : (
            <div class="flex-1 overflow-auto">
              {history().length === 0 ? (
                <div class="p-4 text-center text-gray-500 text-sm">
                  No history available
                </div>
              ) : (
                <For each={history()}>
                  {(item) => (
                    <button
                      onClick={() => viewHistoryVersion(item.id)}
                      class="w-full p-4 text-left border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <div class="font-medium text-gray-800 text-sm truncate">
                        {item.title || 'Untitled'}
                      </div>
                      <div class="text-xs text-gray-500 mt-1">
                        Version {item.version} • {formatDate(item.createdAt)}
                      </div>
                    </button>
                  )}
                </For>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
