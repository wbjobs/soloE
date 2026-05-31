import React, { useState } from 'react';
import JoinForm from './components/JoinForm';
import ConferenceRoom from './components/ConferenceRoom';

type AppState = 'join' | 'conference';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>('join');
  const [roomId, setRoomId] = useState('');
  const [clientName, setClientName] = useState('');

  const handleJoin = (newRoomId: string, newClientName: string) => {
    setRoomId(newRoomId);
    setClientName(newClientName);
    setState('conference');
  };

  const handleLeave = () => {
    setState('join');
    setRoomId('');
    setClientName('');
  };

  return (
    <>
      {state === 'join' && <JoinForm onJoin={handleJoin} />}
      {state === 'conference' && (
        <ConferenceRoom
          roomId={roomId}
          clientName={clientName}
          onLeave={handleLeave}
        />
      )}
    </>
  );
};

export default App;
