# Node.js vs Elysia Event Loop Lab

Monorepo con dos backends equivalentes y una app React/Vite para comparar runtime, ergonomia y rendimiento:

- `apps/nodejs`: API Express sobre Node.js. Exporta `app` por default desde `src/index.ts` y usa `.listen()` solo en `src/local.ts`.
- `apps/elysiajs`: API Elysia sobre Bun. Exporta la instancia por default desde `src/index.ts` y configura Vercel con `vercel.ts`.
- `apps/react`: dashboard Vite React que consume ambos backends lado a lado.
- `packages/lab-core`: tipos, seeds, capacidades, ruta de aprendizaje y utilidades de benchmark compartidas.

## Local

Instalar dependencias:

```bash
bun install
```

Levantar cada app en una terminal:

```bash
bun run dev:node
bun run dev:elysia
bun run dev:react
```

Puertos por defecto:

- Express / Node.js: `http://localhost:4001`
- Elysia / Bun: `http://localhost:4002`
- React / Vite: `http://localhost:5173`

## Scripts

```bash
bun run check-types
bun run lint
bun run build
```

## Variables para React

En deploy, configurar estas variables en el proyecto Vercel de `apps/react`:

```bash
VITE_NODE_API_URL=https://tu-node-api.vercel.app
VITE_ELYSIA_API_URL=https://tu-elysia-api.vercel.app
```

En local, si no existen, React usa `http://localhost:4001` y `http://localhost:4002`.

## Endpoints equivalentes

- `GET /health`
- `GET /features`
- `POST /auth/login`
- `GET /users`
- `POST /users`
- `GET /products`
- `POST /products`
- `GET /sales`
- `POST /sales`
- `POST /jobs`
- `GET /jobs`
- `POST /files/analyze`
- `GET /scraper/prices`
- `GET /event-loop?work=18&microtasks=200`
- `GET /benchmark?iterations=40&work=18`
- `GET /stream`

La demo es in-memory a proposito: prioriza runtime, APIs, validacion, auth, manejo de errores, streams, jobs simulados y mediciones sin meter infraestructura extra.

## Deploy en Vercel

Crear tres proyectos Vercel desde el mismo repo y configurar el root directory de cada uno:

- `apps/nodejs`
- `apps/elysiajs`
- `apps/react`

Notas importantes:

- Express: Vercel detecta entrypoints como `index.ts` y `src/index.ts`; esta app tiene ambos, y ambos exportan la app por default sin `.listen()`.
- Elysia: `apps/elysiajs/src/index.ts` exporta la instancia de `Elysia` por default. `apps/elysiajs/vercel.ts` usa `bunVersion: "1.x"`.
- React: Vercel detecta Vite. El build output es `dist`.

## Que se demuestra

- Event loop: CPU sync, microtasks, timer delay y async wait.
- Performance: muestras p50/p95/max con la misma carga para ambos backends.
- Backend real: auth tipo JWT HMAC, roles, validacion, rate limit, logs, errores globales, jobs y streams.
- Monorepo: Turbo coordina apps y `@repo/lab-core` evita duplicar los contratos de dominio.
