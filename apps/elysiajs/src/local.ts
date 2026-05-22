import app from "./index.js";

const port = Number(Bun.env.PORT ?? 4002);

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Elysia API ready on http://localhost:${port}`);
