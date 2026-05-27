import { ChatLayout } from "@/components/chat/ChatLayout";
import { ThemeProvider } from "@/hooks/useTheme";

function App() {
  return (
    <ThemeProvider>
      <div className="h-dvh">
        <ChatLayout />
      </div>
    </ThemeProvider>
  );
}

export default App;
