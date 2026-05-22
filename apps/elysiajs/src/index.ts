import crypto from "node:crypto";
import {
  canAccess,
  capabilities,
  clampNumber,
  fibonacci,
  learningRoute,
  roundMs,
  seedProducts,
  seedUsers,
  simulatedPrices,
  summarizeSamples,
  type Job,
  type Product,
  type Role,
  type Sale,
  type User,
} from "@repo/lab-core";
import { Elysia, status, t } from "elysia";

const users: User[] = seedUsers();
const products: Product[] = seedProducts();
const sales: Sale[] = [];
const jobs: Job[] = [];
const hits = new Map<string, { count: number; resetAt: number }>();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};
const roleModel = t.Union([t.Literal("admin"), t.Literal("operator"), t.Literal("viewer")]);

const app = new Elysia()
  .model({
    login: t.Object({
      email: t.String({ format: "email" }),
      role: t.Optional(roleModel),
    }),
    userCreate: t.Object({
      name: t.String({ minLength: 2 }),
      email: t.String({ format: "email" }),
      role: roleModel,
    }),
    productCreate: t.Object({
      name: t.String({ minLength: 2 }),
      price: t.Number({ minimum: 0.01 }),
      stock: t.Integer({ minimum: 0 }),
    }),
    saleCreate: t.Object({
      productId: t.String({ minLength: 1 }),
      quantity: t.Integer({ minimum: 1 }),
    }),
    jobCreate: t.Object({
      kind: t.Union([t.Literal("email"), t.Literal("pdf"), t.Literal("image"), t.Literal("order")]),
      payload: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
    fileAnalyze: t.Object({
      filename: t.String({ minLength: 1 }),
      content: t.String({ minLength: 1 }),
    }),
  })
  .onRequest(({ request, set }) => {
    Object.assign(set.headers, corsHeaders);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const key = request.headers.get("x-forwarded-for") ?? "local";
    const now = Date.now();
    const bucket = hits.get(key);

    if (!bucket || bucket.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }

    bucket.count += 1;
    if (bucket.count > 120) {
      return status(429, { error: "rate_limit", message: "Too many requests for this demo window." });
    }
  })
  .onAfterResponse(({ request, set }) => {
    console.log(
      JSON.stringify({
        framework: "elysia",
        method: request.method,
        path: new URL(request.url).pathname,
        status: set.status ?? 200,
      }),
    );
  })
  .onError(({ code, error }) => {
    if (code === "VALIDATION") {
      return status(400, { error: "validation", message: error.message });
    }

    console.error(error);
    return status(500, {
      error: "internal_error",
      message: "Unexpected Elysia API error",
    });
  })
  .get("/", () => ({
    name: "elysiajs",
    framework: "Elysia",
    runtime: "Bun",
    readyForVercel: true,
  }))
  .get("/health", () => ({
    ok: true,
    framework: "Elysia",
    runtime: "Bun",
    uptime: performance.now() / 1000,
  }))
  .get("/features", () => ({
    framework: "Elysia",
    runtime: "Bun",
    capabilities,
    learningRoute,
  }))
  .post(
    "/auth/login",
    ({ body }) => {
      const role = body.role ?? "viewer";
      return {
        token: signToken({ email: body.email, role }),
        user: { email: body.email, role },
      };
    },
    {
      body: "login",
    },
  )
  .get("/users", ({ request }) => {
    const denied = requireRole(request, "viewer");
    if (denied) return denied;

    return { data: users };
  })
  .post(
    "/users",
    ({ request, body }) => {
      const denied = requireRole(request, "admin");
      if (denied) return denied;

      const user = { id: crypto.randomUUID(), ...body };
      users.push(user);
      return status(201, user);
    },
    {
      body: "userCreate",
    },
  )
  .get("/products", () => ({ data: products }))
  .post(
    "/products",
    ({ request, body }) => {
      const denied = requireRole(request, "operator");
      if (denied) return denied;

      const product = { id: crypto.randomUUID(), ...body };
      products.push(product);
      return status(201, product);
    },
    {
      body: "productCreate",
    },
  )
  .get("/sales", () => ({ data: sales }))
  .post(
    "/sales",
    ({ request, body }) => {
      const denied = requireRole(request, "operator");
      if (denied) return denied;

      const product = products.find((item) => item.id === body.productId);
      if (!product) return status(404, { error: "not_found", message: "Product not found" });
      if (product.stock < body.quantity) return status(409, { error: "stock", message: "Not enough stock" });

      product.stock -= body.quantity;
      const sale = {
        id: crypto.randomUUID(),
        productId: product.id,
        quantity: body.quantity,
        total: product.price * body.quantity,
        createdAt: new Date().toISOString(),
      };
      sales.push(sale);
      return status(201, sale);
    },
    {
      body: "saleCreate",
    },
  )
  .post(
    "/jobs",
    ({ body }) => {
      const job: Job = {
        id: crypto.randomUUID(),
        kind: body.kind,
        status: "queued",
        attempts: 0,
        createdAt: new Date().toISOString(),
      };

      jobs.push(job);
      void runJob(job);
      return status(202, job);
    },
    {
      body: "jobCreate",
    },
  )
  .get("/jobs", () => ({ data: jobs }))
  .post(
    "/files/analyze",
    ({ body }) => {
      const buffer = Buffer.from(body.content);

      return {
        filename: body.filename,
        bytes: buffer.byteLength,
        lines: body.content.split(/\r?\n/).length,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      };
    },
    {
      body: "fileAnalyze",
    },
  )
  .get("/scraper/prices", async () => {
    await sleep(35);

    return {
      source: "simulated-market",
      capturedAt: new Date().toISOString(),
      data: simulatedPrices(products),
    };
  })
  .get(
    "/event-loop",
    async ({ query }) => {
      const work = clampNumber(Number(query.work ?? 18), 5, 34);
      const microtasks = clampNumber(Number(query.microtasks ?? 200), 0, 5000);

      return {
        framework: "Elysia",
        runtime: "Bun",
        ...(await eventLoopProbe(work, microtasks)),
      };
    },
    {
      query: t.Object({
        work: t.Optional(t.String()),
        microtasks: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/benchmark",
    async ({ query }) => {
      const iterations = clampNumber(Number(query.iterations ?? 40), 1, 500);
      const work = clampNumber(Number(query.work ?? 18), 5, 34);

      return {
        framework: "Elysia",
        runtime: "Bun",
        ...(await benchmark(iterations, work)),
      };
    },
    {
      query: t.Object({
        iterations: t.Optional(t.String()),
        work: t.Optional(t.String()),
      }),
    },
  )
  .get("/stream", () => {
    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        start(controller) {
          let count = 0;
          const timer = setInterval(() => {
            count += 1;
            controller.enqueue(
              encoder.encode(JSON.stringify({ framework: "Elysia", tick: count, at: new Date().toISOString() }) + "\n"),
            );

            if (count === 5) {
              clearInterval(timer);
              controller.close();
            }
          }, 180);
        },
      }),
      {
        headers: { "content-type": "application/x-ndjson", ...corsHeaders },
      },
    );
  });

function requireRole(request: Request, role: Role) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = token ? verifyToken(token) : null;

  if (!payload || !canAccess(payload.role, role)) {
    return status(403, { error: "forbidden", message: `Requires ${role} access` });
  }

  return null;
}

function signToken(payload: { email: string; role: Role }) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const signature = crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");

  return `${body}.${signature}`;
}

