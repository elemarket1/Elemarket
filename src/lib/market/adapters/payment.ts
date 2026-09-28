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
  idempotentInitialization: boolean; merchantAccount: boolean;
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

export class PreviewPaymentAdapter implements PaymentProviderAdapter {
  readonly capabilities: PaymentCapabilities = { initialize: true, checkout: true, verify: false, webhook: false, refund: false, idempotentInitialization: true, merchantAccount: false, currencies: ['GHS'], methods: ['mobile_money','card','bank_transfer'] };
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

