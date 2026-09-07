import { AuthProvider, useAuth } from "./context/AuthContext";
import { SignIn } from "./screens/SignIn/SignIn";
import { Requester } from "./screens/Requester/Requester";
import { ComingSoon } from "./screens/ComingSoon";

function Routed() {
  const { user } = useAuth();
  if (!user) return <SignIn />;
  if (user.role === "requester") return <Requester />;
  return <ComingSoon />;
}

export function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  );
}