function verifyToken(token: string): { email: string; role: Role } | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

function authSecret() {
  return Bun.env.AUTH_SECRET ?? "demo-secret-change-me";
}

async function runJob(job: Job) {
  job.status = "running";
  job.attempts += 1;
  await sleep(250 + Math.random() * 350);
  job.status = "done";
  job.finishedAt = new Date().toISOString();
}

async function eventLoopProbe(work: number, microtasks: number) {
  const started = performance.now();
  const timerPromise = new Promise<number>((resolve) => {
    const scheduledAt = performance.now();
    setTimeout(() => resolve(performance.now() - scheduledAt), 0);
  });
  const syncStarted = performance.now();
  const fibValue = fibonacci(work);
  const syncMs = performance.now() - syncStarted;

  for (let index = 0; index < microtasks; index += 1) {
    await Promise.resolve(index);
  }

  const timerDelayMs = await timerPromise;
  const asyncStarted = performance.now();
  await sleep(10);

  return {
    work,
    microtasks,
    fibValue,
    syncMs: roundMs(syncMs),
    timerDelayMs: roundMs(timerDelayMs),
    asyncWaitMs: roundMs(performance.now() - asyncStarted),
    totalMs: roundMs(performance.now() - started),
    explanation: "Synchronous CPU work blocks the timer; microtasks flush before the event loop yields.",
  };
}

async function benchmark(iterations: number, work: number) {
  const samples: number[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    fibonacci(work);
    samples.push(performance.now() - started);
    if (index % 10 === 0) await Promise.resolve();
  }

  return summarizeSamples(samples, iterations, work);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default app;
