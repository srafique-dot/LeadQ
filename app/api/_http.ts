import type { VercelRequest, VercelResponse } from "@vercel/node";

type Handlers = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", (req: VercelRequest, res: VercelResponse) => Promise<void> | void>>;

/** Tiny per-file method router + error boundary shared by every api/* route,
 * so each route only writes its own business logic. */
export function route(handlers: Handlers) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const handler = handlers[(req.method as keyof Handlers) ?? "GET"];
    if (!handler) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  };
}

export function body<T>(req: VercelRequest): T {
  return (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as T;
}
