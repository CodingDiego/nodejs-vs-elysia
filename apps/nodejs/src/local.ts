import app from "./index.js";

const port = Number(process.env.PORT ?? 4001);

const server = app.listen(port, () => {
  console.log(`Express API ready on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
