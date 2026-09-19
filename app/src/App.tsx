import { AuthProvider, useAuth } from "./context/AuthContext";
import { SignIn } from "./screens/SignIn/SignIn";
import { Requester } from "./screens/Requester/Requester";
import { Agent } from "./screens/Agent/Agent";
import { Supervisor } from "./screens/Supervisor/Supervisor";
import { SuperadminShell } from "./screens/SuperadminShell";

function Routed() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <SignIn />;
  if (user.role === "requester") return <Requester />;
  if (user.role === "agent") return <Agent />;
  if (user.role === "admin") return <Supervisor />;
  return <SuperadminShell />;
}

export function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}
