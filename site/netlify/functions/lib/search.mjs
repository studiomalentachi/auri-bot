import { searchShopeeOffersBroad } from './shopee.mjs';

function normalizeMl(item){
  return {
    id:`ml_${item.id}`,
    externalId:item.id,
    name:item.title,
    marketplace:'mercadolivre',
    category:'',
    price:Number(item.price||0),
    originalPrice:Number(item.original_price||0),
    rating:0,
    sales:Number(item.sold_quantity||0),
    salesVerified:Number.isFinite(Number(item.sold_quantity)),
    affiliateLink:null,
    publicLink:item.permalink||null,
    image:item.thumbnail||null,
    factsVerified:true,
    dataSource:'Mercado Livre API'
  };
}

async function searchMl(keyword,limit=20){
  const token=process.env.MELI_ACCESS_TOKEN||'';
  const u=new URL('https://api.mercadolibre.com/sites/MLB/search');
  u.searchParams.set('q',keyword); u.searchParams.set('limit',String(Math.min(50,limit)));
  const headers={accept:'application/json'}; if(token)headers.authorization=`Bearer ${token}`;
  const r=await fetch(u,{headers}); if(!r.ok)throw new Error(`Mercado Livre HTTP ${r.status}`);
  const j=await r.json(); return (j.results||[]).map(normalizeMl);
}

export async function searchVerifiedOffers({keyword,marketplace='all',minSales=50,limit=20}){
  const out=[]; const errors=[];
  if(marketplace==='all'||marketplace==='shopee'){
    try{
      const rows=await searchShopeeOffersBroad(keyword,{minSales,desired:limit,pages:4,limitPerPage:20,broadSearch:true,sortBy:'sales'});
      out.push(...rows.map(p=>({
        id:`shopee_${p.shopId}_${p.itemId}`,externalId:p.itemId,shopId:p.shopId,name:p.name||p.productName,marketplace:'shopee',category:'',price:Number(p.price||p.priceMin||0),originalPrice:Number(p.originalPrice||0),discountPct:Number(p.discountPct||p.priceDiscountRate||0),rating:Number(p.rating||p.ratingStar||0),sales:Number(p.sales||0),salesVerified:true,affiliateLink:p.affiliateLink||p.offerLink||null,publicLink:p.publicLink||p.productLink||null,image:p.image||p.imageUrl||null,factsVerified:true,dataSource:'Shopee Affiliate Open API'
      })));
    }catch(e){errors.push(`Shopee: ${e.message}`)}
  }
  if(marketplace==='all'||marketplace==='mercadolivre'){
    try{out.push(...(await searchMl(keyword,limit)).filter(x=>x.salesVerified&&x.sales>=minSales));}catch(e){errors.push(`Mercado Livre: ${e.message}`)}
  }
  if(marketplace==='all'||marketplace==='shein') errors.push('SHEIN: a busca automática segura ainda exige verificação da página oficial antes de salvar; use cadastro por link enquanto essa etapa não estiver conectada ao painel.');
  if(marketplace==='all'||marketplace==='tiktokshop') errors.push('TikTok Shop: sem API de afiliados verificada neste projeto; use cadastro por link para não inventar dados.');
  const seen=new Set(); const rows=out.filter(x=>x.name&&x.price>0&&x.sales>=minSales).filter(x=>{const k=`${x.marketplace}:${x.externalId||x.publicLink||x.name}`;if(seen.has(k))return false;seen.add(k);return true});
  return {offers:rows.sort((a,b)=>b.sales-a.sales).slice(0,Math.max(1,Number(limit)||20)),errors};
}
