import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  CreditCard,
  Grid2X2,
  MapPin,
  Menu,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Truck,
  X,
} from "lucide-react";
import { listProducts, listMerchants } from "@/lib/market/catalog";
import { CATEGORIES } from "@/lib/market/categories";
import { formatGhs } from "@/lib/market/money";
import type { MerchantCard, ProductCard } from "@/lib/market/types";
import { addCartLine, readCart } from "@/lib/market/cart";
import { MerchantWorkspaceLink, SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { ContactSupportWidget } from "@/components/contact-support-widget";
import { loadHomepageMerchandising, recordHomepageAdEvent } from "./homepage.functions";
import type { HomepageSection } from "./homepage.functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [products, merchants, merchandising] = await Promise.all([
      listProducts({ data: { limit: 48 } }),
      listMerchants({ data: {} }),
      loadHomepageMerchandising({ data: {} }),
    ]);
    return { products, merchants, merchandising };
  },
  component: Home,
});

function Home() {
  const { products, merchants, merchandising } = Route.useLoaderData() as { products: ProductCard[]; merchants: MerchantCard[]; merchandising: HomepageSection[] };
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [subcategory, setSubcategory] = useState<string | undefined>();
  const [cart, setCart] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    return Object.fromEntries(readCart().map((line) => [line.productId, line.quantity]));
  });
  useEffect(() => {
    const sync = () => {
      setCart(Object.fromEntries(readCart().map((line) => [line.productId, line.quantity])));
    };
    window.addEventListener("elemarket:cart-updated", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("elemarket:cart-updated", sync); window.removeEventListener("storage", sync); };
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addedNotice, setAddedNotice] = useState(false);
  const recordAd = (campaignId: string, eventType: "impression" | "click") => {
    if (!campaignId) return;
    void recordHomepageAdEvent({ data: { eventId: `${crypto.randomUUID()}${Math.random().toString(36).slice(2, 10)}`, campaignId, eventType } }).catch(() => undefined);
  };
  useEffect(() => {
    for (const section of merchandising) for (const item of section.items) if (item.sponsored && item.adId) recordAd(item.adId, "impression");
  }, [merchandising]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      if (subcategory && p.subcategory !== subcategory) return false;
      if (!q) return true;
      return `${p.name} ${p.merchantName} ${p.category} ${p.subcategory ?? ""} ${p.brand ?? ""} ${p.model ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [products, query, category, subcategory]);

  const cartCountValue = Object.values(cart).reduce((a, b) => a + b, 0);
  const selectedCategory = CATEGORIES.find((c) => c.key === category);

  const selectCategory = (key?: string) => {
    setCategory(key);
    setSubcategory(undefined);
    setMenuOpen(false);
  };

  const addProductToCart = (product: ProductCard) => {
    const next = addCartLine({ productId: product.id, variantId: null, name: product.name, price: product.price, imagePath: product.imagePath, merchantId: product.merchantId, stock: product.stock });
    setCart(Object.fromEntries(next.map((line) => [line.productId, line.quantity])));
    setAddedNotice(true);
    window.setTimeout(() => setAddedNotice(false), 2200);
  };

  return (
    <div className="min-h-screen bg-market-bg text-market-ink">
      <ContactSupportWidget />
      <header className="sticky top-0 z-40 border-b border-market-line/80 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-market-line bg-white lg:hidden"
            aria-label="Open categories"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={19} />
          </button>
          <a href="/" className="shrink-0 text-xl font-black tracking-[-0.04em] text-market-green sm:text-2xl">
            ELE<span className="text-market-orange">MARKET</span>
          </a>
          <div className="hidden items-center gap-2 text-sm font-medium text-market-muted lg:flex">
            <MapPin size={16} className="text-market-green" /> Ghana
          </div>
          <label className="relative mx-auto flex min-w-0 max-w-2xl flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-market-muted" size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, brands, stores..."
              className="h-11 w-full rounded-2xl border border-market-line bg-market-bg pl-11 pr-4 text-sm outline-none transition placeholder:text-market-muted/80 focus:border-market-green focus:bg-white focus:ring-4 focus:ring-market-green/10"
              aria-label="Search marketplace"
            />
          </label>
          <div className="hidden items-center gap-2 sm:flex">
            <SignedOut>
              <Link to="/login" className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-semibold text-market-muted hover:bg-market-soft">Sign in</Link>
              <Link to="/merchant/login" className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-semibold text-market-muted hover:bg-market-soft">Merchant login</Link>
              <Link to="/merchant/register" className="inline-flex h-10 items-center rounded-xl bg-market-green px-4 text-sm font-bold text-white shadow-sm hover:bg-market-green/90">Become a merchant</Link>
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
          <Link to="/cart" className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-market-line bg-white hover:bg-market-soft" aria-label="Cart">
            <ShoppingBag size={19} />
            {cartCountValue > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-market-orange px-1.5 py-0.5 text-center text-[11px] font-black text-white">{cartCountValue}</span>}
          </Link>
        </div>
        <div className="hidden border-t border-market-line/60 bg-white lg:block">
          <div className="mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
            <button onClick={() => selectCategory()} className={`nav-pill ${!category ? "nav-pill-active" : ""}`}><Grid2X2 size={15} /> All categories</button>
            {CATEGORIES.slice(0, 10).map((c) => <button key={c.key} onClick={() => selectCategory(c.key)} className={`nav-pill ${category === c.key ? "nav-pill-active" : ""}`}>{c.name}</button>)}
            {CATEGORIES.length > 10 && (
              <button onClick={() => setMenuOpen(true)} className="nav-pill text-market-orange">More <ChevronRight size={15} /></button>
            )}
          </div>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-market-ink/30 lg:hidden" onClick={() => setMenuOpen(false)}>
          <aside className="h-full w-[86%] max-w-sm bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><strong className="text-lg">Shop categories</strong><button onClick={() => setMenuOpen(false)} className="rounded-xl p-2 hover:bg-market-soft" aria-label="Close"><X size={20} /></button></div>
            <div className="mt-4 grid grid-cols-2 gap-2 border-b border-market-line pb-4"><SignedOut><Link onClick={() => setMenuOpen(false)} to="/login" className="rounded-xl border border-market-line px-3 py-3 text-center text-sm font-bold">Sign in</Link><Link onClick={() => setMenuOpen(false)} to="/merchant/login" className="rounded-xl bg-market-soft px-3 py-3 text-center text-sm font-bold text-market-green">Merchant login</Link></SignedOut><SignedIn><Link onClick={() => setMenuOpen(false)} to="/profile" className="rounded-xl bg-market-soft px-3 py-3 text-center text-sm font-bold text-market-green">My profile</Link><Link onClick={() => setMenuOpen(false)} to="/orders" className="rounded-xl bg-market-soft px-3 py-3 text-center text-sm font-bold text-market-green">My orders</Link><div className="col-span-2"><MerchantWorkspaceLink className="flex w-full items-center justify-center rounded-xl bg-market-green px-3 py-3 text-center text-sm font-bold text-white" /></div></SignedIn></div>
            <div className="mt-5 grid gap-1">{CATEGORIES.map((c) => <button key={c.key} onClick={() => selectCategory(c.key)} className="rounded-xl px-3 py-3 text-left text-sm font-semibold hover:bg-market-soft">{c.name}</button>)}</div>
          </aside>
        </div>
      )}

      <main>
        <section className="mx-auto max-w-[1440px] px-4 pt-5 sm:px-6 lg:px-8 lg:pt-8">
          <div className="hero-surface relative overflow-hidden rounded-[28px] px-6 py-8 text-white sm:px-10 sm:py-12 lg:px-14 lg:py-14">
            <div className="relative z-10 max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[.14em] text-market-mint"><Sparkles size={14} /> Ghana's commerce ecosystem</div>
              <h1 className="max-w-3xl text-4xl font-black leading-[1.02] tracking-[-0.05em] sm:text-6xl lg:text-7xl">Everything you need.<br /><span className="text-market-mint">One marketplace.</span></h1>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">Shop from verified merchants across electronics, home appliances, fashion, food, agriculture, machinery and more — with delivery and financing options built into the experience.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <button onClick={() => document.getElementById("catalogue")?.scrollIntoView({ behavior: "smooth" })} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-black text-market-green shadow-lg hover:bg-market-mint">Explore marketplace <ArrowRight size={17} /></button>
                <button onClick={() => setQuery("home appliances")} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 text-sm font-bold text-white hover:bg-white/15"><CreditCard size={16} /> Shop with financing</button>
              </div>
            </div>
            <div className="hero-orb hero-orb-one" /><div className="hero-orb hero-orb-two" />
          </div>
        </section>

        <section className="mx-auto max-w-[1440px] px-4 pt-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-market-line bg-white p-5 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-xs font-black uppercase tracking-[.14em] text-market-orange">For businesses</p>
              <h2 className="mt-1 text-xl font-black">Register your business on ELEMARKET</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-market-muted">Merchant registration is handled from the marketplace homepage. Existing customers can authenticate their account during merchant onboarding.</p>
            </div>
            <Link to="/merchant/register" className="mt-4 inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-market-green px-5 text-sm font-black text-white hover:bg-market-green/90 sm:mt-0">Register as a merchant</Link>
          </div>
        </section>

        <section className="mx-auto grid max-w-[1440px] grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-3 sm:px-6 lg:px-8">
          <TrustItem icon={<BadgeCheck />} title="Verified merchants" text={`${merchants.length} stores in the marketplace`} />
          <TrustItem icon={<CreditCard />} title="Pay over time" text="Eligible products can connect to external BNPL" />
          <TrustItem icon={<Truck />} title="Delivery options" text="Compare delivery before you pay" />
        </section>

        <section className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4"><div><p className="eyebrow">Discover</p><h2 className="section-title">Shop by category</h2></div><span className="text-sm font-semibold text-market-muted">{visible.length} items</span></div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10">
            {CATEGORIES.slice(0, 10).map((c) => <button key={c.key} onClick={() => selectCategory(c.key)} className={`category-tile ${category === c.key ? "category-tile-active" : ""}`}><span className="category-dot" />{c.name}</button>)}
          </div>
          {selectedCategory && selectedCategory.subcategories.length > 0 && <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{selectedCategory.subcategories.map((s) => <button key={s.key} onClick={() => setSubcategory(s.key)} className={`subcategory-pill ${subcategory === s.key ? "subcategory-pill-active" : ""}`}>{s.name}</button>)}</div>}
        </section>

        <HomepageMerchandising sections={merchandising} onAdClick={recordAd} cart={cart} onAdd={addProductToCart} />

        <section id="catalogue" className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6 lg:px-8">
          <div className="mb-5 flex items-end justify-between"><div><p className="eyebrow">Marketplace</p><h2 className="section-title">{category ? selectedCategory?.name : "Featured products"}</h2></div>{(category || query) && <button onClick={() => { setQuery(""); selectCategory(); }} className="text-sm font-bold text-market-green">Clear filters</button>}</div>
          {visible.length === 0 ? <EmptyState /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{visible.map((product) => <ProductCardView key={product.id} product={product} quantity={cart[product.id] ?? 0} onAdd={() => {
              const next = addCartLine({
                productId: product.id,
                variantId: null,
                name: product.name,
                price: product.price,
                imagePath: product.imagePath,
                merchantId: product.merchantId,
                stock: product.stock,
              });
              setCart(Object.fromEntries(next.map((line) => [line.productId, line.quantity])));
              setAddedNotice(true);
              window.setTimeout(() => setAddedNotice(false), 2200);
            }} />)}</div>}
        </section>
      </main>
      {addedNotice && cartCountValue > 0 && <div className="fixed inset-x-3 bottom-3 z-50 sm:hidden"><Link to="/cart" className="flex min-h-14 items-center justify-between rounded-2xl bg-market-ink px-4 py-3 text-white shadow-2xl"><span className="text-sm font-bold"><ShoppingBag size={17} className="mr-2 inline" />Added to cart · {cartCountValue} item{cartCountValue === 1 ? "" : "s"}</span><span className="rounded-xl bg-market-orange px-3 py-2 text-xs font-black">View cart</span></Link></div>}

      <footer className="border-t border-market-line bg-white"><div className="mx-auto max-w-[1440px] px-4 py-8 text-sm text-market-muted sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-3 sm:flex-row"><span className="font-black text-market-green">ELEMARKET by ELEVORA</span><span>Secure commerce foundation</span></div><p className="mt-3 max-w-3xl text-xs leading-5">Financing is subject to provider availability, product eligibility and approval. ELEMARKET does not make the credit decision.</p></div></footer>
    </div>
  );
}

function HomepageMerchandising({ sections, onAdClick, cart, onAdd }: { sections: HomepageSection[]; onAdClick: (id: string, type: "impression" | "click") => void; cart: Record<string, number>; onAdd: (product: ProductCard) => void }) {
  return <>{sections.map((section) => section.items.length > 0 && <section key={section.key} className={`mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 ${section.mobileVisible === false ? "hidden sm:block" : ""} ${section.desktopVisible === false ? "sm:hidden" : ""}`}>
    <div className="mb-4 flex items-end justify-between gap-4"><div><p className="eyebrow">{section.eyebrow ?? "Discover"}</p><h2 className="section-title">{section.title}</h2></div><Link to="/" search={section.key === "food_spotlight" ? { category: "food" } : {}} className="inline-flex items-center gap-1 text-sm font-bold text-market-green">See all <ArrowRight size={15} /></Link></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{section.items.map((product) => <ProductCardView key={`${section.key}:${product.id}:${product.adId ?? "organic"}`} product={product} quantity={cart[product.id] ?? 0} sponsored={Boolean(product.sponsored)} adTitle={product.adTitle} adSubtitle={product.adSubtitle} onAdClick={product.adId ? () => onAdClick(product.adId!, "click") : undefined} onAdd={() => onAdd(product)} />)}</div>
  </section>)}</>;
}

function TrustItem({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="flex items-center gap-3 rounded-2xl border border-market-line bg-white p-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-market-soft text-market-green">{icon}</div><div><p className="text-sm font-extrabold">{title}</p><p className="text-xs text-market-muted">{text}</p></div></div>; }
function ProductCardView({ product, quantity, onAdd, sponsored, adTitle, adSubtitle, onAdClick }: { product: ProductCard; quantity: number; onAdd: () => void; sponsored?: boolean; adTitle?: string; adSubtitle?: string; onAdClick?: () => void }) {
  return <article className="group min-w-0 overflow-hidden rounded-2xl border border-market-line bg-white shadow-market transition duration-200 hover:-translate-y-1 hover:shadow-market-lg">
    <Link to="/products/$id" params={{ id: product.id }} className="block">
      <div className="relative aspect-[4/3] overflow-hidden bg-market-soft">{sponsored && <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-market-ink/90 px-2.5 py-1 text-[10px] font-black text-white">Sponsored</span>}{product.imagePath ? <img src={product.imagePath} alt={product.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]" /> : <div className="flex h-full items-center justify-center text-sm text-market-muted">No image</div>}{product.financingEligible && <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-black text-market-green shadow-sm">Pay over time</span>}</div>
      <div className="px-3.5 pt-3.5">{adTitle && <p className="mb-1 line-clamp-1 text-[11px] font-black text-market-orange">{adTitle}</p>}{adSubtitle && <p className="mb-1 line-clamp-2 text-[11px] text-market-muted">{adSubtitle}</p>}<div className="flex items-start justify-between gap-2"><h3 className="line-clamp-2 text-sm font-bold leading-5">{product.name}</h3>{product.verified && <ShieldCheck className="mt-0.5 shrink-0 text-market-green" size={16} aria-label="Verified merchant" />}</div><p className="mt-1 truncate text-xs text-market-muted">{product.merchantName} · {product.neighborhood}</p>{(product.brand || product.model) && <p className="mt-1 truncate text-[11px] font-medium text-market-muted">{[product.brand, product.model].filter(Boolean).join(" · ")}</p>}</div>
    </Link>
    <div className="flex items-end justify-between gap-2 p-3.5 pt-3"><div className="min-w-0"><strong className="text-base tracking-tight">{formatGhs(product.price)}</strong>{product.financingEligible && <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-market-green"><CreditCard size={11} /> Financing available*</div>}</div><button type="button" onClick={onAdd} disabled={product.stock < 1} className="min-h-10 shrink-0 rounded-xl bg-market-orange px-3.5 text-xs font-black text-white transition hover:bg-market-orange/90 disabled:cursor-not-allowed disabled:opacity-40">{quantity ? `Add (${quantity})` : "Add"}</button></div>
  </article>;
}
function EmptyState() { return <div className="rounded-3xl border border-dashed border-market-line bg-white p-14 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-market-soft text-market-green"><Search size={21} /></div><h3 className="mt-4 text-lg font-bold">Nothing matched</h3><p className="mt-2 text-sm text-market-muted">Try another search or category.</p></div>; }
