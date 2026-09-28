import { Link } from "@tanstack/react-router";
import { MapPin, ShoppingBag } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { MerchantWorkspaceLink, SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { cartCount, readCart, type CartLine } from "@/lib/market/cart";
import { PushNotificationButton } from "@/components/push-notification-button";

export function MarketHeader({ afterBrand, trailing }: { afterBrand?: ReactNode; trailing?: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  useEffect(() => {
    const sync = () => setCart(readCart());
    sync();
    window.addEventListener("elemarket:cart-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("elemarket:cart-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const count = cartCount(cart);

  return (
    <header className="sticky top-0 z-40 border-b border-market-line/80 bg-white/92 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        {afterBrand}
        <Link to="/" className="shrink-0 text-xl font-black tracking-[-0.04em] text-market-green sm:text-2xl">
          ELE<span className="text-market-orange">MARKET</span>
        </Link>
        <div className="hidden items-center gap-2 text-sm font-medium text-market-muted lg:flex">
          <MapPin size={16} className="text-market-green" /> Ghana
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {trailing}
          <SignedOut>
            <Link
              to="/login"
              className="hidden h-10 items-center rounded-xl px-3 text-sm font-semibold text-market-muted hover:bg-market-soft sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              to="/merchant/login"
              className="hidden h-10 items-center rounded-xl px-3 text-sm font-semibold text-market-muted hover:bg-market-soft sm:inline-flex"
            >
              Merchant login
            </Link>
          </SignedOut>
          <SignedIn>
            <PushNotificationButton />
            <div className="hidden lg:block">
              <MerchantWorkspaceLink className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-semibold text-market-muted hover:bg-market-soft" />
            </div>
            <div className="hidden max-w-[180px] truncate sm:block">
              <UserButton />
            </div>
          </SignedIn>
          <Link
            to="/cart"
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-market-line bg-white hover:bg-market-soft"
            aria-label="Cart"
          >
            <ShoppingBag size={19} />
            {count > 0 && (
              <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-market-orange px-1.5 py-0.5 text-center text-[11px] font-black text-white">
                {count}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketFooter() {
  return (
    <footer className="border-t border-market-line bg-white">
      <div className="mx-auto max-w-[1440px] px-4 py-8 text-sm text-market-muted sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 sm:flex-row">
          <span className="font-black text-market-green">ELEMARKET by ELEVORA</span>
          <span>Secure commerce foundation</span>
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-5">
          Financing is subject to provider availability, product eligibility and approval. ELEMARKET does not make the credit decision.
        </p>
      </div>
    </footer>
  );
}
