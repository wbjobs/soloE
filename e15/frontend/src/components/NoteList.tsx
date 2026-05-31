import { createSignal, onMount, For } from 'solid-js';
import { apiService } from '../services/api';

interface NoteListItem {
  id: string;
  title: string;
  updatedAt: number;
}

interface NoteListProps {
  selectedNoteId?: string;
  onSelectNote: (id: string) => void;
  onNoteCreated?: (id: string) => void;
}

export const NoteList = (props: NoteListProps) => {
  const [notes, setNotes] = createSignal<NoteListItem[]>([]);
  const [loading, setLoading] = createSignal(false);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const response = await apiService.getNotes();
      setNotes(response.notes);
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    } finally {
      setLoading(false);
    }
  };

  const createNewNote = async () => {
    try {
      const response = await apiService.createNote({
        title: 'Untitled Note',
        initialContent: ''
      });
      
      const newNote: NoteListItem = {
        id: response.id,
        title: response.title,
        updatedAt: response.updatedAt
      };
      
      setNotes(prev => [newNote, ...prev]);
      props.onSelectNote(response.id);
      
      if (props.onNoteCreated) {
        props.onNoteCreated(response.id);
      }
    } catch (error) {
      console.error('Failed to create note:', error);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return date.toLocaleDateString();
  };

  const getPreview = (title: string) => {
    return title.length > 30 ? title.substring(0, 30) + '...' : title;
  };

  onMount(() => {
    fetchNotes();
  });

  return (
    <div class="w-80 h-screen flex flex-col bg-gray-50 border-r border-gray-200">
      <div class="p-4 border-b border-gray-200">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-xl font-bold text-gray-800">Notes</h1>
          <button
            onClick={createNewNote}
            class="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            title="Create new note"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
        <div class="relative">
          <input
            type="text"
            placeholder="Search notes..."
            class="w-full px-4 py-2 pl-10 text-sm bg-white border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
          />
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>
      </div>
      
      <div class="flex-1 overflow-y-auto">
        {loading() ? (
          <div class="flex items-center justify-center h-32">
            <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notes().length === 0 ? (
          <div class="flex flex-col items-center justify-center h-32 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mb-2 opacity-50">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <line x1="10" y1="9" x2="8" y2="9"></line>
            </svg>
            <p class="text-sm">No notes yet</p>
          </div>
        ) : (
          <For each={notes()}>
            {(note) => (
              <button
                onClick={() => props.onSelectNote(note.id)}
                class={`w-full p-4 text-left border-b border-gray-100 hover:bg-white transition-colors ${
                  props.selectedNoteId === note.id ? 'bg-white border-l-4 border-l-blue-500' : ''
                }`}
              >
                <h3 class="font-medium text-gray-800 mb-1">
                  {getPreview(note.title || 'Untitled Note')}
                </h3>
                <div class="flex items-center gap-1 text-xs text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>{formatDate(note.updatedAt)}</span>
                </div>
              </button>
            )}
          </For>
        )}
      </div>
      
      <div class="p-4 border-t border-gray-200 bg-white">
        <p class="text-xs text-gray-500 text-center">
          {notes().length} note{notes().length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
};
