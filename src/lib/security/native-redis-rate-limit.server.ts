import net from "node:net";
import tls from "node:tls";

const CONNECT_TIMEOUT_MS = 800;
const COMMAND_TIMEOUT_MS = 800;

type RedisValue = string | number | null | RedisValue[];

function encodeCommand(parts: string[]): Buffer {
  const chunks = [`*${parts.length}\r\n`];
  for (const part of parts) chunks.push(`$${Buffer.byteLength(part)}\r\n${part}\r\n`);
  return Buffer.from(chunks.join(""));
}

function parseValue(buffer: Buffer, offset = 0): { value: RedisValue; next: number } | null {
  if (offset >= buffer.length) return null;
  const type = buffer[offset];
  const lineEnd = buffer.indexOf("\r\n", offset + 1);
  if (lineEnd < 0) return null;
  const line = buffer.subarray(offset + 1, lineEnd).toString();
  const bodyStart = lineEnd + 2;
  if (type === 43) return { value: line, next: bodyStart }; // + simple string
  if (type === 45) throw new Error(`Redis error: ${line}`); // - error
  if (type === 58) return { value: Number(line), next: bodyStart }; // : integer
  if (type === 36) { // $ bulk string
    const length = Number(line);
    if (length === -1) return { value: null, next: bodyStart };
    const end = bodyStart + length;
    if (end + 2 > buffer.length) return null;
    return { value: buffer.subarray(bodyStart, end).toString(), next: end + 2 };
  }
  if (type === 42) { // * array
    const count = Number(line);
    if (count === -1) return { value: null, next: bodyStart };
    const values: RedisValue[] = [];
    let cursor = bodyStart;
    for (let i = 0; i < count; i++) {
      const parsed = parseValue(buffer, cursor);
      if (!parsed) return null;
      values.push(parsed.value);
      cursor = parsed.next;
    }
    return { value: values, next: cursor };
  }
  throw new Error(`Unsupported Redis response type: ${String.fromCharCode(type)}`);
}

function isRender(env = process.env): boolean {
  return env.RENDER === "true" || env.RENDER === "1";
}

function isRenderInternalKeyValueHost(hostname: string): boolean {
  return /^red-[a-z0-9][a-z0-9-]*$/i.test(hostname);
}

export function supportsNativeRedisUrl(value: string | undefined, env = process.env): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol === "redis:") {
      // Render's documented internal Key Value URL is redis://red-...:6379.
      // Do not require the undocumented RENDER runtime flag, because Docker
      // services are not guaranteed to receive it.
      return isRender(env) || isRenderInternalKeyValueHost(url.hostname);
    }
    return url.protocol === "rediss:";
  } catch {
    return false;
  }
}

class NativeRedisClient {
  private socket?: net.Socket | tls.TLSSocket;
  private buffer = Buffer.alloc(0);
  private connected = false;
  private connecting?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly url: URL;

  constructor(rawUrl: string) {
    this.url = new URL(rawUrl);
  }

  private async connect(): Promise<void> {
    if (this.connected && this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<void>((resolve, reject) => {
      const useTls = this.url.protocol === "rediss:";
      const socket = useTls
        ? tls.connect({
            host: this.url.hostname,
            port: Number(this.url.port || 6379),
            servername: this.url.hostname,
            rejectUnauthorized: true,
          })
        : net.createConnection({ host: this.url.hostname, port: Number(this.url.port || 6379) });
      this.socket = socket;
      this.buffer = Buffer.alloc(0);
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connecting = undefined;
        if (error) {
          this.connected = false;
          socket.destroy();
          reject(error);
        } else {
          this.connected = true;
          resolve();
        }
      };
      const timer = setTimeout(() => finish(new Error("Redis connection timeout")), CONNECT_TIMEOUT_MS);
      socket.once("connect", () => finish());
      socket.once("secureConnect", () => finish());
      socket.once("error", (error) => finish(error));
      socket.on("close", () => {
        this.connected = false;
        if (this.socket === socket) this.socket = undefined;
      });
      socket.on("data", (chunk: Buffer) => { this.buffer = Buffer.concat([this.buffer, chunk]); });
    });

    await this.connecting;
    const db = this.url.pathname.length > 1 ? this.url.pathname.slice(1) : "";
    const username = decodeURIComponent(this.url.username);
    const password = decodeURIComponent(this.url.password);
    if (username || password) await this.commandRaw(password ? ["AUTH", username || "default", password] : ["AUTH", password]);
    if (db) await this.commandRaw(["SELECT", db]);
  }

  private async commandRaw(parts: string[]): Promise<RedisValue> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error("Redis socket unavailable");
    return new Promise<RedisValue>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("Redis command timeout")), COMMAND_TIMEOUT_MS);
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      const finish = (error?: Error, value?: RedisValue) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) {
          this.connected = false;
          socket.destroy();
          reject(error);
        } else {
          resolve(value ?? null);
        }
      };
      const onData = (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        try {
          const parsed = parseValue(this.buffer);
          if (!parsed) return;
          this.buffer = this.buffer.subarray(parsed.next);
          finish(undefined, parsed.value);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const onError = (error: Error) => finish(error);
      const onClose = () => finish(new Error("Redis connection closed"));
      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("close", onClose);
      socket.write(encodeCommand(parts), (error) => { if (error) finish(error); });
    });
  }

  command(parts: string[]): Promise<RedisValue> {
    const run = this.queue.then(() => this.commandRaw(parts));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async evalRateLimit(key: string, windowSeconds: number): Promise<[number, number]> {
    const script = "local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; local ttl=redis.call('TTL',KEYS[1]); return {c,ttl}";
    const result = await this.command(["EVAL", script, "1", key, String(windowSeconds)]);
    if (!Array.isArray(result) || result.length !== 2) throw new Error("Unexpected Redis rate-limit response");
    const count = Number(result[0]);
    const ttl = Number(result[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttl) || ttl < 0) throw new Error("Invalid Redis rate-limit response");
    return [count, ttl];
  }
}

const clients = new Map<string, NativeRedisClient>();

export async function nativeRedisRateLimit(key: string, windowSeconds: number, rawUrl: string): Promise<{ count: number; ttl: number }> {
  let client = clients.get(rawUrl);
  if (!client) {
    client = new NativeRedisClient(rawUrl);
    clients.set(rawUrl, client);
  }
  try {
    const [count, ttl] = await client.evalRateLimit(key, windowSeconds);
    return { count, ttl };
  } catch (error) {
    clients.delete(rawUrl);
    throw error;
  }
}
