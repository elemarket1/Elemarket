import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { apiFetch, signOut } from "../src/auth";
import { loadCart, saveCart, type CartItem } from "../src/cart";

type Product = { id:string; merchant_id:string; merchant_name:string; name:string; category:string; price:string; stock:number; city:string; description:string };

export default function Home() {
  const [q,setQ]=useState(""); const [products,setProducts]=useState<Product[]>([]); const [loading,setLoading]=useState(true); const [cartCount,setCartCount]=useState(0);
  async function load(){ setLoading(true); const r=await apiFetch(`/api/mobile/catalog?q=${encodeURIComponent(q)}`); if(r.ok){const j=await r.json();setProducts(j.products??[]);} setLoading(false); }
  async function refreshCart(){ const cart=await loadCart(); setCartCount(cart.reduce((n,x)=>n+x.quantity,0)); }
  useEffect(()=>{load();refreshCart();},[]);
  async function add(item: Product){
    const cart=await loadCart(); const existing=cart.find(x=>x.productId===item.id && x.variantId===null);
    const next: CartItem[]=existing ? cart.map(x=>x===existing?{...x,quantity:Math.min(x.stock,x.quantity+1)}:x) : [...cart,{productId:item.id,variantId:null,merchantId:item.merchant_id,merchantName:item.merchant_name,name:item.name,price:item.price,quantity:1,stock:item.stock}];
    await saveCart(next); setCartCount(next.reduce((n,x)=>n+x.quantity,0)); Alert.alert("Added to cart", `${item.name} is in your cart.`);
  }
  return <SafeAreaView style={{flex:1,backgroundColor:"#f5f7f4"}}><View style={{padding:20,gap:12}}><View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><View><Text style={{fontSize:28,fontWeight:"900",color:"#14532d"}}>ELEMARKET</Text><Text style={{fontSize:14,color:"#667085"}}>Shop verified merchants across Ghana.</Text></View><Pressable onPress={()=>router.push("/cart")} style={{backgroundColor:"#14532d",padding:11,borderRadius:12}}><Text style={{color:"white",fontWeight:"900"}}>Cart ({cartCount})</Text></Pressable></View><View style={{flexDirection:"row",gap:8}}><TextInput value={q} onChangeText={setQ} onSubmitEditing={load} placeholder="Search products" style={{flex:1,backgroundColor:"white",borderRadius:12,padding:12,borderWidth:1,borderColor:"#ddd"}}/><Pressable onPress={load} style={{backgroundColor:"#14532d",paddingHorizontal:16,justifyContent:"center",borderRadius:12}}><Text style={{color:"white",fontWeight:"800"}}>Search</Text></Pressable></View><View style={{flexDirection:"row",gap:10}}><Link href="/login" asChild><Pressable style={{padding:10,backgroundColor:"white",borderRadius:10}}><Text>Sign in</Text></Pressable></Link><Link href="/profile" asChild><Pressable style={{padding:10,backgroundColor:"white",borderRadius:10}}><Text>Profile</Text></Pressable></Link><Pressable onPress={signOut} style={{padding:10,backgroundColor:"white",borderRadius:10}}><Text>Sign out</Text></Pressable></View></View><FlatList data={products} keyExtractor={p=>p.id} contentContainerStyle={{padding:20,paddingTop:4,gap:10}} renderItem={({item})=><View style={{backgroundColor:"white",borderRadius:16,padding:16}}><Text style={{fontSize:17,fontWeight:"800"}}>{item.name}</Text><Text style={{color:"#667085",marginTop:4}}>{item.merchant_name} · {item.city}</Text><Text style={{fontSize:18,fontWeight:"900",marginTop:10}}>GHS {item.price}</Text><Text style={{color:"#667085",marginTop:6}}>{item.stock} in stock</Text><Pressable disabled={item.stock<1} onPress={()=>add(item)} style={{marginTop:12,backgroundColor:"#14532d",padding:13,borderRadius:12,alignItems:"center"}}><Text style={{color:"white",fontWeight:"900"}}>Add to cart</Text></Pressable></View>} ListEmptyComponent={<Text style={{padding:20,color:"#667085"}}>{loading?"Loading…":"No products found."}</Text>} /></SafeAreaView>;
}
