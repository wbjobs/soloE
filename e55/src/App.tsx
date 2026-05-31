import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Devices } from './pages/Devices';
import { Sync } from './pages/Sync';
import { Transfer } from './pages/Transfer';
import { History } from './pages/History';
import { Settings } from './pages/Settings';

function App() {
  return (
    <Router>
      <div className="flex h-screen bg-dark-800">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<Devices />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/transfer" element={<Transfer />} />
            <Route path="/history" element={<History />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
