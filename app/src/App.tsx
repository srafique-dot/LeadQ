import { AuthProvider, useAuth } from "./context/AuthContext";
import { SignIn } from "./screens/SignIn/SignIn";
import { Requester } from "./screens/Requester/Requester";
import { Agent } from "./screens/Agent/Agent";
import { Supervisor } from "./screens/Supervisor/Supervisor";
import { Users } from "./screens/Users/Users";

function Routed() {
  const { user } = useAuth();
  if (!user) return <SignIn />;
  if (user.role === "requester") return <Requester />;
  if (user.role === "agent") return <Agent />;
  if (user.role === "admin") return <Supervisor />;
  return <Users />;
}

export function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}
