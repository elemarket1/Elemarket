import { z } from "zod";
import { PaymentProviderError } from "@/lib/market/payment-errors";
export type PaymentAdapterInput = {
  paymentId: string;
  attemptId: string;
  amount: string;
  currency: string;
  method: string;
  customerReference?: string;
  customerEmail?: string;
  merchantSubaccount?: string;
  idempotencyKey?: string;
  callbackUrl?: string;
};

export type PaymentRefundResult = {
  providerRefundId: string | null;
  status: "processing" | "processed" | "needs_attention";
  metadata?: Record<string, unknown>;
};

export type PaymentAdapterResult = {
  providerReference: string;
  status: "initiated" | "authorized" | "completed" | "failed";
  checkoutUrl?: string;
  metadata?: Record<string, unknown>;
};

export type PaymentCapabilities = {
  initialize: boolean; checkout: boolean; verify: boolean; webhook: boolean; refund: boolean;
  idempotentInitialization: boolean; merchantAccount: boolean; deliveryDisputeHold: boolean;
  currencies: readonly string[]; methods: readonly string[];
};
export interface PaymentProviderAdapter {
  readonly capabilities: PaymentCapabilities;
  readonly checkoutHosts: readonly string[];
  webhookSignature?(headers: Headers): string | null;
  /** Provider must guarantee duplicate-safe initialization for the supplied idempotency key. */
  readonly supportsIdempotentInitialization: boolean;
  initializationReference?(attemptId: string): string;
  createPayment(input: PaymentAdapterInput): Promise<PaymentAdapterResult>;
  verifyWebhook?(rawBody: string, signature: string | null): Promise<boolean>;
  parseWebhook?(rawBody: string): Promise<ParsedPaymentWebhook | null>;
  verifyTransaction?(reference: string): Promise<VerifiedPayment>;
  refundPayment?(input: { providerReference: string; amount: string; currency: string; customerNote?: string; merchantNote?: string; idempotencyKey?: string }): Promise<PaymentRefundResult>;
}

export type ParsedPaymentWebhook = {
  eventId: string;
  eventType: string;
  providerReference: string;
  status: "authorized" | "completed" | "failed" | "refunded";
  amount: number;
  currency: string;
  providerRefundId?: string;
};

export type VerifiedPayment = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  providerRefundId?: string;
};

async function genericVerify(rawBody: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature) return false;
  const parts = Object.fromEntries(signature.split(",").map((part) => part.split("=", 2))) as Record<string,string|undefined>;
  const timestamp = Number(parts.t); const provided = parts.v1;
  if (!Number.isSafeInteger(timestamp) || !provided || Math.abs(Date.now()/1000-timestamp)>300 || !/^[a-f0-9]{64}$/i.test(provided)) return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const expected=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  const bytes=new Uint8Array(32); for(let i=0;i<32;i++) bytes[i]=Number.parseInt(provided.slice(i*2,i*2+2),16);
  let diff=0; for(let i=0;i<32;i++) diff|=expected[i]^bytes[i]; return diff===0;
}

export class JsonHttpPaymentAdapter implements PaymentProviderAdapter {
  readonly capabilities: PaymentCapabilities = { initialize: true, checkout: true, verify: true, webhook: true, refund: false, idempotentInitialization: false, merchantAccount: false, deliveryDisputeHold: false, currencies: [], methods: [] };
  readonly checkoutHosts: readonly string[] = [];
  readonly supportsIdempotentInitialization = false;
  constructor(private readonly endpoint: string, private readonly secret: string) {}
  async verifyWebhook(rawBody: string, signature: string | null): Promise<boolean> { return genericVerify(rawBody, signature, this.secret); }
  async parseWebhook(rawBody: string): Promise<ParsedPaymentWebhook | null> {
    const schema = z.object({
      eventId: z.string().min(1).max(256),
      eventType: z.string().min(1).max(128),
      providerReference: z.string().min(1).max(256),
      status: z.enum(["authorized", "completed", "failed", "refunded"]),
      amount: z.number().finite().positive(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    });
    const parsed = schema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) throw new Error("Invalid provider webhook payload");
    return parsed.data;
  }
  async verifyTransaction(reference: string): Promise<VerifiedPayment> {
    const response = await fetch(`${this.endpoint.replace(/\/$/, "")}/verify/${encodeURIComponent(reference)}`, { headers: { authorization: `Bearer ${this.secret}` }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new PaymentProviderError("Payment provider transaction verification failed", response.status);
    const parsed = z.object({ status: z.string(), reference: z.string(), amount: z.number().finite().positive(), currency: z.string().regex(/^[A-Z]{3}$/) }).safeParse(await response.json());
    if (!parsed.success) throw new Error("Payment provider verification response failed validation");
    return parsed.data;
  }
  async createPayment(input: PaymentAdapterInput): Promise<PaymentAdapterResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.secret}`, ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}) },
      body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Payment provider returned HTTP ${response.status}`);
    const schema = z.object({
      providerReference: z.string().min(1).max(256),
      status: z.enum(["initiated", "authorized", "completed", "failed"]),
      checkoutUrl: z.string().url().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    });
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Payment provider response failed validation");
    return parsed.data;
  }
}

export class PreviewPaymentAdapter implements PaymentProviderAdapter {
  readonly capabilities: PaymentCapabilities = { initialize: true, checkout: true, verify: false, webhook: false, refund: false, idempotentInitialization: true, merchantAccount: false, deliveryDisputeHold: false, currencies: ['GHS'], methods: ['mobile_money','card','bank_transfer'] };
  readonly checkoutHosts: readonly string[] = [];
  readonly supportsIdempotentInitialization = true;
  async createPayment(input: PaymentAdapterInput): Promise<PaymentAdapterResult> {
    return {
      providerReference: input.attemptId,
      status: "initiated",
      checkoutUrl: `/payment/preview?paymentId=${encodeURIComponent(input.paymentId)}`,
      metadata: { preview: true },
    };
  }
}

