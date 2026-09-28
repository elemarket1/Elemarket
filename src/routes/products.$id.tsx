import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, BadgeCheck, Check, ChevronLeft, ChevronRight, CreditCard, Heart, RotateCcw, ShieldCheck, ShoppingBag, Truck } from "lucide-react";
import { getProduct } from "@/lib/market/catalog";
import { formatGhs } from "@/lib/market/money";
import type { JsonValue, ProductVariant } from "@/lib/market/types";
import { addCartLine, cartCount, readCart } from "@/lib/market/cart";

export const Route = createFileRoute("/products/$id")({
  loader: ({ params }) => getProduct({ data: { id: params.id } }),
  component: ProductPage,
});

function ProductPage() {
  const data = Route.useLoaderData() as Awaited<ReturnType<typeof getProduct>>;
  const [mediaIndex, setMediaIndex] = useState(0);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(data.variants[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [cartItems, setCartItems] = useState(() => readCart());
  const [addedNotice, setAddedNotice] = useState(false);
  useEffect(() => {
    const sync = () => setCartItems(readCart());
    window.addEventListener("elemarket:cart-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("elemarket:cart-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const variantGroups = useMemo(() => groupVariantAttributes(data.variants), [data.variants]);

  if (!data.product) {
    return <main className="mx-auto max-w-3xl px-5 py-20 text-center"><h1 className="text-3xl font-black">Product unavailable</h1><p className="mt-3 text-market-muted">This product may have been removed, suspended, or is no longer available.</p><Link to="/" className="mt-7 inline-flex rounded-xl bg-market-green px-5 py-3 text-sm font-bold text-white">Back to marketplace</Link></main>;
  }

  const { product, variants, media, related } = data;
  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null;
  const effectivePrice = selectedVariant?.price ?? product.price;
  const effectiveStock = selectedVariant?.stock ?? product.stock;
  const images = media.length ? media : [{ id: "fallback", productId: product.id, kind: "image" as const, storageKey: product.imagePath ?? "", altText: product.name, sortOrder: 0, isPrimary: true }];
  const currentImage = images[mediaIndex] ?? images[0];
  const attributes: Array<[string, JsonValue]> = Object.entries({ ...product.attributes, ...(selectedVariant?.attributes ?? {}) }).filter(([_, value]) => value !== null && value !== undefined && value !== "");
  const addToCart = () => {
    const next = addCartLine({
      productId: product.id,
      variantId: selectedVariant?.id ?? null,
      quantity,
      name: selectedVariant?.name ? `${product.name} · ${selectedVariant.name}` : product.name,
      price: effectivePrice,
      imagePath: currentImage?.storageKey || product.imagePath,
      merchantId: product.merchantId,
      stock: effectiveStock,
    });
    setCartItems(next);
    setAddedNotice(true);
    window.setTimeout(() => setAddedNotice(false), 2200);
  };

  return <div className="min-h-screen bg-market-bg text-market-ink">
    <header className="sticky top-0 z-30 border-b border-market-line/80 bg-white/92 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-market-muted hover:text-market-green"><ArrowLeft size={17}/> Marketplace</Link>
        <div className="ml-auto flex items-center gap-2"><button aria-label="Save product" className="rounded-xl border border-market-line p-2.5 hover:bg-market-soft"><Heart size={18}/></button><Link to="/cart" aria-label={`Open cart, ${cartCount(cartItems)} items`} className="relative rounded-xl border border-market-line p-2.5 hover:bg-market-soft"><ShoppingBag size={18}/>{cartCount(cartItems) > 0 && <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-market-orange px-1.5 py-0.5 text-center text-[10px] font-black text-white">{cartCount(cartItems)}</span>}</Link></div>
      </div>
    </header>

    <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-market-muted"><Link to="/" className="hover:text-market-green">Home</Link><span>/</span><span>{product.category}</span>{product.subcategory && <><span>/</span><span>{product.subcategory}</span></>}<span>/</span><span className="text-market-ink">{product.name}</span></div>

      <section className="grid gap-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)] lg:items-start">
        <div className="grid gap-3 sm:grid-cols-[82px_minmax(0,1fr)]">
          <div className="order-2 flex gap-2 overflow-x-auto sm:order-1 sm:flex-col">{images.map((image, index) => <button key={image.id} onClick={() => setMediaIndex(index)} aria-label={`View image ${index + 1}`} className={`h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 bg-white ${index === mediaIndex ? "border-market-green" : "border-market-line"}`}><img src={image.storageKey} alt={image.altText ?? product.name} className="h-full w-full object-cover"/></button>)}</div>
          <div className="relative order-1 aspect-square overflow-hidden rounded-[28px] border border-market-line bg-white shadow-market sm:order-2">
            {currentImage.storageKey ? <img src={currentImage.storageKey} alt={currentImage.altText ?? product.name} className="h-full w-full object-contain p-4 sm:p-8"/> : <div className="flex h-full items-center justify-center text-market-muted">No product image</div>}
            {images.length > 1 && <><button onClick={() => setMediaIndex((mediaIndex - 1 + images.length) % images.length)} aria-label="Previous image" className="absolute left-3 top-1/2 rounded-full bg-white/95 p-2 shadow-lg"><ChevronLeft/></button><button onClick={() => setMediaIndex((mediaIndex + 1) % images.length)} aria-label="Next image" className="absolute right-3 top-1/2 rounded-full bg-white/95 p-2 shadow-lg"><ChevronRight/></button></>}
          </div>
        </div>

        <div className="rounded-[28px] border border-market-line bg-white p-5 shadow-market sm:p-7">
          <div className="flex flex-wrap gap-2"><span className="rounded-full bg-market-soft px-3 py-1 text-[11px] font-black uppercase tracking-wider text-market-green">{product.condition.replace("_", " ")}</span>{product.verified && <span className="inline-flex items-center gap-1 rounded-full bg-market-green/10 px-3 py-1 text-[11px] font-black text-market-green"><BadgeCheck size={13}/> Verified merchant</span>}{product.financingEligible && <span className="rounded-full bg-market-orange/10 px-3 py-1 text-[11px] font-black text-market-orange">Pay over time</span>}</div>
          <h1 className="mt-4 text-3xl font-black leading-tight tracking-[-.04em] sm:text-4xl">{product.name}</h1>
          {(product.brand || product.model) && <p className="mt-2 text-sm font-semibold text-market-muted">{[product.brand, product.model].filter(Boolean).join(" · ")}</p>}
          <div className="mt-6 flex items-end justify-between gap-4"><div><p className="text-3xl font-black tracking-[-.03em]">{formatGhs(effectivePrice)}</p>{product.financingEligible && <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-market-green"><CreditCard size={14}/> Financing may be available at checkout*</p>}</div><span className={`text-xs font-bold ${effectiveStock > 0 ? "text-market-green" : "text-red-600"}`}>{effectiveStock > 0 ? `${effectiveStock} available` : "Out of stock"}</span></div>

          {variants.length > 0 && <div className="mt-7 space-y-5">{variantGroups.map((group) => <div key={group.key}><div className="mb-2 flex justify-between"><span className="text-sm font-black capitalize">{humanize(group.key)}</span><span className="text-xs text-market-muted">{selectedVariant?.attributes[group.key] as string ?? "Select"}</span></div><div className="flex flex-wrap gap-2">{group.values.map((value) => { const variant = variants.find(v => String(v.attributes[group.key] ?? "") === value && isCompatible(v, selectedVariant, group.key)); return <button key={value} disabled={!variant} onClick={() => variant && setSelectedVariantId(variant.id)} className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold transition ${selectedVariant?.attributes[group.key] === value ? "border-market-green bg-market-green text-white" : "border-market-line hover:border-market-green disabled:cursor-not-allowed disabled:opacity-35"}`}>{value}{selectedVariant?.attributes[group.key] === value && <Check size={14} className="ml-1 inline"/>}</button>})}</div></div>)}</div>}

          <div className="mt-7 flex flex-col gap-2 xs:flex-row sm:flex-row"><div className="flex h-12 w-full shrink-0 items-center justify-center rounded-xl border border-market-line sm:w-auto"><button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="h-full w-11 text-lg font-black" aria-label="Decrease quantity">−</button><span className="w-8 text-center text-sm font-black">{quantity}</span><button onClick={() => setQuantity(q => Math.min(effectiveStock, q + 1))} disabled={quantity >= effectiveStock} className="h-full w-11 text-lg font-black disabled:opacity-30" aria-label="Increase quantity">+</button></div><button disabled={effectiveStock < 1} onClick={addToCart} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-market-orange px-5 text-sm font-black text-white shadow-lg shadow-market-orange/15 hover:bg-market-orange/90 disabled:cursor-not-allowed disabled:opacity-40">Add to cart <ShoppingBag size={17}/></button></div>
          <p className="mt-2 text-[11px] text-market-muted">* Financing is subject to the selected provider's eligibility and approval. ELEMARKET does not guarantee credit.</p>

          <div className="mt-7 grid grid-cols-2 gap-2 border-t border-market-line pt-5 sm:grid-cols-4"><Feature icon={<Truck/>} title="Delivery" text={product.fulfillmentType.replaceAll("_", " ")}/><Feature icon={<ShieldCheck/>} title="Secure" text="Protected checkout"/><Feature icon={<RotateCcw/>} title="Returns" text={product.returnable ? `${product.returnWindowDays ?? 0} days` : "Not offered"}/><Feature icon={<BadgeCheck/>} title="Warranty" text={product.warrantyMonths ? `${product.warrantyMonths} months` : "See listing"}/></div>
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_.6fr]">
        <div className="rounded-[24px] border border-market-line bg-white p-5 sm:p-7"><p className="eyebrow">Product information</p><h2 className="mt-1 text-2xl font-black">Specifications</h2>{attributes.length ? <div className="mt-5 grid gap-2 sm:grid-cols-2">{attributes.map(([key,value]) => <div key={key} className="flex items-center justify-between gap-4 rounded-xl bg-market-bg px-4 py-3 text-sm"><span className="font-semibold text-market-muted">{humanize(key)}</span><span className="max-w-[60%] text-right font-black">{formatAttribute(value)}</span></div>)}</div> : <p className="mt-4 text-sm text-market-muted">No additional specifications have been provided.</p>}<div className="mt-7 border-t border-market-line pt-6"><h3 className="font-black">Description</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-market-muted">{product.description || "No description provided."}</p></div></div>
        <aside className="rounded-[24px] border border-market-line bg-market-ink p-5 text-white shadow-market sm:p-7"><p className="text-xs font-black uppercase tracking-[.16em] text-market-mint">Merchant</p><h2 className="mt-2 text-xl font-black">{product.merchantName}</h2><p className="mt-1 text-sm text-white/60">{product.neighborhood}, {product.city}</p><div className="mt-5 flex items-center gap-2 text-sm font-bold"><ShieldCheck className="text-market-mint" size={17}/> Verified merchant</div><p className="mt-5 text-sm leading-6 text-white/65">Shop with confidence. Merchant identity and listing eligibility are validated by ELEMARKET before products are publicly available.</p></aside>
      </section>

      {related.length > 0 && <section className="mt-10 pb-14"><p className="eyebrow">You may also like</p><h2 className="section-title">More from this category</h2><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{related.map(p => <Link key={p.id} to="/products/$id" params={{id:p.id}} className="overflow-hidden rounded-2xl border border-market-line bg-white transition hover:-translate-y-1 hover:shadow-market-lg"><div className="aspect-[4/3] bg-market-soft">{p.imagePath && <img src={p.imagePath} alt={p.name} className="h-full w-full object-cover"/>}</div><div className="p-3"><p className="line-clamp-2 text-sm font-bold">{p.name}</p><p className="mt-2 font-black">{formatGhs(p.price)}</p></div></Link>)}</div></section>}
    </main>
    {addedNotice && <div className="fixed inset-x-3 bottom-3 z-50 sm:inset-auto sm:bottom-6 sm:right-6 sm:left-auto"><Link to="/cart" className="flex min-h-14 items-center gap-3 rounded-2xl bg-market-ink px-4 py-3 text-white shadow-2xl"><ShoppingBag size={18} className="text-market-mint"/><span className="text-sm font-bold">Added to cart</span><span className="rounded-xl bg-market-orange px-3 py-2 text-xs font-black">View cart</span></Link></div>}
  </div>;
}

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="rounded-xl bg-market-bg p-3"><div className="text-market-green [&_svg]:h-4 [&_svg]:w-4">{icon}</div><p className="mt-2 text-xs font-black">{title}</p><p className="mt-0.5 text-[10px] font-semibold capitalize text-market-muted">{text}</p></div>; }
function humanize(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()); }
function formatAttribute(value: JsonValue) { if (typeof value === "boolean") return value ? "Yes" : "No"; if (Array.isArray(value)) return value.join(", "); return String(value); }
function groupVariantAttributes(variants: ProductVariant[]) { const keys = [...new Set(variants.flatMap(v => Object.keys(v.attributes)))]; return keys.map(key => ({ key, values: [...new Set(variants.map(v => String(v.attributes[key] ?? "")).filter(Boolean))] })); }
function isCompatible(variant: ProductVariant, selected: ProductVariant | null, changedKey: string) { if (!selected) return true; return Object.entries(selected.attributes).every(([key,value]) => key === changedKey || variant.attributes[key] === value); }
