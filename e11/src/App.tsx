import { FileBrowser } from "@/components/FileBrowser";
import "./index.css";

function App() {
  return (
    <div className="h-screen w-screen bg-background text-foreground overflow-hidden">
      <FileBrowser />
    </div>
  );
}

export default App;
