export type CartLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
  name: string;
  price: string;
  imagePath: string | null;
  merchantId?: string;
};

export const CART_KEY = "elemarket:cart:v2";
export const QUOTE_KEY = "elemarket:delivery-quotes:v1";
export const PAYMENT_QUEUE_KEY = "elemarket:payment-queue:v1";

export function readCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event("elemarket:cart-updated"));
}

export function addCartLine(line: Omit<CartLine, "quantity"> & { quantity?: number; stock?: number }) {
  const lines = readCart();
  const qty = Math.max(1, line.quantity ?? 1);
  const existing = lines.find((item) => item.productId === line.productId && item.variantId === line.variantId);
  if (existing) {
    const next = existing.quantity + qty;
    existing.quantity = line.stock != null ? Math.min(line.stock, next) : next;
  } else {
    lines.push({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.stock != null ? Math.min(line.stock, qty) : qty,
      name: line.name,
      price: line.price,
      imagePath: line.imagePath,
      merchantId: line.merchantId,
    });
  }
  writeCart(lines);
  return lines;
}

export function cartCount(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartTotal(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + Number(line.price || 0) * line.quantity, 0);
}
