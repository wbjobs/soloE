import { createSignal } from 'solid-js';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';

const App = () => {
  const [selectedNoteId, setSelectedNoteId] = createSignal<string | undefined>();

  const handleNoteCreated = (id: string) => {
    setSelectedNoteId(id);
  };

  return (
    <div class="h-screen w-screen flex overflow-hidden bg-gray-100">
      <NoteList
        selectedNoteId={selectedNoteId()}
        onSelectNote={setSelectedNoteId}
        onNoteCreated={handleNoteCreated}
      />
      <div class="flex-1">
        <NoteEditor
          noteId={selectedNoteId()}
          onNoteCreated={handleNoteCreated}
        />
      </div>
    </div>
  );
};

export default App;
