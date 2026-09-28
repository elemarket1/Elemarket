import { serve } from "srvx/node";
import { useNitroApp as getNitroApp } from "nitro/app";

const app = getNitroApp();
const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
const server = serve({ port, hostname: process.env.HOST ?? "0.0.0.0", fetch: app.fetch, gracefulShutdown: false });
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: "shutdown.draining", signal }));
  const deadline = setTimeout(() => {
    console.error(JSON.stringify({ event: "shutdown.timeout" }));
    void server.close(true).finally(() => process.exit(1));
  }, 20000);
  try {
    await server.close();
    await app.hooks?.callHook("close");
    clearTimeout(deadline);
    console.log(JSON.stringify({ event: "shutdown.complete" }));
    process.exit(0);
  } catch {
    clearTimeout(deadline);
    console.error(JSON.stringify({ event: "shutdown.failed" }));
    process.exit(1);
  }
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => void shutdown(signal));
