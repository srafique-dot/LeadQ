import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadSession, isCrossOrigin, type Session } from "./_auth.js";

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Handlers = Partial<Record<Method, (req: VercelRequest, res: VercelResponse, session: Session) => Promise<void> | void>>;
type PublicHandlers = Partial<
  Record<Method, (req: VercelRequest, res: VercelResponse, session: Session | null) => Promise<void> | void>
>;

function wrap(
  handlers: PublicHandlers,
  gate: (session: Session | null, res: VercelResponse) => boolean,
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const handler = handlers[(req.method as Method) ?? "GET"];
    if (!handler) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    if (req.method !== "GET" && isCrossOrigin(req)) {
      res.status(403).json({ error: "cross_origin" });
      return;
    }
    try {
      const session = await loadSession(req);
      if (!gate(session, res)) return;
      await handler(req, res, session);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal error" });
    }
  };
}

/** Every api/* route goes through this. Requires a signed-in account that
 * has finished any forced password change; handlers get the session and
 * should take identity from it, never from the request body. */
export function route(handlers: Handlers) {
  return wrap(handlers as PublicHandlers, (session, res) => {
    if (!session) {
      res.status(401).json({ error: "unauthenticated" });
      return false;
    }
    if (session.mustChangePassword) {
      res.status(403).json({ error: "password_change_required" });
      return false;
    }
    return true;
  });
}

/** For the few endpoints that must work signed out (sign-in, invite claim).
 * The handler gets the session if there is one and decides for itself. */
export function publicRoute(handlers: PublicHandlers) {
  return wrap(handlers, () => true);
}

export function body<T>(req: VercelRequest): T {
  // A POST with no body (claim, release) arrives as undefined or "".
  const raw = typeof req.body === "string" ? (req.body ? JSON.parse(req.body) : {}) : req.body;
  return (raw ?? {}) as T;
}
