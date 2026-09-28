import { createHash, createHmac, randomUUID } from "node:crypto";

/** A fresh signed request is required for every attempt, including retries. */
export function signedWorkerRequest(url, secret, body = "") {
  const target = new URL(url);
  if (
    target.protocol !== "https:" &&
    !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
  ) {
    throw new Error("Worker transport requires HTTPS (except local loopback)");
  }
  if (target.username || target.password || target.hash || target.search) {
    throw new Error("Worker URL must not contain credentials, query or fragment");
  }
  const key = secret?.trim();
  if (!key) throw new Error("Worker signing secret is required");
  if (Buffer.byteLength(body, "utf8") > 1024) throw new Error("Worker body exceeds 1024 bytes");
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const signature = createHmac("sha256", key)
    .update(`${timestamp}.${nonce}.POST.${target.pathname}.${bodyHash}`)
    .digest("hex");
  return new Request(target, {
    method: "POST",
    body,
    redirect: "error",
    headers: {
      "x-elemarket-sync-timestamp": timestamp,
      "x-elemarket-sync-nonce": nonce,
      "x-elemarket-sync-signature": signature,
      "x-elemarket-body-sha256": bodyHash,
    },
  });
}
