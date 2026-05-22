import app from "./index.js";

const port = Number(process.env.PORT ?? 4001);

app.listen(port, () => {
  console.log(`Express API ready on http://localhost:${port}`);
});
