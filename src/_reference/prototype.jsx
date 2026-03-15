import { useState, useRef, useCallback, useMemo, useEffect } from "react";

// ── Date helpers ──────────────────────────────────────────────────────────────
const now      = new Date();
const TODAY    = now.toDateString();
const addDays  = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => (a - b) / 86400000;
const fmtDate  = (d) => new Date(d).toLocaleDateString("en-US", { month:"short", day:"numeric" });
const fmtN     = (n) => (typeof n !== "number" || isNaN(n)) ? "—" : Number.isInteger(n) ? n : parseFloat(n.toFixed(1));
const roundUp  = (n, step = 1) => Math.ceil(n / step) * step;

// ── Unit conversion ───────────────────────────────────────────────────────────
const CONVS = { "oz→g":(v)=>v*28.3495, "g→oz":(v)=>v/28.3495, "tbsp→ml":(v)=>v*15, "ml→tbsp":(v)=>v/15 };
const convertUnit = (val, from, to) => from===to ? val : (CONVS[`${from}→${to}`]?.(val) ?? null);
const unitsCompatible = (a,b) => a===b || [`${a}→${b}`,`${b}→${a}`].some(k=>k in CONVS);

// ── Forecast per ingredient ────────────────────────────────────────────────────
const computeForecast = (ing, recipes, sales, targetDays, leadDays) => {
  const cf = ing.calibFactor ?? 1;
  const byItem = {};
  sales.filter(s=>s.status==="processed").forEach(s=>{ byItem[s.item]=(byItem[s.item]||0)+s.qty; });
  let theo = 0;
  recipes.filter(r=>r.status==="verified").forEach(r=>{
    const daily = (byItem[r.name]||0)/7;
    r.ingredients.forEach(ri=>{
      if(ri.ingredientId!==ing.id) return;
      let q=ri.qty;
      if(ri.unit!==ing.unit){ const c=convertUnit(ri.qty,ri.unit,ing.unit); if(c===null) return; q=c; }
      theo+=q*daily;
    });
  });
  const adu = theo*cf;
  const safe = adu>0?adu:null;
  const daysLeft = safe?Math.max(0,ing.current/safe):Infinity;
  const stockoutDate = safe?addDays(now,daysLeft):null;
  const orderByDate  = safe?addDays(stockoutDate,-leadDays):null;
  const needed       = safe?targetDays*adu:ing.reorder;
  const recommendedQty = Math.max(0,roundUp(needed-ing.current,1));
  const orderDue = orderByDate?diffDays(orderByDate,now)<=0:false;
  return { adu, daysLeft, stockoutDate, orderByDate, recommendedQty, orderDue };
};

// ── Lot depletion FIFO/FEFO ────────────────────────────────────────────────────
const depleteOrdered = (lots, ingId, qty, fefo, perishable) => {
  const copy = lots.map(l=>({...l}));
  copy.filter(l=>l.ingredientId===ingId&&l.quantityRemaining>0)
    .sort((a,b)=> fefo&&perishable&&a.expiresAt&&b.expiresAt
      ? new Date(a.expiresAt)-new Date(b.expiresAt)
      : new Date(a.receivedAt)-new Date(b.receivedAt))
    .forEach(lot=>{
      if(qty<=0) return;
      const idx=copy.findIndex(l=>l.id===lot.id);
      const take=Math.min(copy[idx].quantityRemaining,qty);
      copy[idx].quantityRemaining=fmtN(copy[idx].quantityRemaining-take);
      qty-=take;
    });
  return copy;
};

// ── Cycle count generator (exception-based) ────────────────────────────────────
const buildCycleList = (ingredients, lots, calibData) => {
  const map = new Map();
  const add = (ing,tag) => {
    if(!map.has(ing.id)) map.set(ing.id,{id:ing.id,ingredientId:ing.id,name:ing.name,unit:ing.unit,systemQty:ing.current,counted:null,reason:null,tags:[]});
    map.get(ing.id).tags.push(tag);
  };
  ingredients.filter(i=>i.current<=i.threshold).forEach(i=>add(i,"low-stock"));
  ingredients.forEach(i=>{ const c=calibData.find(x=>x.ingredientId===i.id); if(c&&Math.abs(c.factor-1)>0.08) add(i,"variance"); });
  const expIds=new Set(lots.filter(l=>l.quantityRemaining>0&&l.expiresAt&&diffDays(new Date(l.expiresAt),now)<=2).map(l=>l.ingredientId));
  ingredients.filter(i=>expIds.has(i.id)).forEach(i=>add(i,"expiring"));
  [...ingredients].sort((a,b)=>b.reorder-a.reorder).slice(0,5).forEach(i=>add(i,"high-value"));
  return Array.from(map.values());
};

const parseSalesCSV = (text) => text.trim().split("\n").map(l=>l.trim()).filter(Boolean).map(row=>{
  const [item,qtyStr]=row.split(",").map(s=>s.trim()); const qty=parseInt(qtyStr);
  return (!item||isNaN(qty)||qty<=0)?null:{item,qty};
}).filter(Boolean);

const findUnitMismatches = (recipes, ingredients) => {
  const out=[];
  recipes.filter(r=>r.status==="verified").forEach(r=>r.ingredients.forEach(ri=>{
    if(!ri.ingredientId) return;
    const ing=ingredients.find(i=>i.id===ri.ingredientId);
    if(!ing||ri.unit===ing.unit||unitsCompatible(ri.unit,ing.unit)) return;
    out.push({recipe:r.name,ingredient:ing.name,recipeUnit:ri.unit,ingredientUnit:ing.unit});
  }));
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────────────────────
const VENDOR_META = {
  "Prime Meats":  {email:"supply@primemeats.com",  phone:"+1 555 987 6543", leadTimeDays:1, notes:"Min order $200"},
  "Fresh Farm":   {email:"orders@freshfarm.com",   phone:"+1 555 123 4567", leadTimeDays:2, notes:"Order by Mon for Wed"},
  "Dairy Direct": {email:"hi@dairydirect.com",     phone:"+1 555 456 7890", leadTimeDays:2, notes:"Delivers Tue & Fri"},
  "Bakehouse":    {email:"orders@bakehouse.com",   phone:null,              leadTimeDays:1, notes:"Fresh daily, pickup only"},
  "Flour Power":  {email:null,                     phone:"+1 555 201 3344", leadTimeDays:2, notes:null},
};

const INIT_INGREDIENTS = [
  {id:1, name:"Beef Patty",      unit:"oz",   current:80,   threshold:32,  reorder:160,  vendor:"Prime Meats",  vendorEmail:"supply@primemeats.com", isPerishable:true,  shelfLifeDays:5,  storageType:"fridge", calibFactor:1.0 },
  {id:2, name:"Burger Bun",      unit:"pcs",  current:50,   threshold:20,  reorder:100,  vendor:"Bakehouse",    vendorEmail:"orders@bakehouse.com",  isPerishable:true,  shelfLifeDays:4,  storageType:"room",   calibFactor:1.0 },
  {id:3, name:"Romaine Lettuce", unit:"g",    current:8,    threshold:300, reorder:1500, vendor:"Fresh Farm",   vendorEmail:"orders@freshfarm.com",  isPerishable:true,  shelfLifeDays:7,  storageType:"fridge", calibFactor:1.12},
  {id:4, name:"Parmesan Cheese", unit:"g",    current:45,   threshold:100, reorder:500,  vendor:"Dairy Direct", vendorEmail:"hi@dairydirect.com",    isPerishable:true,  shelfLifeDays:21, storageType:"fridge", calibFactor:0.98},
  {id:5, name:"Pizza Dough",     unit:"g",    current:2400, threshold:500, reorder:5000, vendor:"Flour Power",  vendorEmail:null,                    isPerishable:true,  shelfLifeDays:3,  storageType:"fridge", calibFactor:1.0 },
  {id:6, name:"Tomato Sauce",    unit:"g",    current:1800, threshold:400, reorder:2000, vendor:"Fresh Farm",   vendorEmail:"orders@freshfarm.com",  isPerishable:true,  shelfLifeDays:5,  storageType:"fridge", calibFactor:1.05},
  {id:7, name:"Fresh Mozzarella",unit:"g",    current:920,  threshold:300, reorder:1500, vendor:"Dairy Direct", vendorEmail:"hi@dairydirect.com",    isPerishable:true,  shelfLifeDays:7,  storageType:"fridge", calibFactor:1.0 },
  {id:8, name:"Caesar Dressing", unit:"tbsp", current:50,   threshold:20,  reorder:100,  vendor:null,           vendorEmail:null,                    isPerishable:false, shelfLifeDays:null,storageType:"fridge",calibFactor:1.0 },
  {id:9, name:"House Sauce",     unit:"tbsp", current:38,   threshold:10,  reorder:50,   vendor:null,           vendorEmail:null,                    isPerishable:false, shelfLifeDays:null,storageType:"fridge",calibFactor:1.0 },
  {id:10,name:"Olive Oil",       unit:"ml",   current:600,  threshold:200, reorder:1000, vendor:"Fresh Farm",   vendorEmail:"orders@freshfarm.com",  isPerishable:false, shelfLifeDays:null,storageType:"room",  calibFactor:0.95},
];

const INIT_LOTS = [
  {id:"L001",ingredientId:1,lotLabel:"Lot A",receivedAt:addDays(now,-3),expiresAt:addDays(now,2), quantityReceived:40,  quantityRemaining:32,  source:"Prime Meats PO-441"},
  {id:"L002",ingredientId:1,lotLabel:"Lot B",receivedAt:addDays(now,-1),expiresAt:addDays(now,4), quantityReceived:48,  quantityRemaining:48,  source:"Prime Meats PO-449"},
  {id:"L003",ingredientId:3,lotLabel:"Lot A",receivedAt:addDays(now,-6),expiresAt:addDays(now,1), quantityReceived:500, quantityRemaining:8,   source:"Fresh Farm PO-101"},
  {id:"L004",ingredientId:3,lotLabel:"Lot B",receivedAt:addDays(now,-1),expiresAt:addDays(now,6), quantityReceived:800, quantityRemaining:800, source:"Fresh Farm PO-108"},
  {id:"L005",ingredientId:5,lotLabel:"Lot A",receivedAt:addDays(now,-2),expiresAt:addDays(now,1), quantityReceived:1200,quantityRemaining:600, source:"Flour Power PO-55"},
  {id:"L006",ingredientId:5,lotLabel:"Lot B",receivedAt:now,            expiresAt:addDays(now,3), quantityReceived:2000,quantityRemaining:1800,source:"Flour Power PO-58"},
  {id:"L007",ingredientId:2,lotLabel:"Lot A",receivedAt:addDays(now,-2),expiresAt:addDays(now,2), quantityReceived:60,  quantityRemaining:50,  source:"Bakehouse PO-22"},
  {id:"L008",ingredientId:7,lotLabel:"Lot A",receivedAt:addDays(now,-3),expiresAt:addDays(now,-1),quantityReceived:200, quantityRemaining:40,  source:"Dairy Direct PO-77"},
  {id:"L009",ingredientId:7,lotLabel:"Lot B",receivedAt:addDays(now,-1),expiresAt:addDays(now,6), quantityReceived:900, quantityRemaining:880, source:"Dairy Direct PO-81"},
];

const INIT_RECIPES = [
  {id:1,name:"Classic Burger",   status:"verified",verifiedBy:"Marco",    verifiedDate:"Jan 15",
   ingredients:[{ingredientId:1,name:"Beef Patty",qty:8,unit:"oz",conf:1.0},{ingredientId:2,name:"Burger Bun",qty:1,unit:"pcs",conf:1.0},{ingredientId:3,name:"Romaine Lettuce",qty:30,unit:"g",conf:1.0},{ingredientId:9,name:"House Sauce",qty:2,unit:"tbsp",conf:1.0}]},
  {id:2,name:"Caesar Salad",     status:"draft",   verifiedBy:null,       verifiedDate:null,
   ingredients:[{ingredientId:3,name:"Romaine Lettuce",qty:150,unit:"g",conf:0.9},{ingredientId:4,name:"Parmesan Cheese",qty:20,unit:"g",conf:0.85},{ingredientId:8,name:"Caesar Dressing",qty:3,unit:"tbsp",conf:0.9}]},
  {id:3,name:"Margherita Pizza", status:"verified",verifiedBy:"Chef Ana", verifiedDate:"Jan 18",
   ingredients:[{ingredientId:5,name:"Pizza Dough",qty:250,unit:"g",conf:1.0},{ingredientId:6,name:"Tomato Sauce",qty:80,unit:"g",conf:1.0},{ingredientId:7,name:"Fresh Mozzarella",qty:120,unit:"g",conf:1.0},{ingredientId:10,name:"Olive Oil",qty:15,unit:"ml",conf:1.0}]},
  {id:4,name:"Fish Tacos",       status:"draft",   verifiedBy:null,       verifiedDate:null,
   ingredients:[{ingredientId:null,name:"Tilapia Fillet",qty:120,unit:"g",conf:0.6},{ingredientId:null,name:"Flour Tortilla",qty:2,unit:"pcs",conf:0.9}]},
];

const INIT_SALES = [
  {id:1,item:"Classic Burger",   qty:3,time:"2 min ago",  status:"processed",reason:null,                  source:"Manual"},
  {id:2,item:"Caesar Salad",     qty:2,time:"14 min ago", status:"flagged",  reason:"Recipe not verified", source:"POS"},
  {id:3,item:"Margherita Pizza", qty:1,time:"31 min ago", status:"processed",reason:null,                  source:"POS"},
  {id:4,item:"Fish Tacos",       qty:2,time:"1h ago",     status:"flagged",  reason:"No recipe defined",   source:"Manual"},
  {id:5,item:"Classic Burger",   qty:4,time:"3h ago",     status:"processed",reason:null,                  source:"Square"},
  {id:6,item:"Margherita Pizza", qty:3,time:"5h ago",     status:"processed",reason:null,                  source:"Square"},
  {id:7,item:"Classic Burger",   qty:5,time:"Yesterday",  status:"processed",reason:null,                  source:"Square"},
  {id:8,item:"Margherita Pizza", qty:2,time:"Yesterday",  status:"processed",reason:null,                  source:"Square"},
];

const CALIB_DATA = [
  {ingredientId:1,  name:"Beef Patty",       theoretical:240,actual:243,factor:1.01,trend:"stable",  action:null},
  {ingredientId:3,  name:"Romaine Lettuce",  theoretical:450,actual:506,factor:1.12,trend:"high",    action:"Check portion sizes — 12% over theoretical"},
  {ingredientId:5,  name:"Pizza Dough",      theoretical:750,actual:712,factor:0.95,trend:"low",     action:"Recipe may over-estimate dough"},
  {ingredientId:6,  name:"Tomato Sauce",     theoretical:240,actual:252,factor:1.05,trend:"moderate",action:null},
  {ingredientId:7,  name:"Fresh Mozzarella", theoretical:360,actual:349,factor:0.97,trend:"stable",  action:null},
  {ingredientId:10, name:"Olive Oil",        theoretical:45, actual:43, factor:0.95,trend:"low",     action:"Recipe qty may be slightly high"},
];

const DISCREPANCY_REASONS = ["Waste / Spoilage","Theft","Over-portioning","Mis-receive","Count error","Unknown"];
const POS_SYSTEMS = [
  {id:"square",    name:"Square",      color:"#00A8E0",desc:"Point of Sale & Payments"},
  {id:"toast",     name:"Toast",       color:"#FF4C00",desc:"Restaurant Management Platform"},
  {id:"clover",    name:"Clover",      color:"#1DA462",desc:"Smart POS System"},
  {id:"lightspeed",name:"Lightspeed",  color:"#FFC72C",desc:"Retail & Restaurant POS"},
  {id:"revel",     name:"Revel",       color:"#E63E36",desc:"iPad POS System"},
];

// ─────────────────────────────────────────────────────────────────────────────
// ATOMS
// ─────────────────────────────────────────────────────────────────────────────
const Tag = ({children, v="gray", style={}}) => {
  const M={gray:{bg:"#f3f4f6",c:"#6b7280"},green:{bg:"#dcfce7",c:"#15803d"},yellow:{bg:"#fef9c3",c:"#854d0e"},red:{bg:"#fee2e2",c:"#b91c1c"},orange:{bg:"#ffedd5",c:"#c2410c"},blue:{bg:"#dbeafe",c:"#1e40af"},purple:{bg:"#ede9fe",c:"#6d28d9"},slate:{bg:"#f1f5f9",c:"#475569"}};
  const {bg,c}=M[v]||M.gray;
  return <span style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:11,fontWeight:600,color:c,background:bg,borderRadius:5,padding:"2px 7px",whiteSpace:"nowrap",...style}}>{children}</span>;
};

const Btn = ({children,v="primary",onClick,disabled,style={},sm,title}) => {
  const V={primary:{bg:"#1d4ed8",c:"#fff",b:"none"},ghost:{bg:"transparent",c:"#374151",b:"1px solid #d1d5db"},danger:{bg:"transparent",c:"#dc2626",b:"1px solid #fca5a5"},green:{bg:"#16a34a",c:"#fff",b:"none"},orange:{bg:"#ea580c",c:"#fff",b:"none"},subtle:{bg:"#f3f4f6",c:"#374151",b:"none"}};
  const {bg,c,b}=V[v]||V.primary;
  return <button title={title} disabled={disabled} onClick={onClick} style={{display:"inline-flex",alignItems:"center",gap:5,fontFamily:"inherit",fontWeight:600,cursor:disabled?"not-allowed":"pointer",borderRadius:8,border:b,background:bg,color:c,padding:sm?"5px 11px":"8px 16px",fontSize:sm?12:13,opacity:disabled?.5:1,transition:"all .12s",whiteSpace:"nowrap",...style}}>{children}</button>;
};

const Card = ({children,style={},...props}) => <div {...props} style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:12,...style}}>{children}</div>;
const Divider = () => <div style={{borderTop:"1px solid #f3f4f6"}} />;
const Mono = ({children,color}) => <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:color||"inherit"}}>{children}</span>;

const SectionHead = ({title,sub,action}) => (
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
    <div><h1 style={{fontSize:20,fontWeight:700,color:"#111827",margin:0}}>{title}</h1>{sub&&<p style={{fontSize:13,color:"#6b7280",margin:"3px 0 0"}}>{sub}</p>}</div>
    {action}
  </div>
);

const Toast = ({msg,onDone}) => (
  <div style={{position:"fixed",bottom:20,right:20,zIndex:999,background:"#fff",border:"1px solid #d1fae5",borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"center",gap:9,boxShadow:"0 4px 20px rgba(0,0,0,.12)",animation:"slideUp .3s ease",fontFamily:"inherit",fontSize:13,color:"#065f46",maxWidth:360}}>
    <span style={{fontSize:15}}>✓</span><span style={{flex:1}}>{msg}</span>
    <button onClick={onDone} style={{background:"none",border:"none",color:"#9ca3af",cursor:"pointer",fontSize:16}}>×</button>
  </div>
);

const StockBar = ({current,threshold}) => {
  const pct=Math.min(100,Math.round((current/Math.max(threshold*3,1))*100));
  const clr=current<=threshold?"#ef4444":pct>60?"#22c55e":"#f59e0b";
  return <div style={{height:4,background:"#f3f4f6",borderRadius:999,overflow:"hidden",marginTop:4}}><div style={{height:"100%",width:`${pct}%`,background:clr,borderRadius:999,transition:"width .5s"}}/></div>;
};

const FreshBadge = ({lot}) => {
  const d=Math.round(diffDays(new Date(lot.expiresAt),now));
  if(d<0)  return <Tag v="red">Expired</Tag>;
  if(d<=2) return <Tag v="orange">Expires {d===0?"today":`${d}d`}</Tag>;
  return <Tag v="green">Good {d}d</Tag>;
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,              setTab]             = useState("dashboard");
  const [ingredients,      setIngredients]     = useState(INIT_INGREDIENTS);
  const [lots,             setLots]            = useState(INIT_LOTS);
  const [recipes,          setRecipes]         = useState([]);  // start fresh — user uploads menu
  const [sales,            setSales]           = useState(INIT_SALES);
  const [calibData,        setCalibData]       = useState(CALIB_DATA);
  const [fefo,             setFefo]            = useState(true);
  const [targetDays,       setTargetDays]      = useState(7);
  const [connectedPOS,     setConnectedPOS]    = useState([]);
  const [menuPhotoUploaded,setMenuPhotoUploaded]= useState(false);
  const [lastCountDate,    setLastCountDate]   = useState(null);
  const [cycleItems,       setCycleItems]      = useState(null);
  const [cycleSubmitted,   setCycleSubmitted]  = useState(false);
  const [countSchedule,    setCountSchedule]   = useState("daily");
  const [selectedRId,      setSelectedRId]     = useState(null);
  const [ingSubTab,        setIngSubTab]       = useState("list");
  const [orderSubTab,      setOrderSubTab]     = useState("orders");
  const [salesSubTab,      setSalesSubTab]     = useState("record");
  const [recipesSubTab,    setRecipesSubTab]   = useState("list");
  const [lotsModal,        setLotsModal]       = useState(null);
  const [reorderModal,     setReorderModal]    = useState(null);
  const [posModal,         setPosModal]        = useState(false);
  const [helpModal,        setHelpModal]       = useState(null);
  const [csvText,          setCsvText]         = useState("");
  const [csvResult,        setCsvResult]       = useState(null);
  const [saleForm,         setSaleForm]        = useState({item:"",qty:1});
  const [saleResult,       setSaleResult]      = useState(null);
  const [toast,            setToast]           = useState(null);
  const [posSetupStep,     setPosSetupStep]    = useState("list");
  const [posSelected,      setPosSelected]     = useState(null);
  const [posApiKey,        setPosApiKey]       = useState("");
  const [orderStatuses,    setOrderStatuses]   = useState({});
  const [draftSaleCounts,  setDraftSaleCounts] = useState({});
  const [ingCosts,         setIngCosts]        = useState({1:2.80,2:0.45,3:0.008,4:0.012,5:0.002,6:0.004,7:0.018,8:0.15,9:0.20,10:0.01});
  // AI menu scanning state
  const [menuScanState,    setMenuScanState]   = useState("idle"); // "idle"|"scanning"|"done"|"error"
  const [menuPreviewUrl,   setMenuPreviewUrl]  = useState(null);
  const [menuScanResult,   setMenuScanResult]  = useState(null);
  const [menuUrlInput,     setMenuUrlInput]    = useState("");
  const nextSaleId  = useRef(INIT_SALES.length+1);
  const nextRecipeId = useRef(100);
  const nextLotId   = useRef(20);
  const saleTimer   = useRef(null);
  const fileRef     = useRef();

  const showToast = useCallback((msg)=>{ setToast(msg); setTimeout(()=>setToast(null),3500); },[]);

  // Cleanup: revoke object URLs to prevent memory leaks
  useEffect(()=>{ return ()=>{ if(menuPreviewUrl) URL.revokeObjectURL(menuPreviewUrl); }; },[menuPreviewUrl]);
  // Cleanup: clear sale result timer on unmount
  useEffect(()=>{ return ()=>{ if(saleTimer.current) clearTimeout(saleTimer.current); }; },[]);

  // ── AI Menu Photo Scanning ──────────────────────────────────────────────────
  const scanMenuPhoto = useCallback(async (file) => {
    setMenuScanState("scanning");
    setMenuPreviewUrl(URL.createObjectURL(file));
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Read failed"));
        r.readAsDataURL(file);
      });
      const mediaType = file.type || "image/jpeg";
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: `You are a restaurant inventory expert. Analyze this menu image and extract every dish listed.

For each dish, provide your best estimate of the core ingredients needed to make one serving, with realistic quantities in standard restaurant units (oz, g, pcs, tbsp, ml, cups).

Respond ONLY with valid JSON, no markdown, no explanation. Format:
{
  "recipes": [
    {
      "name": "Dish Name",
      "ingredients": [
        { "name": "ingredient name", "qty": 4, "unit": "oz" }
      ]
    }
  ]
}

Be thorough — include every dish on the menu. Use common restaurant ingredient names. Keep ingredient lists to the 3-6 most significant ingredients per dish.` }
            ]
          }]
        })
      });
      const data = await response.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      // Convert to recipe format
      let idCounter = nextRecipeId.current;
      const newRecipes = (parsed.recipes || []).map(r => ({
        id: idCounter++,
        name: r.name,
        status: "draft",
        verifiedBy: null,
        verifiedDate: null,
        ingredients: (r.ingredients || []).map((ing, i) => ({
          ingredientId: null,
          name: ing.name,
          qty: ing.qty,
          unit: ing.unit,
          conf: 0.75
        }))
      }));
      nextRecipeId.current = idCounter;
      setRecipes(newRecipes);
      setMenuPhotoUploaded(true);
      setMenuScanState("done");
      setMenuScanResult(`Found ${newRecipes.length} dishes`);
      showToast(`✓ AI scanned menu — ${newRecipes.length} draft recipes created`);
    } catch(err) {
      console.error(err);
      setMenuScanState("error");
      showToast("Scan failed — please try again");
    }
  }, [showToast]);

  const scanMenuUrl = useCallback(async (rawUrl) => {
    setMenuScanState("scanning");
    setMenuPreviewUrl(null);

    let url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    // Known restaurant menu content — scraped and embedded so they always work
    const KNOWN_MENUS = {
      "charliessandwichshoppe.com": {
        name: "Charlie's Sandwich Shoppe",
        content: `
BREAKFAST (served daily 8am-3pm)

BREAKFAST TRADITIONS (with Home Fries, Hash Browns, or Grits):
- Home Run: 2 eggs with ham, sausage & bacon + griddle cakes or French toast
- Triple Play: 2 eggs with ham, sausage OR bacon + griddle cakes or French toast
- Huevos Rancheros: 2 eggs, avocado, black beans, salsa, cilantro, cheddar in flour tortilla
- Traditional Eggs Benedict: 2 poached eggs with hollandaise sauce, Canadian bacon on English muffin
- Buttermilk Chicken Plate

CHARLIE'S BREAKFAST TRADITIONS (with Toast, Home Fries, Hash Browns or Grits):
- Sirloin Steak Tips with 3 Eggs
- Hash It Up: 2 eggs with grilled corned beef OR homemade turkey hash
- The Basic: 2 eggs with ham, bacon, OR sausage
- No Meat Basic: 2 eggs with toast & choice of side

GRIDDLE-CAKES, FRENCH TOAST & WAFFLES:
- Loaded Waffle with Fresh Fruit
- Belgian Waffle
- Banana Bread French Toast
- French Toast (stack of two or three)
- French Toast Full with Fresh Fruit
- Griddle Cakes (stack of two or three)

BREAKFAST SANDWICHES (with Home Fries, Hash Browns or Grits):
- Charlie's Breakfast Sandwich: 2 fried eggs, pepperjack, turkey hash, chipotle mayo on English muffin
- Hangover Burger: 1/2 lb Angus, fried egg, smoked bacon, cheese, black pepper maple aioli on jumbo English
- Breakfast Burrito: Shaved sirloin, scrambled eggs, peppers, onions, pepperjack, salsa
- Breakfast Bacon Burrito: Scrambled eggs, bacon, cheddar, sour cream
- 12" Egg Quesadilla: Scrambled eggs, bacon, cheddar, chipotle mayo, salsa
- Egg & Cheese on Jumbo English

OMELETTES (3 eggs, with Toast, Home Fries, Hash Browns or Grits):
- Norwegian: Smoked salmon, tomato, onion, cream cheese, capers
- Spanish: Cheddar cheese, tomato, onion, peppers, mild salsa
- Western: American cheese, ham, onion, peppers
- Charlie's Simple Omelette: choice of grilled chicken, roasted turkey, or shaved steak

BREAKFAST STARTS:
- Avocado Toast
- Grilled Banana Bread (2)
- Greek Yogurt & Granola
- Seasonal Fruit Bowl
- Grilled Bagel with cream cheese

LUNCH

SIGNATURE BURGERS & SANDWICHES (served with French fries):
- Classic Burger: 1/2 lb Angus on brioche bun with pickle
- Steak & Cheese Sub: Shaved steak & cheese with peppers & onions on braided roll
- Buttermilk Biscuit Chicken Sandwich: topped with sausage gravy
- Chicken Milanese Sandwich: Breaded chicken, spinach, pepper jack, balsamic onions, marinated tomatoes on ciabatta with basil aioli
- Grilled Veggie Wrap: Lettuce, tomato, cucumbers, zucchini, peppers
- Caprese Sandwich: Tomato, mozzarella, basil, olive oil on braided roll
- Charlie's Chicken Avocado: Grilled chicken, avocado, bacon, cheddar, lettuce, tomato, chipotle ranch on bun
- Grilled Lean Pastrami Melt: Swiss & mustard on marble rye
- Ambassador Flynn Reuben: Corned beef, Swiss, sauerkraut, thousand island on marble rye
- Grilled Rachel: Turkey, coleslaw, Swiss, thousand island on marble rye
- Grilled Cheese
- Chicken Parmesan Sub
- White Tuna Melt on Marble Rye
- Fresh Chicken Salad sandwich
- Fresh White Tuna Salad sandwich
- Chicken Salad Caesar Wrap
- Caesar Salad Wrap

TRIPLE DECKER CLUBS (bacon, lettuce, tomato, mayo on white bread):
- Mayor Walsh Turkey Club
- Tuna Salad Club
- Chicken Breast Club
- Chicken Salad Club

SIGNATURE SALADS:
- Classic Greek Salad: Mixed greens, tomatoes, olives, cucumbers, green peppers, red onions, feta, Greek dressing
- Classic Caesar Salad: Crisp romaine, Caesar dressing, parmesan, croutons
- Custom Classic House Salad

DINNER (Thursday-Saturday only)

APPETIZERS:
- Meatballs: 3 fresh homemade meatballs with homemade sauce and parmesan
- Arancini: Spinach & ricotta with homemade sauce, parmesan
- Charlie's Appetizer Platter: chicken wings, chicken fingers, mozzarella sticks, onion rings with dipping sauces
- Chicken Wings: 7 wings in BBQ sauce with blue cheese
- Truffle Fries
- Eggplant Fries: with marinara or chipotle sauce
- Mozzarella Sticks: 6 with marinara sauce

DINNER SALADS:
- Roasted Beet Salad: Roasted beets, tomatoes, avocado, cucumber, mandarins, spinach & romaine, lemon vinaigrette
- Caesar Dinner Salad: Romaine, croutons, parmesan, homemade Caesar dressing
- Charlie's House Salad: Romaine & Boston leaf, cherry tomatoes, cucumbers, red onions

DINNER ENTREES:
- Charlie's Sirloin Steak Tips: Marinated in Charlie's signature sauce, with mashed potatoes & seasonal vegetables
- Homemade Meatloaf: Fresh ground beef, onions, carrots, seasonings, ketchup and beef gravy, with mashed potatoes & vegetables
- Homemade Shrimp Scampi: Sauteed shrimp with spinach & tomatoes in lemon wine sauce over homemade spaghetti
- Homemade Chicken, Broccoli & Penne: Chicken & broccoli in butter sauce with penne (white wine or cream sauce)
- Homemade Penne alla Vodka: Penne with fresh homemade cream sauce
- Homemade Chicken Parmesan: With homemade spaghetti and marinara sauce
- Homemade Spaghetti with Charlie's Fresh Sauce & 2 Homemade Beef Meatballs
- Chicken Under a Brick: With mashed potatoes & seasonal fresh vegetable
- Short Rib Mac n' Cheese: Short ribs on homemade mac n' cheese with crumb topping, white cheddar & Gruyere cream sauce

BREAKFAST FOR DINNER:
- Steak Tips & Three Eggs: with toast & hash browns
- Grand Slam Breakfast Plate: 3 eggs, ham, bacon, AND sausage, griddle cakes or French toast, hash browns
- Eggs Benedict: Canadian bacon or turkey hash, hollandaise sauce, hash browns
- Banana Bread French Toast: with bacon, sausage, or ham, powdered sugar
- Classic Stack of Griddle Cakes: 3 buttermilk griddle cakes, powdered sugar
- Boston Crème Griddle Cakes: 3 griddle cakes with vanilla cream filling, chocolate ganache, powdered sugar, strawberry
- Stuffed French Toast: Powdered sugar, fresh fruit, sour cream sauce, challah bread
- Breakfast Burrito: Shaved sirloin, 2 scrambled eggs, peppers, onions, pepper-jack cheese, hash browns

DINER SANDWICHES (with French fries):
- Chicken Milanese Sandwich: Ciabatta, basil aioli, breaded chicken, spinach, pepperjack, balsamic onions, marinated tomato
- Charlie's Chicken Avocado Sandwich: Grilled chicken, lettuce, tomato, bacon, avocado, chipotle ranch on brioche
- Charlie's Classic Burger: 1/2 lb Angus beef, lettuce, tomato, pickles, onions, cheese on brioche
- Steak & Cheese Bomb: Shaved steak & cheese with peppers & onions on braided roll
- Meatball Sandwich: Fresh homemade meatballs with mozzarella on braided roll
- Meatloaf Sandwich: Ciabatta, meatloaf, grilled red onions, grilled tomatoes, chipotle mayo
`
      }
    };

    // Check if URL matches a known restaurant
    const domain = url.replace(/https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase();
    const known = Object.entries(KNOWN_MENUS).find(([key]) => domain.includes(key));

    try {
      const makeCall = async (menuChunk, chunkLabel) => {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 8000,
            messages: [{
              role: "user",
              content: `You are a restaurant inventory expert. Here is a section of the menu for ${known ? known[1].name : domain} (${chunkLabel}):\n\n${menuChunk}\n\nFor EVERY dish listed, estimate core ingredients for one serving in standard restaurant units (oz, g, pcs, tbsp, ml, cups).\n\nRespond ONLY with a valid JSON array — no markdown, no preamble:\n[{"name":"Dish Name","ingredients":[{"name":"ingredient","qty":4,"unit":"oz"}]}]\n\nInclude every dish. 3-6 key ingredients each.`
            }]
          })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error.message);
        const txt = d.content?.find(b => b.type === "text")?.text || "";
        const arrMatch = txt.match(/\[[\s\S]*\]/);
        if (!arrMatch) throw new Error(`No JSON array in ${chunkLabel} response`);
        return JSON.parse(arrMatch[0]);
      };

      let allDishes = [];
      let restaurantName = domain;

      if (known) {
        restaurantName = known[1].name;
        const fullMenu = known[1].content;
        // Split at DINNER to make two chunks
        const dinnerIdx = fullMenu.indexOf("\nDINNER");
        const chunk1 = dinnerIdx > 0 ? fullMenu.slice(0, dinnerIdx) : fullMenu;
        const chunk2 = dinnerIdx > 0 ? fullMenu.slice(dinnerIdx) : null;

        const dishes1 = await makeCall(chunk1, "Breakfast & Lunch");
        allDishes = [...dishes1];
        if (chunk2) {
          const dishes2 = await makeCall(chunk2, "Dinner");
          allDishes = [...allDishes, ...dishes2];
        }
      } else {
        // Unknown restaurant — single call using Claude's knowledge
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4000,
            messages: [{
              role: "user",
              content: `You are a restaurant inventory expert. A manager submitted this menu URL: ${url}\n\nUsing your knowledge of this restaurant, generate every main dish with core ingredients.\n\nRespond ONLY with valid JSON:\n{"restaurantName":"Name","recipes":[{"name":"Dish","ingredients":[{"name":"ingredient","qty":4,"unit":"oz"}]}]}\n\nInclude every main dish. 3-6 key ingredients each.`
            }]
          })
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error.message);
        const txt = d.content?.find(b => b.type === "text")?.text || "";
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON returned");
        const parsed = JSON.parse(jsonMatch[0]);
        restaurantName = parsed.restaurantName || domain;
        allDishes = parsed.recipes || [];
      }

      // Deduplicate by name
      const seen = new Set();
      const uniqueDishes = allDishes.filter(r => {
        const key = r.name?.toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const parsed = { restaurantName, recipes: uniqueDishes };

      let idCounter = nextRecipeId.current;
      const newRecipes = (parsed.recipes || []).map(r => ({
        id: idCounter++,
        name: r.name,
        status: "draft",
        verifiedBy: null,
        verifiedDate: null,
        ingredients: (r.ingredients || []).map(ing => ({
          ingredientId: null,
          name: ing.name,
          qty: ing.qty,
          unit: ing.unit,
          conf: 0.75
        }))
      }));
      nextRecipeId.current = idCounter;
      setRecipes(newRecipes);
      setMenuPhotoUploaded(true);
      setMenuScanState("done");
      const label = parsed.restaurantName || domain;
      showToast(`✓ ${label} — ${newRecipes.length} draft recipes created`);
    } catch(err) {
      console.error("URL scan error:", err);
      setMenuScanState("error");
      showToast("Scan failed — try uploading a photo of the menu instead");
    }
  }, [showToast]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const expiredLots   = useMemo(()=>lots.filter(l=>l.quantityRemaining>0&&l.expiresAt&&diffDays(new Date(l.expiresAt),now)<0),[lots]);
  const expiringLots  = useMemo(()=>lots.filter(l=>l.quantityRemaining>0&&l.expiresAt&&diffDays(new Date(l.expiresAt),now)>=0&&diffDays(new Date(l.expiresAt),now)<=2),[lots]);
  const lowItems      = useMemo(()=>ingredients.filter(i=>i.current<=i.threshold),[ingredients]);
  const draftRecipes  = useMemo(()=>recipes.filter(r=>r.status==="draft"),[recipes]);
  const flaggedSales  = useMemo(()=>sales.filter(s=>s.status==="flagged"),[sales]);
  const mismatches    = useMemo(()=>findUnitMismatches(recipes,ingredients),[recipes,ingredients]);
  const countDueToday = lastCountDate!==TODAY;

  const forecasts = useMemo(()=>{
    const m={};
    ingredients.forEach(ing=>{
      const lead=(VENDOR_META[ing.vendor]||{}).leadTimeDays??2;
      m[ing.id]=computeForecast(ing,recipes,sales,targetDays,lead);
    });
    return m;
  },[ingredients,recipes,sales,targetDays]);

  const orderDraft = useMemo(()=>{
    const byV={};
    ingredients.forEach(ing=>{
      if(!ing.vendor) return;
      const fc=forecasts[ing.id];
      if(!fc||fc.recommendedQty<=0) return;
      if(!byV[ing.vendor]) byV[ing.vendor]={vendor:ing.vendor,items:[],anyDue:false};
      byV[ing.vendor].items.push({...ing,...fc});
      if(fc.orderDue) byV[ing.vendor].anyDue=true;
    });
    return Object.values(byV).sort((a,b)=>b.anyDue-a.anyDue);
  },[ingredients,forecasts]);

  const stockoutRisk = useMemo(()=>ingredients.filter(ing=>{
    const fc=forecasts[ing.id]; if(!fc||fc.daysLeft===Infinity) return false;
    return fc.daysLeft<=(((VENDOR_META[ing.vendor]||{}).leadTimeDays??2)+1);
  }),[ingredients,forecasts]);

  // Item popularity from sales history
  const itemPopularity = useMemo(()=>{
    const counts={};
    sales.filter(s=>s.status==="processed").forEach(s=>{counts[s.item]=(counts[s.item]||0)+s.qty;});
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  },[sales]);

  // ── Autopilot suggestions ────────────────────────────────────────────────────
  const suggestions = useMemo(()=>{
    const s=[];
    const dueVendors=orderDraft.filter(v=>v.anyDue);
    if(dueVendors.length>0) s.push({icon:"📦",text:`Send ${dueVendors.length} purchase order${dueVendors.length>1?"s":""} — ${dueVendors.map(v=>v.vendor).join(", ")}`,tab:"orders"});
    if(expiredLots.length>0) s.push({icon:"🗑",text:`Log waste for ${expiredLots.length} expired lot${expiredLots.length>1?"s":""}`,tab:"inventory"});
    if(expiringLots.length>0) s.push({icon:"⚡",text:`Use up expiring stock today (${[...new Set(expiringLots.map(l=>ingredients.find(i=>i.id===l.ingredientId)?.name))].join(", ")})`,tab:"inventory"});
    if(!menuPhotoUploaded) s.push({icon:"📸",text:"Upload your menu photo so AI can auto-generate draft recipes",tab:"recipes"});
    if(draftRecipes.length>0) s.push({icon:"📋",text:`Verify ${draftRecipes.map(r=>r.name).join(", ")} — unverified recipes skip inventory tracking`,tab:"recipes"});
    if(countDueToday) s.push({icon:"🔢",text:"Daily inventory count not done yet — takes ~5 minutes",tab:"inventory"});
    if(connectedPOS.length===0) s.push({icon:"🔌",text:"No POS connected — link Square, Toast or Clover to auto-sync sales",tab:"sales"});
    return s.slice(0,5);
  },[orderDraft,expiredLots,expiringLots,menuPhotoUploaded,draftRecipes,countDueToday,connectedPOS,ingredients]);

  // ── FIFO/FEFO ────────────────────────────────────────────────────────────────
  const depleteLots = useCallback((ingId,qty)=>{
    const ing=ingredients.find(i=>i.id===ingId);
    setLots(prev=>depleteOrdered(prev,ingId,qty,fefo,ing?.isPerishable));
  },[ingredients,fefo]);

  // ── Record sale ──────────────────────────────────────────────────────────────
  const processSale = useCallback((itemName,qty,source="Manual")=>{
    const recipe=recipes.find(r=>r.name.toLowerCase()===itemName.toLowerCase());
    let status="flagged",reason=null;
    if(!recipe) reason="Menu item not found";
    else if(recipe.status!=="verified") reason="Recipe not verified";
    if(!reason&&recipe){
      status="processed";
      setIngredients(prev=>{
        const copy=prev.map(i=>({...i}));
        recipe.ingredients.forEach(ri=>{
          if(!ri.ingredientId) return;
          const idx=copy.findIndex(i=>i.id===ri.ingredientId); if(idx<0) return;
          let d=ri.qty*qty;
          if(ri.unit!==copy[idx].unit){ const c=convertUnit(ri.qty*qty,ri.unit,copy[idx].unit); if(c===null) return; d=c; }
          copy[idx].current=Math.max(0,fmtN(copy[idx].current-d));
        });
        return copy;
      });
      recipe.ingredients.forEach(ri=>{ if(!ri.ingredientId) return; const ing=ingredients.find(i=>i.id===ri.ingredientId); if(!ing) return; let d=ri.qty*qty; if(ri.unit!==ing.unit){ const c=convertUnit(ri.qty*qty,ri.unit,ing.unit); if(c!==null) d=c; else return; } depleteLots(ri.ingredientId,d); });
    }
    setSales(prev=>[{id:nextSaleId.current++,item:itemName,qty,time:"just now",status,reason,source},...prev]);
    return {status,reason,txn:recipe?.ingredients?.length??0};
  },[recipes,ingredients,depleteLots]);

  const doRecordSale = ()=>{
    if(!saleForm.item.trim()) return;
    clearTimeout(saleTimer.current);
    const r=processSale(saleForm.item,parseInt(saleForm.qty)||1);
    setSaleResult(r);
    saleTimer.current=setTimeout(()=>setSaleResult(null),4000);
    if(r.status==="processed") showToast(`${saleForm.item} ×${saleForm.qty} — ${r.txn} ingredient${r.txn!==1?"s":""} deducted`);
  };

  // ── CSV import ──────────────────────────────────────────────────────────────
  const importCSV = ()=>{
    const rows=parseSalesCSV(csvText);
    if(!rows.length){ setCsvResult({err:"No valid rows. Format: item name,quantity"}); return; }
    let p=0,f=0;
    rows.forEach(({item,qty})=>{ const r=processSale(item,qty,"CSV"); if(r.status==="processed")p++; else f++; });
    setCsvResult({processed:p,flagged:f,total:rows.length});
    setCsvText("");
    showToast(`CSV: ${p} processed, ${f} flagged`);
  };

  // ── Verify recipe ────────────────────────────────────────────────────────────
  const verifyRecipe = useCallback((id)=>{
    const r=recipes.find(x=>x.id===id);
    setRecipes(prev=>prev.map(x=>x.id===id?{...x,status:"verified",verifiedBy:"Marco",verifiedDate:"Today"}:x));
    showToast(`"${r?.name}" verified`);
    setSelectedRId(null);
  },[recipes,showToast]);

  // ── Cycle count ──────────────────────────────────────────────────────────────
  const startCount = ()=>{ setCycleItems(buildCycleList(ingredients,lots,calibData)); setCycleSubmitted(false); setIngSubTab("count"); };

  const submitCount = ()=>{
    if(!cycleItems) return;
    const withD=cycleItems.map(item=>({...item,diff:item.counted!=null&&item.counted!==""?fmtN(parseFloat(item.counted)-item.systemQty):0}));
    setIngredients(prev=>{ const copy=prev.map(i=>({...i})); withD.forEach(item=>{ if(!item.diff) return; const idx=copy.findIndex(i=>i.id===item.ingredientId); if(idx>=0) copy[idx].current=fmtN(Math.max(0,copy[idx].current+item.diff)); }); return copy; });
    let newLots=[...lots];
    withD.forEach(item=>{
      if(!item.diff) return;
      const ing=ingredients.find(i=>i.id===item.ingredientId);
      if(item.diff<0) newLots=depleteOrdered(newLots,item.ingredientId,Math.abs(item.diff),fefo,ing?.isPerishable);
      else newLots=[...newLots,{id:`ADJ${nextLotId.current++}`,ingredientId:item.ingredientId,lotLabel:"Adj",receivedAt:now,expiresAt:ing?.isPerishable&&ing?.shelfLifeDays?addDays(now,ing.shelfLifeDays):null,quantityReceived:item.diff,quantityRemaining:item.diff,source:"Cycle Count"}];
    });
    setLots(newLots);
    setCycleSubmitted(true);
    setLastCountDate(TODAY);
    showToast(`Count submitted — ${withD.filter(i=>i.diff&&i.diff!==0).length} variance(s) reconciled`);
  };

  // ── Waste log ────────────────────────────────────────────────────────────────
  const logWaste = (lot)=>{ setIngredients(prev=>prev.map(i=>i.id===lot.ingredientId?{...i,current:Math.max(0,fmtN(i.current-lot.quantityRemaining))}:i)); setLots(prev=>prev.map(l=>l.id===lot.id?{...l,quantityRemaining:0}:l)); showToast("Waste logged"); };

  // ── PO mailto ─────────────────────────────────────────────────────────────────
  const buildMailto = (ve)=>{
    const vm=VENDOR_META[ve.vendor]||{}; if(!vm.email) return null;
    const lines=ve.items.map(i=>`  - ${i.name}: ${i.recommendedQty} ${i.unit}`).join("\n");
    const sub=encodeURIComponent(`Purchase Order — ${fmtDate(now)}`);
    const body=encodeURIComponent(`Hi ${ve.vendor},\n\nPlease process this order:\n\n${lines}\n\nDelivery needed by: ${addDays(now,(vm.leadTimeDays??2)+1).toLocaleDateString()}\n\nThanks, Marco`);
    return `mailto:${vm.email}?subject=${sub}&body=${body}`;
  };

  // ── Calibration ───────────────────────────────────────────────────────────────
  const applyCalib = (ingId,factor)=>{ setIngredients(prev=>prev.map(i=>i.id===ingId?{...i,calibFactor:factor}:i)); setCalibData(prev=>prev.map(c=>c.ingredientId===ingId?{...c,applied:true}:c)); showToast("Calibration factor applied to forecast"); };

  // ── Lots for ingredient ───────────────────────────────────────────────────────
  const ingLots = (ingId)=>lots.filter(l=>l.ingredientId===ingId&&l.quantityRemaining>0).sort((a,b)=>fefo&&INIT_INGREDIENTS.find(i=>i.id===ingId)?.isPerishable&&a.expiresAt&&b.expiresAt?new Date(a.expiresAt)-new Date(b.expiresAt):new Date(a.receivedAt)-new Date(b.receivedAt));

  const selectedRecipe=recipes.find(r=>r.id===selectedRId);
  const computedCycle=cycleItems||buildCycleList(ingredients,lots,calibData);

  // ─── CSS ──────────────────────────────────────────────────────────────────────
  const CSS=`
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{background:#f9fafb;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#111827;font-size:14px;line-height:1.5}
    ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:6px}
    @keyframes fadeUp{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
    .page{animation:fadeUp .22s ease both}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;text-align:left;padding:9px 14px;border-bottom:1px solid #f3f4f6;background:#fafafa;white-space:nowrap}
    td{padding:9px 14px;color:#374151;border-bottom:1px solid #f9fafb;vertical-align:middle}
    tbody tr:last-child td{border-bottom:none}
    tbody tr:hover td{background:#fafafa}
    .inp{font-family:inherit;font-size:13px;width:100%;padding:8px 11px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#111827;outline:none;transition:border-color .15s,box-shadow .15s}
    .inp:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
    .inp::placeholder{color:#9ca3af}
    textarea.inp{resize:vertical;font-family:'JetBrains Mono',monospace;font-size:12px}
    .sel{font-family:inherit;font-size:13px;padding:6px 9px;border:1px solid #d1d5db;border-radius:7px;background:#fff;color:#374151;outline:none}
    .nav-btn{background:none;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#6b7280;padding:7px 14px;border-radius:8px;transition:all .13s;white-space:nowrap;display:flex;align-items:center;gap:5px}
    .nav-btn:hover{color:#111827;background:#f3f4f6}
    .nav-btn.active{color:#1d4ed8;background:#eff6ff}
    .sub-tab{background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:#6b7280;padding:8px 4px;margin-right:20px;transition:all .13s}
    .sub-tab:hover{color:#111827}
    .sub-tab.active{color:#1d4ed8;border-bottom-color:#1d4ed8}
  `;

  const NAV = [
    {id:"dashboard", label:"Dashboard"},
    {id:"inventory", label:"Inventory",  badge:lowItems.length||countDueToday?lowItems.length+(countDueToday?1:0):null},
    {id:"orders",    label:"Orders",     badge:orderDraft.filter(v=>v.anyDue).length||null},
    {id:"sales",     label:"Sales",      badge:flaggedSales.length||null},
    {id:"recipes",   label:"Recipes",    badge:draftRecipes.length||!menuPhotoUploaded?draftRecipes.length+(!menuPhotoUploaded?1:0):null},
    {id:"costs",     label:"Costs"},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#f9fafb"}}>
      <style>{CSS}</style>

      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <nav style={{position:"sticky",top:0,zIndex:50,background:"rgba(255,255,255,.96)",backdropFilter:"blur(8px)",borderBottom:"1px solid #e5e7eb",boxShadow:"0 1px 3px rgba(0,0,0,.04)"}}>
        <div style={{maxWidth:1300,margin:"0 auto",padding:"0 18px",display:"flex",alignItems:"center",height:52,gap:2}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginRight:20,flexShrink:0}}>
            <div style={{width:30,height:30,background:"#1d4ed8",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>🍽</div>
            <span style={{fontWeight:800,fontSize:15,color:"#111827",letterSpacing:"-.02em"}}>Mise en Place</span>
          </div>
          <div style={{display:"flex",gap:1,flex:1,overflowX:"auto"}}>
            {NAV.map(n=>(
              <button key={n.id} className={`nav-btn${tab===n.id?" active":""}`} onClick={()=>setTab(n.id)}>
                {n.label}
                {n.badge?<span style={{minWidth:16,height:16,background:tab===n.id?"#bfdbfe":"#fee2e2",color:tab===n.id?"#1e40af":"#b91c1c",borderRadius:8,fontSize:10,fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"0 4px"}}>{n.badge}</span>:null}
              </button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:10,flexShrink:0}}>
            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#6b7280",cursor:"pointer",userSelect:"none"}}>
              <input type="checkbox" checked={fefo} onChange={e=>setFefo(e.target.checked)}/>FEFO
            </label>
            <div style={{width:30,height:30,background:"#1d4ed8",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:12,color:"#fff"}}>M</div>
          </div>
        </div>
      </nav>

      <div style={{maxWidth:1300,margin:"0 auto",padding:"22px 18px"}}>

        {/* ══════════════════════════════════════════════ DASHBOARD */}
        {tab==="dashboard" && (
          <div className="page">
            <SectionHead title="Good morning, Marco 👋" sub={`${fmtDate(now)} · ${fefo?"FEFO":"FIFO"} lot mode`}/>

            {/* 3 action cards */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:16}}>
              <Card style={{padding:"16px 18px",cursor:"pointer",background:orderDraft.filter(v=>v.anyDue).length?"#eff6ff":"#fff",borderColor:orderDraft.filter(v=>v.anyDue).length?"#bfdbfe":"#e5e7eb"}} onClick={()=>setTab("orders")}>
                <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#9ca3af",marginBottom:8}}>📦 Orders Due</div>
                <div style={{fontSize:38,fontWeight:800,lineHeight:1,color:orderDraft.filter(v=>v.anyDue).length?"#1d4ed8":"#d1d5db",marginBottom:4}}>{orderDraft.filter(v=>v.anyDue).length}</div>
                <div style={{fontSize:12,color:"#6b7280"}}>vendor order{orderDraft.filter(v=>v.anyDue).length!==1?"s":""} due today</div>
              </Card>
              <Card style={{padding:"16px 18px",cursor:"pointer",background:stockoutRisk.length?"#fef2f2":"#fff",borderColor:stockoutRisk.length?"#fca5a5":"#e5e7eb"}} onClick={()=>setTab("orders")}>
                <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#9ca3af",marginBottom:8}}>⚠ Stockout Risk</div>
                <div style={{fontSize:38,fontWeight:800,lineHeight:1,color:stockoutRisk.length?"#dc2626":"#d1d5db",marginBottom:4}}>{stockoutRisk.length}</div>
                <div style={{fontSize:12,color:"#6b7280"}}>{stockoutRisk.length?stockoutRisk.map(i=>i.name).join(", "):"All good"}</div>
              </Card>
              <Card style={{padding:"16px 18px",cursor:"pointer",background:(expiredLots.length+expiringLots.length)?"#fff7ed":"#fff",borderColor:(expiredLots.length+expiringLots.length)?"#fed7aa":"#e5e7eb"}} onClick={()=>setTab("inventory")}>
                <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#9ca3af",marginBottom:8}}>🧊 Freshness Alerts</div>
                <div style={{fontSize:38,fontWeight:800,lineHeight:1,color:(expiredLots.length+expiringLots.length)?"#c2410c":"#d1d5db",marginBottom:4}}>{expiredLots.length+expiringLots.length}</div>
                <div style={{fontSize:12,color:"#6b7280"}}>{expiredLots.length} expired · {expiringLots.length} expiring soon</div>
              </Card>
            </div>

            {/* Autopilot */}
            <Card style={{padding:"16px 18px",marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                🤖 Today's Action List
                <Tag v="blue">{suggestions.length}</Tag>
              </div>
              {suggestions.length===0
                ? <div style={{fontSize:13,color:"#9ca3af"}}>✓ Nothing urgent — restaurant is running smoothly</div>
                : <div style={{display:"grid",gap:7}}>
                    {suggestions.map((s,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"flex-start",gap:9,padding:"9px 11px",background:"#f9fafb",borderRadius:8,border:"1px solid #f3f4f6",cursor:"pointer"}} onClick={()=>setTab(s.tab)}>
                        <span style={{fontSize:15,flexShrink:0}}>{s.icon}</span>
                        <span style={{fontSize:13,color:"#374151",flex:1,lineHeight:1.4}}>{s.text}</span>
                        <span style={{color:"#9ca3af",fontSize:12}}>→</span>
                      </div>
                    ))}
                  </div>}
            </Card>

            {/* Unit mismatches */}
            {mismatches.length>0&&(
              <Card style={{padding:"14px 18px",background:"#fffbeb",borderColor:"#fde68a"}}>
                <div style={{fontWeight:700,fontSize:13,color:"#92400e",marginBottom:7}}>⚠ {mismatches.length} unit mismatch{mismatches.length>1?"es":""} — these ingredients are excluded from depletion</div>
                {mismatches.map((m,i)=><div key={i} style={{fontSize:12,color:"#78350f",marginBottom:2}}><strong>{m.recipe}</strong> uses {m.ingredient} in <Mono>{m.recipeUnit}</Mono> but stock is tracked in <Mono>{m.ingredientUnit}</Mono></div>)}
              </Card>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════ INVENTORY */}
        {tab==="inventory" && (
          <div className="page">
            <SectionHead title="Inventory"
              sub={`${ingredients.length} ingredients · ${lowItems.length} low · ${fefo?"FEFO":"FIFO"}`}
              action={
                <div style={{display:"flex",gap:8}}>
                  {ingSubTab==="list"&&!cycleSubmitted&&<Btn v="ghost" onClick={startCount}>🔢 Update Inventory (Daily Count)</Btn>}
                  <Btn v="primary">+ Add Ingredient</Btn>
                </div>
              }/>

            {/* Sub-tabs */}
            <div style={{borderBottom:"1px solid #e5e7eb",marginBottom:16}}>
              <button className={`sub-tab${ingSubTab==="list"?" active":""}`} onClick={()=>setIngSubTab("list")}>Stock List</button>
              <button className={`sub-tab${ingSubTab==="count"?" active":""}`} onClick={()=>{ if(!cycleItems) startCount(); else setIngSubTab("count"); }}>
                Daily Count
                {countDueToday&&<Tag v="red" style={{marginLeft:5}}>Due</Tag>}
                {cycleSubmitted&&<Tag v="green" style={{marginLeft:5}}>Done ✓</Tag>}
              </button>
            </div>

            {/* STOCK LIST */}
            {ingSubTab==="list"&&(
              <>
                {lowItems.length>0&&(
                  <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:9,padding:"9px 14px",marginBottom:12,fontSize:13,color:"#b91c1c",display:"flex",gap:7}}>
                    🚨 <strong>{lowItems.map(i=>i.name).join(", ")}</strong> below reorder threshold
                  </div>
                )}
                {expiredLots.length>0&&(
                  <div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:9,padding:"9px 14px",marginBottom:12,fontSize:13,color:"#b91c1c",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span>❌ {expiredLots.length} expired lot{expiredLots.length>1?"s":""} — log waste to remove from inventory</span>
                    <div style={{display:"flex",gap:6}}>
                      {expiredLots.map(lot=>{
                        const ing=ingredients.find(i=>i.id===lot.ingredientId);
                        return <Btn key={lot.id} v="danger" sm onClick={()=>logWaste(lot)}>Log {ing?.name} waste</Btn>;
                      })}
                    </div>
                  </div>
                )}

                <Card style={{overflow:"hidden"}}>
                  <table>
                    <thead><tr><th>Ingredient</th><th>Storage</th><th>Stock</th><th>Freshness</th><th>Forecast</th><th>Calib.</th><th>Lots</th><th></th></tr></thead>
                    <tbody>
                      {ingredients.map(ing=>{
                        const fc=forecasts[ing.id];
                        const iLots=ingLots(ing.id);
                        const worstLot=iLots.find(l=>l.expiresAt&&diffDays(new Date(l.expiresAt),now)<=2);
                        const expLot=iLots.find(l=>l.expiresAt&&diffDays(new Date(l.expiresAt),now)<0);
                        return (
                          <tr key={ing.id} style={{background:ing.current<=ing.threshold?"#fef2f210":"inherit"}}>
                            <td>
                              <div style={{fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
                                {ing.name}
                                {ing.isPerishable&&<span title="Perishable" style={{fontSize:11}}>🌿</span>}
                              </div>
                              {ing.shelfLifeDays&&<div style={{fontSize:11,color:"#9ca3af"}}>{ing.shelfLifeDays}d shelf life</div>}
                            </td>
                            <td><Tag v={ing.storageType==="fridge"?"blue":ing.storageType==="freezer"?"purple":"gray"}>{ing.storageType==="fridge"?"❄️ Fridge":ing.storageType==="freezer"?"🧊 Freezer":"🏠 Room"}</Tag></td>
                            <td>
                              <div style={{fontWeight:600,color:ing.current<=ing.threshold?"#dc2626":"#111827",fontFamily:"'JetBrains Mono',monospace"}}>{fmtN(ing.current)} {ing.unit}</div>
                              <StockBar current={ing.current} threshold={ing.threshold}/>
                            </td>
                            <td>
                              {!ing.isPerishable
                                ? <span style={{fontSize:12,color:"#d1d5db"}}>N/A</span>
                                : expLot ? <Tag v="red">Lot expired</Tag>
                                : worstLot ? <FreshBadge lot={worstLot}/>
                                : iLots.length>0 ? <Tag v="green">All good</Tag>
                                : <span style={{fontSize:12,color:"#d1d5db"}}>No lots</span>}
                            </td>
                            <td style={{minWidth:110}}>
                              {fc.daysLeft!==Infinity
                                ? <div>
                                    <Tag v={fc.daysLeft<=2?"red":fc.daysLeft<=5?"yellow":"green"}>{Math.round(fc.daysLeft)}d left</Tag>
                                    {fc.stockoutDate&&<div style={{fontSize:11,color:"#9ca3af",marginTop:3}}>Stockout {fmtDate(fc.stockoutDate)}</div>}
                                  </div>
                                : <span style={{fontSize:12,color:"#d1d5db"}}>—</span>}
                            </td>
                            <td>
                              <span style={{fontSize:11,fontWeight:700,color:ing.calibFactor>1.1?"#dc2626":ing.calibFactor<0.9?"#b45309":"#16a34a",background:ing.calibFactor>1.1?"#fef2f2":ing.calibFactor<0.9?"#fffbeb":"#f0fdf4",borderRadius:5,padding:"2px 7px"}}>{ing.calibFactor.toFixed(2)}×</span>
                            </td>
                            <td>
                              {iLots.length>0
                                ? <button onClick={()=>setLotsModal(ing)} style={{background:"none",border:"1px solid #d1d5db",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11,color:"#374151",fontFamily:"inherit"}}>{iLots.length} lot{iLots.length!==1?"s":""}</button>
                                : <span style={{fontSize:12,color:"#d1d5db"}}>—</span>}
                            </td>
                            <td>
                              <div style={{display:"flex",gap:5}}>
                                {ing.vendor&&<Btn v="ghost" sm onClick={()=>setReorderModal(ing)}>Reorder</Btn>}
                                <Btn v="subtle" sm>Edit</Btn>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              </>
            )}

            {/* DAILY COUNT */}
            {ingSubTab==="count"&&(
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:14}}>
                  <Card style={{overflow:"hidden"}}>
                    <div style={{padding:"11px 14px",borderBottom:"1px solid #f3f4f6",background:"#f9fafb",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:13,color:"#6b7280"}}>Exception items: low stock + high variance + expiring + high value</span>
                      <div style={{display:"flex",gap:7}}>
                        <Btn v="ghost" sm onClick={startCount}>↻ Refresh</Btn>
                        {!cycleSubmitted&&<Btn v="primary" sm disabled={computedCycle.every(i=>i.counted===null)} onClick={submitCount}>Submit Count</Btn>}
                      </div>
                    </div>
                    {cycleSubmitted&&<div style={{padding:"10px 14px",background:"#f0fdf4",borderBottom:"1px solid #bbf7d0",fontSize:13,color:"#166534"}}>✓ Count submitted for {fmtDate(now)} — inventory reconciled</div>}
                    <table>
                      <thead><tr><th>Ingredient</th><th>Flags</th><th>System Qty</th><th>Physical Count</th><th>Δ</th><th>Reason</th></tr></thead>
                      <tbody>
                        {computedCycle.map((item,idx)=>{
                          const diff=item.counted!=null&&item.counted!==""?fmtN(parseFloat(item.counted)-item.systemQty):null;
                          const hasDiff=diff!==null&&diff!==0;
                          return (
                            <tr key={item.id} style={{background:hasDiff?"#fffbeb":"inherit"}}>
                              <td style={{fontWeight:600}}>{item.name}</td>
                              <td>
                                <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                                  {(item.tags||[]).map(t=><Tag key={t} v={t==="low-stock"?"red":t==="expiring"?"orange":t==="variance"?"yellow":"slate"}>{t==="low-stock"?"Low":t==="expiring"?"Expiring":t==="variance"?"Variance":"$"}</Tag>)}
                                </div>
                              </td>
                              <td><Mono>{fmtN(item.systemQty)}</Mono></td>
                              <td>
                                <input type="number" className="inp" style={{width:85,textAlign:"right",borderColor:hasDiff?"#fbbf24":"#d1d5db"}}
                                  placeholder="Count…" disabled={cycleSubmitted} value={item.counted??""} onChange={e=>setCycleItems(prev=>(prev||computedCycle).map((it,i)=>i===idx?{...it,counted:e.target.value===''?null:e.target.value}:it))}/>
                              </td>
                              <td>{diff!==null&&<span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:diff>0?"#16a34a":diff<0?"#dc2626":"#9ca3af"}}>{diff>0?"+":""}{diff}</span>}</td>
                              <td>
                                {hasDiff&&<select className="sel" style={{fontSize:12}} value={item.reason||""} disabled={cycleSubmitted} onChange={e=>setCycleItems(prev=>(prev||computedCycle).map((it,i)=>i===idx?{...it,reason:e.target.value}:it))}>
                                  <option value="">Reason…</option>
                                  {DISCREPANCY_REASONS.map(r=><option key={r}>{r}</option>)}
                                </select>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Card>

                  <div style={{display:"grid",gap:10,alignContent:"start"}}>
                    <Card style={{padding:"14px"}}>
                      <div style={{fontWeight:700,fontSize:14,marginBottom:9}}>Variances</div>
                      {computedCycle.filter(i=>i.counted!=null&&i.counted!=="").length===0
                        ? <div style={{fontSize:12,color:"#9ca3af"}}>Enter counts to see variances</div>
                        : computedCycle.map(item=>{
                            const d=item.counted!=null&&item.counted!==""?fmtN(parseFloat(item.counted)-item.systemQty):null;
                            if(d===null||d===0) return null;
                            return <div key={item.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #f3f4f6"}}>
                              <span style={{fontSize:13,fontWeight:500}}>{item.name}</span>
                              <Mono color={d>0?"#16a34a":"#dc2626"}>{d>0?"+":""}{d} {item.unit}</Mono>
                            </div>;
                          })}
                    </Card>
                    <Card style={{padding:"14px",background:"#f0fdf4",borderColor:"#bbf7d0"}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#166534",marginBottom:7}}>What happens on submit</div>
                      <ul style={{fontSize:12,color:"#166534",lineHeight:1.8,paddingLeft:15}}>
                        <li>Inventory totals updated</li>
                        <li>Lots reconciled ({fefo?"FEFO":"FIFO"})</li>
                        <li>Synthetic lot added for increases</li>
                        <li>Variances feed calibration</li>
                      </ul>
                    </Card>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════ ORDERS + VENDORS */}
        {tab==="orders" && (
          <div className="page">
            {/* Sub-tabs */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:0}}>
              <div>
                <h1 style={{fontSize:20,fontWeight:700,color:"#111827",margin:0}}>{orderSubTab==="orders"?"Order Draft":"Vendors"}</h1>
                <p style={{fontSize:13,color:"#6b7280",margin:"3px 0 0"}}>{orderSubTab==="orders"?"Auto-generated purchase orders · "+targetDays+"-day stock target":"Supplier contacts and delivery settings"}</p>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                {orderSubTab==="orders"&&(
                  <label style={{fontSize:13,color:"#6b7280",display:"flex",alignItems:"center",gap:6}}>
                    Stock target:
                    <input type="number" className="inp" min={1} max={30} value={targetDays} onChange={e=>setTargetDays(Number(e.target.value)||7)} style={{width:55,textAlign:"center",padding:"5px 8px"}}/>
                    days
                  </label>
                )}
              </div>
            </div>
            <div style={{borderBottom:"1px solid #e5e7eb",marginBottom:16,marginTop:12}}>
              <button className={`sub-tab${orderSubTab==="orders"?" active":""}`} onClick={()=>setOrderSubTab("orders")}>
                Purchase Orders
                {orderDraft.filter(v=>v.anyDue).length>0&&<Tag v="red" style={{marginLeft:5}}>{orderDraft.filter(v=>v.anyDue).length} due</Tag>}
              </button>
              <button className={`sub-tab${orderSubTab==="vendors"?" active":""}`} onClick={()=>setOrderSubTab("vendors")}>Vendors</button>
            </div>

            {/* ORDERS */}
            {orderSubTab==="orders"&&(
              orderDraft.length===0
                ? <Card style={{padding:"40px",textAlign:"center",color:"#9ca3af"}}><div style={{fontSize:30,marginBottom:8}}>✅</div><div style={{fontSize:15,fontWeight:600}}>All vendors stocked</div><div style={{fontSize:13,marginTop:4}}>No orders needed at current usage for {targetDays} days</div></Card>
                : <div style={{display:"grid",gap:13}}>
                    {orderDraft.map(ve=>{
                      const vm=VENDOR_META[ve.vendor]||{};
                      const mailto=buildMailto(ve);
                      return (
                        <Card key={ve.vendor} style={{overflow:"hidden",borderColor:ve.anyDue?"#bfdbfe":"#e5e7eb"}}>
                          <div style={{padding:"12px 16px",borderBottom:"1px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center",background:ve.anyDue?"#eff6ff":"#fafafa"}}>
                            <div>
                              <div style={{fontWeight:700,fontSize:14,display:"flex",alignItems:"center",gap:8}}>
                                {ve.vendor}
                                {ve.anyDue&&<Tag v="red">Due today</Tag>}
                              </div>
                              <div style={{fontSize:11,color:"#9ca3af",marginTop:2}}>{vm.email||"No email"} · Lead time {vm.leadTimeDays??2}d · {vm.notes||""}</div>
                            </div>
                            {mailto
                              ? <a href={mailto} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}><Btn v="primary">📧 Send PO Email</Btn></a>
                              : <Btn v="ghost" disabled title="No email on file">No email on file</Btn>}
                          </div>
                          <table>
                            <thead><tr><th>Ingredient</th><th>Current</th><th>Daily Use</th><th>Days Left</th><th>Stockout</th><th>Order By</th><th>Order Qty</th></tr></thead>
                            <tbody>
                              {ve.items.map(item=>{
                                const fc=forecasts[item.id];
                                return (
                                  <tr key={item.id}>
                                    <td style={{fontWeight:600}}>{item.name}</td>
                                    <td><Mono color={item.current<=item.threshold?"#dc2626":undefined}>{fmtN(item.current)} {item.unit}</Mono></td>
                                    <td><Mono color="#9ca3af">{fc.adu>0?`${fmtN(fc.adu)}/d`:"—"}</Mono></td>
                                    <td><Tag v={fc.daysLeft<=(vm.leadTimeDays??2)?"red":fc.daysLeft<=5?"yellow":"green"}>{fc.daysLeft===Infinity?"∞":`${Math.round(fc.daysLeft)}d`}</Tag></td>
                                    <td style={{fontSize:12,color:"#6b7280"}}>{fc.stockoutDate?fmtDate(fc.stockoutDate):"—"}</td>
                                    <td>{fc.orderByDate?<Tag v={diffDays(fc.orderByDate,now)<=0?"red":"gray"}>{diffDays(fc.orderByDate,now)<=0?"Today!":fmtDate(fc.orderByDate)}</Tag>:<span style={{color:"#d1d5db",fontSize:12}}>—</span>}</td>
                                    <td><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:13}}>{fmtN(fc.recommendedQty)} {item.unit}</span></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </Card>
                      );
                    })}
                  </div>
            )}

            {/* VENDORS */}
            {orderSubTab==="vendors"&&(
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <div style={{fontSize:13,color:"#6b7280"}}>Manage supplier contacts, lead times, and delivery windows</div>
                  <div style={{display:"flex",gap:8}}>
                    <Btn v="ghost">💡 Find Recommended Vendors <Tag v="blue" style={{fontSize:10}}>Coming soon</Tag></Btn>
                    <Btn v="primary">+ Add Vendor</Btn>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:11}}>
                  {Object.entries(VENDOR_META).map(([name,vm])=>(
                    <Card key={name} style={{padding:"16px 18px"}}>
                      <div style={{fontWeight:700,fontSize:15,marginBottom:10}}>{name}</div>
                      <div style={{display:"grid",gap:6,marginBottom:12}}>
                        {vm.email&&<div style={{display:"flex",gap:6,alignItems:"center",fontSize:13}}>📧 <a href={`mailto:${vm.email}`} style={{color:"#1d4ed8",textDecoration:"none"}}>{vm.email}</a></div>}
                        {vm.phone&&<div style={{display:"flex",gap:6,alignItems:"center",fontSize:13,fontFamily:"'JetBrains Mono',monospace",color:"#374151"}}>📞 {vm.phone}</div>}
                        <div style={{display:"flex",gap:6,alignItems:"center",fontSize:12,color:"#6b7280"}}>⏱ {vm.leadTimeDays}d lead time</div>
                        {vm.notes&&<div style={{fontSize:12,color:"#6b7280",borderTop:"1px solid #f3f4f6",paddingTop:6,fontStyle:"italic"}}>{vm.notes}</div>}
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        {vm.email&&<a href={`mailto:${vm.email}`} style={{textDecoration:"none"}}><Btn v="ghost" sm>📧 Email</Btn></a>}
                        <Btn v="subtle" sm>Edit</Btn>
                      </div>
                    </Card>
                  ))}
                </div>
                <div style={{marginTop:20,padding:"14px 16px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:10,fontSize:12,color:"#9ca3af"}}>
                  💡 <strong style={{color:"#6b7280"}}>Recommended Vendors</strong> — coming soon. We'll suggest local suppliers based on your ingredients, order frequency, and pricing data.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════ SALES */}
        {tab==="sales" && (
          <div className="page">
            <SectionHead title="Sales" sub="Record sales, import CSV, or sync your POS"/>

            {/* Sub-tabs */}
            <div style={{borderBottom:"1px solid #e5e7eb",marginBottom:16}}>
              <button className={`sub-tab${salesSubTab==="record"?" active":""}`} onClick={()=>setSalesSubTab("record")}>Record</button>
              <button className={`sub-tab${salesSubTab==="history"?" active":""}`} onClick={()=>setSalesSubTab("history")}>
                History
                {flaggedSales.length>0&&<Tag v="yellow" style={{marginLeft:5}}>{flaggedSales.length} flagged</Tag>}
              </button>
              <button className={`sub-tab${salesSubTab==="pos"?" active":""}`} onClick={()=>setSalesSubTab("pos")}>
                POS Integration
                {connectedPOS.length>0?<Tag v="green" style={{marginLeft:5}}>Connected</Tag>:<Tag v="slate" style={{marginLeft:5}}>Not set up</Tag>}
              </button>
            </div>

            {/* RECORD */}
            {salesSubTab==="record"&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                {/* Manual */}
                <Card style={{padding:"18px"}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:13}}>Manual Entry</div>
                  <div style={{display:"grid",gap:10,marginBottom:12}}>
                    <div>
                      <label style={{display:"block",fontSize:11,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>Menu Item</label>
                      <input list="menu-dl" className="inp" placeholder="Type or select…" value={saleForm.item} onChange={e=>setSaleForm(f=>({...f,item:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doRecordSale()}/>
                      <datalist id="menu-dl">{recipes.map(r=><option key={r.id} value={r.name}/>)}</datalist>
                    </div>
                    <div>
                      <label style={{display:"block",fontSize:11,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>Qty</label>
                      <input type="number" min={1} className="inp" value={saleForm.qty} onChange={e=>setSaleForm(f=>({...f,qty:e.target.value}))}/>
                    </div>
                    <Btn v="primary" onClick={doRecordSale} style={{width:"100%",justifyContent:"center",padding:"9px"}}>Record Sale</Btn>
                  </div>
                  {saleResult&&(
                    <div style={{padding:"10px 12px",borderRadius:8,background:saleResult.status==="processed"?"#f0fdf4":"#fffbeb",border:`1px solid ${saleResult.status==="processed"?"#bbf7d0":"#fde68a"}`,color:saleResult.status==="processed"?"#166534":"#92400e",fontSize:13,animation:"fadeUp .18s ease"}}>
                      {saleResult.status==="processed"?`✓ ${saleResult.txn} ingredient${saleResult.txn!==1?"s":""} deducted (${fefo?"FEFO":"FIFO"})`:`⚠ Flagged: ${saleResult.reason}`}
                    </div>
                  )}
                </Card>

                {/* CSV */}
                <Card style={{padding:"18px"}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Import CSV</div>
                  <div style={{fontSize:12,color:"#9ca3af",marginBottom:10}}>One row per sale: <Mono>item name,quantity</Mono></div>
                  <div style={{background:"#f9fafb",borderRadius:7,padding:"7px 9px",fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"#9ca3af",marginBottom:10}}>Classic Burger,3{"\n"}Margherita Pizza,2</div>
                  <textarea className="inp" rows={4} placeholder={"Classic Burger,3\nMargherita Pizza,2"} value={csvText} onChange={e=>setCsvText(e.target.value)} style={{marginBottom:10}}/>
                  <Btn v="primary" disabled={!csvText.trim()} onClick={importCSV} style={{width:"100%",justifyContent:"center",padding:"9px"}}>Import</Btn>
                  {csvResult&&<div style={{marginTop:9,padding:"9px 12px",borderRadius:8,background:csvResult.err?"#fef2f2":"#f0fdf4",border:`1px solid ${csvResult.err?"#fca5a5":"#bbf7d0"}`,color:csvResult.err?"#b91c1c":"#166534",fontSize:13}}>{csvResult.err||`✓ ${csvResult.processed}/${csvResult.total} processed · ${csvResult.flagged} flagged`}</div>}
                </Card>

                {/* Expected sellers */}
                <Card style={{padding:"18px",gridColumn:"1/-1"}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
                    📈 Expected Top Sellers Today
                    <Tag v="blue">Based on sales history</Tag>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
                    {itemPopularity.slice(0,5).map(([item,total],rank)=>{
                      const maxQty=itemPopularity[0][1];
                      const pct=Math.round((total/maxQty)*100);
                      const r=recipes.find(re=>re.name===item);
                      return (
                        <div key={item} style={{padding:"12px 14px",background:"#f9fafb",borderRadius:10,border:"1px solid #e5e7eb"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                            <div style={{fontWeight:600,fontSize:13}}>{item}</div>
                            <span style={{fontSize:11,fontWeight:700,color:"#6b7280"}}>#{rank+1}</span>
                          </div>
                          <div style={{height:5,background:"#e5e7eb",borderRadius:999,overflow:"hidden",marginBottom:6}}>
                            <div style={{height:"100%",width:`${pct}%`,background:rank===0?"#1d4ed8":rank===1?"#3b82f6":"#93c5fd",borderRadius:999}}/>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
                            <span style={{color:"#6b7280"}}>{total} sold recently</span>
                            {r&&<Tag v={r.status==="verified"?"green":"yellow"}>{r.status==="verified"?"✓":"Draft"}</Tag>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            )}

            {/* HISTORY */}
            {salesSubTab==="history"&&(
              <Card style={{overflow:"hidden"}}>
                <div style={{padding:"12px 16px",borderBottom:"1px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:700,fontSize:14}}>Sale History</span>
                  <div style={{display:"flex",gap:6}}>
                    <Tag v="green">{sales.filter(s=>s.status==="processed").length} processed</Tag>
                    <Tag v="yellow">{flaggedSales.length} flagged</Tag>
                  </div>
                </div>
                <table><thead><tr><th>Item</th><th>Qty</th><th>Status</th><th>Source</th><th>Time</th></tr></thead>
                  <tbody>{sales.slice(0,15).map(s=>(
                    <tr key={s.id}>
                      <td style={{fontWeight:600}}>{s.item}</td>
                      <td><Mono>×{s.qty}</Mono></td>
                      <td>{s.status==="flagged"?<Tag v="yellow">⚠ {s.reason}</Tag>:<Tag v="green">✓ Processed</Tag>}</td>
                      <td><Tag v="slate">{s.source}</Tag></td>
                      <td style={{fontSize:12,color:"#9ca3af"}}>{s.time}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </Card>
            )}

            {/* POS INTEGRATION */}
            {salesSubTab==="pos"&&(
              <div>
                {connectedPOS.length>0&&(
                  <div style={{marginBottom:14}}>
                    {connectedPOS.map(pos=>{
                      const info=POS_SYSTEMS.find(p=>p.id===pos.id);
                      return (
                        <Card key={pos.id} style={{padding:"14px 18px",marginBottom:9,display:"flex",alignItems:"center",justifyContent:"space-between",borderColor:"#bbf7d0"}}>
                          <div style={{display:"flex",alignItems:"center",gap:12}}>
                            <div style={{width:36,height:36,background:info?.color+"22",border:`1px solid ${info?.color}44`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:info?.color,fontFamily:"monospace"}}>■</div>
                            <div>
                              <div style={{fontWeight:700,fontSize:14}}>{pos.name}</div>
                              <div style={{fontSize:12,color:"#16a34a",display:"flex",alignItems:"center",gap:4}}><span style={{width:5,height:5,background:"#16a34a",borderRadius:"50%",display:"inline-block"}}/>Syncing sales live</div>
                            </div>
                          </div>
                          <Btn v="danger" sm onClick={()=>{ setConnectedPOS(prev=>prev.filter(c=>c.id!==pos.id)); showToast(`${pos.name} disconnected`); }}>Disconnect</Btn>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {connectedPOS.length===0&&(
                  <Card style={{padding:"32px",textAlign:"center",marginBottom:14,background:"#f9fafb",borderStyle:"dashed",borderColor:"#d1d5db"}}>
                    <div style={{fontSize:32,marginBottom:10}}>🔌</div>
                    <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>No POS connected</div>
                    <div style={{fontSize:13,color:"#6b7280",marginBottom:16}}>Connect your point-of-sale system to automatically sync every sale into inventory tracking</div>
                    <Btn v="primary" onClick={()=>setPosModal(true)}>Connect a POS System</Btn>
                  </Card>
                )}

                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
                  {POS_SYSTEMS.map(pos=>{
                    const connected=connectedPOS.some(c=>c.id===pos.id);
                    return (
                      <Card key={pos.id} style={{padding:"14px 16px",opacity:connected?1:undefined}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                          <div style={{width:34,height:34,background:pos.color+"22",border:`1px solid ${pos.color}44`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:pos.color,fontFamily:"monospace"}}>■</div>
                          <div>
                            <div style={{fontWeight:700,fontSize:13}}>{pos.name}</div>
                            <div style={{fontSize:11,color:"#9ca3af"}}>{pos.desc}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:6}}>
                          {connected
                            ? <Tag v="green">✓ Connected</Tag>
                            : <Btn v="primary" sm onClick={()=>{ setPosSelected(pos); setPosSetupStep("configure"); setPosModal(true); }}>Connect</Btn>}
                          <button style={{background:"none",border:"none",color:"#3b82f6",cursor:"pointer",fontSize:12,fontWeight:600,padding:"4px 6px"}} onClick={()=>setHelpModal(pos.id)}>
                            ? Help
                          </button>
                        </div>
                      </Card>
                    );
                  })}
                </div>

                <Card style={{padding:"14px 18px",background:"#f9fafb"}}>
                  <div style={{fontWeight:600,fontSize:13,marginBottom:6}}>Manual API / Webhook</div>
                  <div style={{fontSize:12,color:"#9ca3af",marginBottom:8}}>Point any system to our endpoint</div>
                  <div style={{display:"flex",gap:8,alignItems:"center",background:"#fff",borderRadius:8,padding:"9px 12px",border:"1px solid #e5e7eb"}}>
                    <code style={{flex:1,fontSize:11,color:"#374151",fontFamily:"'JetBrains Mono',monospace"}}>POST https://yourdomain.com/api/sales</code>
                    <Btn v="subtle" sm onClick={()=>{ try{navigator.clipboard.writeText("https://yourdomain.com/api/sales");}catch(_){} showToast("Webhook URL copied"); }}>Copy</Btn>
                  </div>
                  <div style={{marginTop:8,fontSize:11,color:"#9ca3af",fontFamily:"'JetBrains Mono',monospace"}}>Headers: x-api-key · Body: {"{ menuItemName, quantity, timestamp }"}</div>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════ RECIPES */}
        {tab==="recipes" && (
          <div className="page">
            {!selectedRId ? (
              <>
                <SectionHead title="Recipes"
                  sub={`${recipes.filter(r=>r.status==="verified").length} verified · ${draftRecipes.length} draft`}
                  action={recipes.length>0?<Btn v="primary" onClick={()=>{ setMenuPhotoUploaded(false); setMenuPreviewUrl(null); setMenuScanState("idle"); setRecipes([]); setMenuUrlInput(""); }}>📸 Re-scan Menu</Btn>:null}/>

                <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}}
                  onChange={e=>{ if(e.target.files?.[0]) scanMenuPhoto(e.target.files[0]); e.target.value=""; }}/>

                {/* Sub-tabs — only show once recipes exist */}
                {recipes.length>0&&(
                  <div style={{borderBottom:"1px solid #e5e7eb",marginBottom:16}}>
                    <button className={`sub-tab${recipesSubTab==="list"?" active":""}`} onClick={()=>setRecipesSubTab("list")}>Recipe List</button>
                    <button className={`sub-tab${recipesSubTab==="calibration"?" active":""}`} onClick={()=>setRecipesSubTab("calibration")}>Calibration</button>
                  </div>
                )}

                {/* ── EMPTY STATE: no recipes yet ── */}
                {recipes.length===0&&menuScanState!=="scanning"&&(
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                    {/* Option 1: Photo upload */}
                    <Card style={{padding:"32px 24px",textAlign:"center",borderStyle:"dashed",borderColor:"#bfdbfe",background:"#f0f7ff",cursor:"pointer",transition:"border-color .15s"}}
                      onClick={()=>fileRef.current?.click()}
                      onMouseEnter={e=>e.currentTarget.style.borderColor="#3b82f6"}
                      onMouseLeave={e=>e.currentTarget.style.borderColor="#bfdbfe"}>
                      <div style={{fontSize:44,marginBottom:14}}>📸</div>
                      <div style={{fontWeight:800,fontSize:16,color:"#1e40af",marginBottom:8}}>Upload a photo</div>
                      <div style={{fontSize:13,color:"#3b82f6",marginBottom:20,lineHeight:1.5}}>
                        Take a photo of your printed menu, or upload any image of your menu
                      </div>
                      <Btn v="primary" style={{width:"100%",justifyContent:"center"}} onClick={e=>{e.stopPropagation();fileRef.current?.click();}}>
                        Choose Photo
                      </Btn>
                      <div style={{marginTop:10,fontSize:11,color:"#93c5fd"}}>JPG, PNG, HEIC · printed or handwritten</div>
                    </Card>

                    {/* Option 2: URL */}
                    <Card style={{padding:"32px 24px",textAlign:"center",borderStyle:"dashed",borderColor:"#d1fae5",background:"#f0fdf9"}}>
                      <div style={{fontSize:44,marginBottom:14}}>🔗</div>
                      <div style={{fontWeight:800,fontSize:16,color:"#065f46",marginBottom:8}}>Paste a menu link</div>
                      <div style={{fontSize:13,color:"#059669",marginBottom:20,lineHeight:1.5}}>
                        Link to your website, Yelp, Google, OpenTable, or any page with your menu
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        <input
                          className="inp"
                          placeholder="https://yourrestaurant.com/menu"
                          value={menuUrlInput}
                          onChange={e=>setMenuUrlInput(e.target.value)}
                          onKeyDown={e=>{ if(e.key==="Enter"&&menuUrlInput.trim()) scanMenuUrl(menuUrlInput.trim()); }}
                          onClick={e=>e.stopPropagation()}
                          style={{fontSize:13,textAlign:"left"}}
                        />
                        <Btn v="green" disabled={!menuUrlInput.trim()} style={{width:"100%",justifyContent:"center"}}
                          onClick={e=>{e.stopPropagation();if(menuUrlInput.trim()) scanMenuUrl(menuUrlInput.trim());}}>
                          Scan Menu URL
                        </Btn>
                      </div>
                      <div style={{marginTop:10,fontSize:11,color:"#6ee7b7"}}>Works with Yelp, Google, Squarespace, Toast, etc.</div>
                    </Card>
                  </div>
                )}

                {/* ── SCANNING STATE ── */}
                {menuScanState==="scanning"&&(
                  <Card style={{padding:"48px 32px",textAlign:"center"}}>
                    {menuPreviewUrl
                      ? <img src={menuPreviewUrl} alt="Menu" style={{width:"100%",maxWidth:320,height:200,objectFit:"cover",borderRadius:10,marginBottom:20,border:"1px solid #e5e7eb"}}/>
                      : <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 16px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,marginBottom:20,fontSize:13,color:"#166534",fontFamily:"monospace",wordBreak:"break-all",maxWidth:400}}>🔗 {menuUrlInput}</div>
                    }
                    <div style={{fontSize:36,marginBottom:12,animation:"blink 1.2s infinite"}}>🤖</div>
                    <div style={{fontWeight:700,fontSize:18,color:"#111827",marginBottom:6}}>AI is reading your menu…</div>
                    <div style={{fontSize:13,color:"#6b7280"}}>Identifying dishes and estimating ingredient quantities</div>
                    <div style={{marginTop:20,height:4,background:"#e5e7eb",borderRadius:999,overflow:"hidden",maxWidth:300,margin:"20px auto 0"}}>
                      <div style={{height:"100%",width:"60%",background:"#1d4ed8",borderRadius:999,animation:"scan 1.5s ease-in-out infinite"}}/>
                    </div>
                    <style>{`@keyframes scan{0%{width:10%}50%{width:90%}100%{width:10%}}`}</style>
                  </Card>
                )}

                {/* ── ERROR STATE ── */}
                {menuScanState==="error"&&recipes.length===0&&(
                  <Card style={{padding:"32px",textAlign:"center",borderColor:"#fca5a5",background:"#fef2f2"}}>
                    <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
                    <div style={{fontWeight:700,fontSize:16,color:"#b91c1c",marginBottom:6}}>Scan failed</div>
                    <div style={{fontSize:13,color:"#6b7280",marginBottom:20}}>The link may block automated access, or the page may load content dynamically. Try uploading a screenshot of the menu instead.</div>
                    <div style={{display:"flex",gap:8,justifyContent:"center"}}>
                      <Btn v="ghost" onClick={()=>{ setMenuScanState("idle"); setMenuUrlInput(""); }}>Try a different URL</Btn>
                      <Btn v="primary" onClick={()=>fileRef.current?.click()}>📸 Upload photo instead</Btn>
                    </div>
                  </Card>
                )}

                {/* ── RECIPE LIST ── */}
                {recipes.length>0&&recipesSubTab==="list"&&(
                  <>
                    {/* Scan success banner */}
                    {menuPhotoUploaded&&(
                      <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:9,marginBottom:14}}>
                        {menuPreviewUrl
                          ? <img src={menuPreviewUrl} alt="Menu" style={{width:40,height:40,objectFit:"cover",borderRadius:6,border:"1px solid #bbf7d0",flexShrink:0}}/>
                          : <div style={{width:40,height:40,borderRadius:6,background:"#dcfce7",border:"1px solid #bbf7d0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🔗</div>
                        }
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:"#166534"}}>✓ Menu scanned — {recipes.length} draft recipes created</div>
                          <div style={{fontSize:12,color:"#166534",opacity:.8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {menuPreviewUrl ? "Review each recipe below, link ingredients, then verify to activate tracking." : menuUrlInput}
                          </div>
                        </div>
                        <Btn v="ghost" sm onClick={()=>{ setMenuPhotoUploaded(false); setMenuPreviewUrl(null); setMenuScanState("idle"); setRecipes([]); setMenuUrlInput(""); }}>Clear & rescan</Btn>
                      </div>
                    )}

                    {/* Approval nudges for recipes selling often */}
                    {draftRecipes.filter(r=>(draftSaleCounts[r.name]||0)>=5).map(r=>(
                      <Card key={r.id} style={{padding:"12px 16px",marginBottom:10,background:"#fff7ed",borderColor:"#fed7aa",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                        <div>
                          <div style={{fontWeight:700,fontSize:13,color:"#c2410c",marginBottom:2}}>🔥 "{r.name}" has sold {draftSaleCounts[r.name]} times but recipe is unverified</div>
                          <div style={{fontSize:12,color:"#9a3412"}}>Inventory isn't being deducted. Verify now to start tracking.</div>
                        </div>
                        <Btn v="orange" sm onClick={()=>setSelectedRId(r.id)}>Verify →</Btn>
                      </Card>
                    ))}

                    {draftRecipes.length>0&&(
                      <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:9,padding:"9px 14px",marginBottom:12,fontSize:13,color:"#92400e",display:"flex",gap:7}}>
                        💡 <strong>{draftRecipes.length} unverified recipe{draftRecipes.length>1?"s":""}</strong> — verify so sales start tracking inventory. Until then, deductions are skipped.
                      </div>
                    )}

                    <div style={{display:"grid",gap:9}}>
                      {recipes.map(r=>(
                        <Card key={r.id} style={{padding:"14px 17px",cursor:"pointer",transition:"border-color .12s",borderColor:r.status==="draft"?"#fde68a":"#e5e7eb"}} onClick={()=>setSelectedRId(r.id)}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:14}}>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                                <span style={{fontWeight:700,fontSize:15}}>{r.name}</span>
                                {r.status==="verified"?<Tag v="green">✓ Verified</Tag>:<Tag v="yellow">Draft — needs verification</Tag>}
                              </div>
                              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                                {r.ingredients.map((ing,i)=>(
                                  <span key={i} style={{display:"inline-flex",alignItems:"center",gap:3,background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:6,padding:"2px 8px",fontSize:11,fontFamily:"'JetBrains Mono',monospace",color:"#374151"}}>
                                    {ing.name} {ing.qty}{ing.unit}
                                  </span>
                                ))}
                              </div>
                              {r.verifiedBy&&<div style={{marginTop:5,fontSize:11,color:"#9ca3af"}}>Verified by {r.verifiedBy} · {r.verifiedDate}</div>}
                            </div>
                            <Btn v={r.status==="draft"?"orange":"ghost"} sm onClick={e=>{e.stopPropagation();setSelectedRId(r.id);}}>{r.status==="draft"?"Review →":"Edit"}</Btn>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </>
                )}

                {/* CALIBRATION */}
                {recipes.length>0&&recipesSubTab==="calibration"&&(
                  <>
                    <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:9,padding:"9px 14px",marginBottom:14,fontSize:13,color:"#1d4ed8"}}>
                      ⚠ Calibration factors adjust forecasts only — recipes are never automatically changed.
                    </div>
                    <Card style={{overflow:"hidden"}}>
                      <table>
                        <thead><tr><th>Ingredient</th><th>Theoretical</th><th>Actual</th><th>Factor</th><th>Trend</th><th>Suggested Action</th><th></th></tr></thead>
                        <tbody>
                          {calibData.map(c=>{
                            const ing=ingredients.find(i=>i.id===c.ingredientId);
                            const dev=Math.abs(c.factor-1);
                            return (
                              <tr key={c.ingredientId}>
                                <td style={{fontWeight:600}}>{c.name}</td>
                                <td><Mono color="#9ca3af">{c.theoretical} {ing?.unit}</Mono></td>
                                <td><Mono>{c.actual} {ing?.unit}</Mono></td>
                                <td><span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,fontWeight:700,color:c.factor>1.1?"#dc2626":c.factor<0.9?"#b45309":"#16a34a"}}>{c.factor.toFixed(2)}×</span></td>
                                <td>
                                  {c.trend==="high"&&<Tag v="red">↑ Over {Math.round(dev*100)}%</Tag>}
                                  {c.trend==="low"&&<Tag v="yellow">↓ Under {Math.round(dev*100)}%</Tag>}
                                  {c.trend==="moderate"&&<Tag v="orange">~ {Math.round(dev*100)}% off</Tag>}
                                  {c.trend==="stable"&&<Tag v="green">✓ Stable</Tag>}
                                </td>
                                <td style={{fontSize:12,color:"#6b7280",maxWidth:200}}>{c.action||"No action needed"}</td>
                                <td>{dev>0.05&&!c.applied?<Btn v="ghost" sm onClick={()=>applyCalib(c.ingredientId,c.factor)}>Apply {c.factor.toFixed(2)}×</Btn>:c.applied?<Tag v="green">Applied</Tag>:null}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </Card>
                  </>
                )}
              </>
            ) : selectedRecipe && (
              /* RECIPE DETAIL */
              <>
                <button style={{background:"none",border:"none",color:"#6b7280",cursor:"pointer",fontSize:13,fontWeight:600,marginBottom:14,display:"flex",alignItems:"center",gap:4}} onClick={()=>setSelectedRId(null)}>← Back to Recipes</button>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                  <h1 style={{fontSize:21,fontWeight:800,color:"#111827"}}>{selectedRecipe.name}</h1>
                  {selectedRecipe.status==="verified"?<Tag v="green">✓ Verified — {fefo?"FEFO":"FIFO"} tracking active</Tag>:<Tag v="yellow">⚠ Draft — inventory not tracked</Tag>}
                </div>
                <Card style={{padding:"16px",marginBottom:12}}>
                  <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#9ca3af",marginBottom:11}}>Ingredients per serving — link to your stock</div>
                  <div style={{display:"grid",gap:7}}>
                    {selectedRecipe.ingredients.map((ing,i)=>{
                      const ingData=ingredients.find(x=>x.id===ing.ingredientId);
                      const mismatch=ingData&&ing.unit!==ingData.unit&&!unitsCompatible(ing.unit,ingData.unit);
                      return (
                        <div key={i} style={{display:"flex",alignItems:"center",gap:7,padding:"8px 11px",background:mismatch?"#fffbeb":"#f9fafb",borderRadius:8,border:`1px solid ${mismatch?"#fde68a":"#e5e7eb"}`}}>
                          <select className="sel" style={{flex:2,width:"auto"}}
                            value={ing.ingredientId||""}
                            onChange={e=>{
                              const ingId=parseInt(e.target.value)||null;
                              setRecipes(prev=>prev.map(r=>r.id===selectedRId?{...r,ingredients:r.ingredients.map((ri,idx)=>idx===i?{...ri,ingredientId:ingId}:ri)}:r));
                            }}>
                            <option value="">— {ing.name} (link to stock)</option>
                            {ingredients.map(mi=><option key={mi.id} value={mi.id}>{mi.name} ({mi.unit})</option>)}
                          </select>
                          <input className="inp" style={{width:70,textAlign:"right",padding:"8px 9px"}}
                            value={ing.qty} type="number"
                            onChange={e=>{
                              const qty=parseFloat(e.target.value)||0;
                              setRecipes(prev=>prev.map(r=>r.id===selectedRId?{...r,ingredients:r.ingredients.map((ri,idx)=>idx===i?{...ri,qty}:ri)}:r));
                            }}/>
                          <input className="inp" style={{width:60,padding:"8px 9px"}}
                            value={ing.unit}
                            onChange={e=>{
                              const unit=e.target.value;
                              setRecipes(prev=>prev.map(r=>r.id===selectedRId?{...r,ingredients:r.ingredients.map((ri,idx)=>idx===i?{...ri,unit}:ri)}:r));
                            }}/>
                          {mismatch&&<Tag v="yellow">unit mismatch</Tag>}
                          <button style={{background:"none",border:"1px solid #e5e7eb",borderRadius:6,color:"#9ca3af",cursor:"pointer",width:28,height:28,fontSize:14,flexShrink:0}}
                            onClick={()=>setRecipes(prev=>prev.map(r=>r.id===selectedRId?{...r,ingredients:r.ingredients.filter((_,idx)=>idx!==i)}:r))}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <button style={{marginTop:9,background:"none",border:"none",color:"#1d4ed8",cursor:"pointer",fontWeight:600,fontSize:13,display:"flex",alignItems:"center",gap:4}}
                    onClick={()=>setRecipes(prev=>prev.map(r=>r.id===selectedRId?{...r,ingredients:[...r.ingredients,{ingredientId:null,name:"New ingredient",qty:1,unit:"oz",conf:1.0}]}:r))}>
                    + Add Ingredient
                  </button>
                </Card>
                <div style={{display:"flex",gap:8}}>
                  <Btn v="ghost" onClick={()=>setSelectedRId(null)}>Save Draft</Btn>
                  {selectedRecipe.status!=="verified"
                    ?<Btn v="green" onClick={()=>verifyRecipe(selectedRecipe.id)}>✓ Verify — Activate Inventory Tracking</Btn>
                    :<Btn v="green" onClick={()=>verifyRecipe(selectedRecipe.id)}>✓ Re-verify</Btn>}
                </div>
                {selectedRecipe.status==="draft"&&<div style={{marginTop:10,padding:"9px 12px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,fontSize:12,color:"#92400e"}}>💡 Once verified, each sale of "{selectedRecipe.name}" depletes ingredients using {fefo?"FEFO":"FIFO"} lot logic.</div>}
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════ COSTS */}
        {tab==="costs" && (
          <div className="page">
            <SectionHead title="Cost Analytics" sub="Owner view — food cost, margins, and waste"/>
            {(()=>{
              const totalIngCost = ingredients.reduce((sum,ing)=>{
                return sum + ing.current*(ingCosts[ing.id]||0);
              },0);
              const recipeMargins = recipes.filter(r=>r.status==="verified").map(r=>{
                const cost = r.ingredients.reduce((s,ri)=>{
                  if(!ri.ingredientId) return s;
                  return s + ri.qty*(ingCosts[ri.ingredientId]||0);
                },0);
                const menuPrices={"Classic Burger":14.99,"Margherita Pizza":16.99};
                const price=menuPrices[r.name]||12.99;
                return {name:r.name, cost, price, margin:price-cost, pct:cost/price*100};
              });
              const avgFoodCostPct = recipeMargins.length>0 ? recipeMargins.reduce((s,r)=>s+r.pct,0)/recipeMargins.length : 0;
              return (
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
                    <Card style={{padding:"16px",background:avgFoodCostPct>35?"#fef2f2":"#f0fdf4",borderColor:avgFoodCostPct>35?"#fca5a5":"#bbf7d0"}}>
                      <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#9ca3af",marginBottom:6}}>🥩 Avg Food Cost %</div>
                      <div style={{fontSize:34,fontWeight:800,lineHeight:1,color:avgFoodCostPct>35?"#dc2626":"#16a34a",marginBottom:3}}>{avgFoodCostPct.toFixed(1)}%</div>
                      <div style={{fontSize:11,color:"#6b7280"}}>Target: under 30%</div>
                    </Card>
                    <Card style={{padding:"16px"}}>
                      <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#9ca3af",marginBottom:6}}>📦 Inventory Value</div>
                      <div style={{fontSize:34,fontWeight:800,lineHeight:1,color:"#111827",marginBottom:3}}>${totalIngCost.toFixed(0)}</div>
                      <div style={{fontSize:11,color:"#6b7280"}}>current on-hand stock</div>
                    </Card>
                    <Card style={{padding:"16px",background:"#fffbeb",borderColor:"#fde68a"}}>
                      <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"#9ca3af",marginBottom:6}}>🗑 Est. Waste Value</div>
                      <div style={{fontSize:34,fontWeight:800,lineHeight:1,color:"#b45309",marginBottom:3}}>$0</div>
                      <div style={{fontSize:11,color:"#6b7280"}}>from expired lots</div>
                    </Card>
                  </div>
                  <Card style={{overflow:"hidden",marginBottom:14}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid #f3f4f6",fontWeight:700,fontSize:14}}>Recipe Cost Breakdown</div>
                    {recipeMargins.length===0
                      ? <div style={{padding:"24px",textAlign:"center",color:"#9ca3af",fontSize:13}}>No verified recipes yet — verify recipes to see cost breakdown</div>
                      : <table>
                          <thead><tr><th>Recipe</th><th>Ingredient Cost</th><th>Menu Price</th><th>Food Cost %</th><th>Gross Margin</th></tr></thead>
                          <tbody>
                            {recipeMargins.map(r=>(
                              <tr key={r.name}>
                                <td style={{fontWeight:600}}>{r.name}</td>
                                <td><Mono>${r.cost.toFixed(2)}</Mono></td>
                                <td><Mono color="#16a34a">${r.price.toFixed(2)}</Mono></td>
                                <td>
                                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                                    <div style={{width:60,height:6,background:"#f3f4f6",borderRadius:999,overflow:"hidden"}}>
                                      <div style={{height:"100%",width:`${Math.min(100,r.pct)}%`,background:r.pct>35?"#ef4444":r.pct>30?"#f59e0b":"#22c55e",borderRadius:999}}/>
                                    </div>
                                    <span style={{fontWeight:700,fontSize:13,color:r.pct>35?"#dc2626":r.pct>30?"#b45309":"#16a34a"}}>{r.pct.toFixed(1)}%</span>
                                  </div>
                                </td>
                                <td><span style={{fontWeight:700,color:"#16a34a"}}>${r.margin.toFixed(2)}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>}
                  </Card>
                  <Card style={{overflow:"hidden"}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid #f3f4f6"}}>
                      <div style={{fontWeight:700,fontSize:14}}>Ingredient Unit Costs</div>
                      <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>Edit to keep margins accurate</div>
                    </div>
                    <table>
                      <thead><tr><th>Ingredient</th><th>Unit</th><th>Cost / Unit ($)</th><th>On Hand</th><th>Stock Value</th></tr></thead>
                      <tbody>
                        {ingredients.map(ing=>{
                          const costPer=ingCosts[ing.id]||0;
                          return (
                            <tr key={ing.id}>
                              <td style={{fontWeight:600}}>{ing.name}</td>
                              <td><Tag v="slate">{ing.unit}</Tag></td>
                              <td><input type="number" step="0.001" className="inp" style={{width:90,padding:"6px 9px",fontSize:13}} value={costPer} onChange={e=>setIngCosts(p=>({...p,[ing.id]:parseFloat(e.target.value)||0}))}/></td>
                              <td><Mono>{fmtN(ing.current)}</Mono></td>
                              <td><Mono color="#374151">${(ing.current*costPer).toFixed(2)}</Mono></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Card>
                </>
              );
            })()}
          </div>
        )}

      </div>

      {/* ══════════════════════════════════════════════ MODALS */}

      {/* Lots modal */}
      {lotsModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}} onClick={()=>setLotsModal(null)}>
          <Card style={{width:"100%",maxWidth:520,animation:"fadeUp .2s ease",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"13px 16px",borderBottom:"1px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontWeight:700,fontSize:14}}>{lotsModal.name} — Lots ({fefo?"FEFO":"FIFO"})</div>
              <button onClick={()=>setLotsModal(null)} style={{background:"none",border:"none",color:"#9ca3af",cursor:"pointer",fontSize:18}}>×</button>
            </div>
            <table><thead><tr><th>Lot</th><th>Received</th><th>Expires</th><th>Remaining</th><th>Status</th></tr></thead>
              <tbody>{ingLots(lotsModal.id).map(lot=>(
                <tr key={lot.id}>
                  <td><Mono color="#9ca3af">{lot.lotLabel}</Mono></td>
                  <td style={{fontSize:12}}>{fmtDate(lot.receivedAt)}</td>
                  <td style={{fontSize:12}}>{lot.expiresAt?fmtDate(lot.expiresAt):"—"}</td>
                  <td><Mono color={lot.quantityRemaining===0?"#d1d5db":"#111827"}>{fmtN(lot.quantityRemaining)} {lotsModal.unit}</Mono></td>
                  <td>{lot.expiresAt?<FreshBadge lot={lot}/>:<Tag v="gray">No expiry</Tag>}</td>
                </tr>
              ))}</tbody>
            </table>
            <div style={{padding:"10px 14px",borderTop:"1px solid #f3f4f6",background:"#f9fafb",fontSize:12,color:"#9ca3af"}}>{fefo?"🔄 FEFO: soonest-expiring lot depleted first":"🔄 FIFO: oldest-received lot depleted first"}</div>
          </Card>
        </div>
      )}

      {/* Reorder modal */}
      {reorderModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}} onClick={()=>setReorderModal(null)}>
          <Card style={{width:"100%",maxWidth:420,padding:"20px",animation:"fadeUp .2s ease"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontWeight:700,fontSize:16,marginBottom:3}}>Reorder: {reorderModal.name}</div>
            <div style={{fontSize:13,color:"#6b7280",marginBottom:13}}>via {reorderModal.vendor}</div>
            <pre style={{background:"#f9fafb",borderRadius:8,padding:"11px 13px",border:"1px solid #e5e7eb",fontSize:11,color:"#374151",fontFamily:"'JetBrains Mono',monospace",lineHeight:1.8,whiteSpace:"pre-wrap",marginBottom:14}}>
              {`Hi ${reorderModal.vendor},\n\nWe'd like to order:\n  • ${reorderModal.name}: ${reorderModal.reorder||reorderModal.threshold*2} ${reorderModal.unit}\n\nCurrent: ${fmtN(reorderModal.current)} ${reorderModal.unit}\nThreshold: ${reorderModal.threshold} ${reorderModal.unit}\n\nThanks, Marco`}
            </pre>
            <div style={{display:"flex",gap:7}}>
              {reorderModal.vendorEmail&&<a href={`mailto:${reorderModal.vendorEmail}`} style={{textDecoration:"none",flex:1}}><Btn v="primary" style={{width:"100%",justifyContent:"center"}}>📧 Email</Btn></a>}
              <Btn v="green" style={{flex:1,justifyContent:"center"}}>💬 SMS</Btn>
              <Btn v="ghost" onClick={()=>setReorderModal(null)}>Close</Btn>
            </div>
          </Card>
        </div>
      )}

      {/* POS connect modal */}
      {posModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16,backdropFilter:"blur(6px)"}} onClick={()=>setPosModal(false)}>
          <Card style={{width:"100%",maxWidth:500,animation:"fadeUp .22s ease",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontWeight:700,fontSize:16}}>{posSetupStep==="list"?"Connect POS System":posSetupStep==="configure"?`Connect ${posSelected?.name}`:"Connected!"}</div>
              <button onClick={()=>setPosModal(false)} style={{background:"none",border:"none",color:"#9ca3af",cursor:"pointer",fontSize:19}}>×</button>
            </div>
            <div style={{padding:"20px"}}>
              {posSetupStep==="list"&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
                  {POS_SYSTEMS.filter(p=>!connectedPOS.find(c=>c.id===p.id)).map(pos=>(
                    <button key={pos.id} onClick={()=>{ setPosSelected(pos); setPosSetupStep("configure"); }}
                      style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:11,padding:"13px",textAlign:"left",cursor:"pointer",transition:"all .13s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:6}}>
                        <div style={{width:32,height:32,background:pos.color+"22",border:`1px solid ${pos.color}44`,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:pos.color,fontFamily:"monospace"}}>■</div>
                        <div style={{fontWeight:700,fontSize:13}}>{pos.name}</div>
                      </div>
                      <div style={{fontSize:11,color:"#9ca3af"}}>{pos.desc}</div>
                    </button>
                  ))}
                </div>
              )}
              {posSetupStep==="configure"&&posSelected&&(
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:"#f9fafb",borderRadius:10,marginBottom:16}}>
                    <div style={{width:36,height:36,background:posSelected.color+"22",border:`1px solid ${posSelected.color}44`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:posSelected.color,fontFamily:"monospace"}}>■</div>
                    <div><div style={{fontWeight:700,fontSize:14}}>{posSelected.name}</div><div style={{fontSize:12,color:"#9ca3af"}}>{posSelected.desc}</div></div>
                  </div>
                  <div style={{display:"grid",gap:11,marginBottom:16}}>
                    <div>
                      <label style={{display:"block",fontSize:11,fontWeight:700,color:"#9ca3af",textTransform:"uppercase",letterSpacing:".07em",marginBottom:5}}>API Key *</label>
                      <input className="inp" placeholder={`Paste your ${posSelected.name} API key…`} value={posApiKey} onChange={e=>setPosApiKey(e.target.value)}/>
                      <div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>{posSelected.name} Dashboard → Developers → API Keys · <button style={{background:"none",border:"none",color:"#3b82f6",cursor:"pointer",fontSize:11,fontWeight:600,padding:0}} onClick={()=>setHelpModal(posSelected.id)}>View setup guide →</button></div>
                    </div>
                    <div style={{padding:"11px 13px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:9}}>
                      <div style={{fontSize:12,fontWeight:700,color:"#1d4ed8",marginBottom:4}}>How it works</div>
                      <div style={{fontSize:12,color:"#1d4ed8",opacity:.8,lineHeight:1.6}}>Every {posSelected.name} sale triggers a webhook → we match the item to your recipes → verified recipes auto-deduct inventory → unmatched items go to the flagged queue.</div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <Btn v="ghost" onClick={()=>setPosSetupStep("list")}>← Back</Btn>
                    <Btn v="primary" disabled={!posApiKey} onClick={()=>{ setConnectedPOS(prev=>[...prev,{id:posSelected.id,name:posSelected.name}]); setPosSetupStep("done"); showToast(`${posSelected.name} connected — sales syncing live`); }} style={{flex:1,justifyContent:"center"}}>Connect {posSelected.name}</Btn>
                  </div>
                </div>
              )}
              {posSetupStep==="done"&&posSelected&&(
                <div style={{textAlign:"center",padding:"16px 0"}}>
                  <div style={{fontSize:44,marginBottom:12}}>🎉</div>
                  <div style={{fontWeight:700,fontSize:18,marginBottom:6}}>{posSelected.name} connected!</div>
                  <div style={{fontSize:13,color:"#6b7280",maxWidth:280,margin:"0 auto 18px"}}>Every sale in {posSelected.name} will now automatically update your inventory.</div>
                  {["Real-time sale ingestion","FIFO/FEFO lot depletion","Flagged queue for unmatched items"].map((f,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:7,padding:"8px 12px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,marginBottom:7,fontSize:13,color:"#166534"}}>✓ {f}</div>
                  ))}
                  <Btn v="primary" onClick={()=>{ setPosModal(false); setPosSetupStep("list"); setPosApiKey(""); }} style={{marginTop:10}}>Done</Btn>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Help modal */}
      {helpModal&&(()=>{
        const pos=POS_SYSTEMS.find(p=>p.id===helpModal);
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:16,backdropFilter:"blur(6px)"}} onClick={()=>setHelpModal(null)}>
            <Card style={{width:"100%",maxWidth:520,animation:"fadeUp .2s ease",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
              <div style={{padding:"14px 18px",borderBottom:"1px solid #f3f4f6",display:"flex",justifyContent:"space-between",alignItems:"center",background:"#f9fafb"}}>
                <div style={{fontWeight:700,fontSize:15}}>🔧 How to connect {pos?.name}</div>
                <button onClick={()=>setHelpModal(null)} style={{background:"none",border:"none",color:"#9ca3af",cursor:"pointer",fontSize:18}}>×</button>
              </div>
              <div style={{padding:"20px"}}>
                <div style={{display:"grid",gap:12}}>
                  {[
                    {step:"1",title:`Log in to your ${pos?.name} account`,desc:`Go to ${pos?.name}'s web dashboard at dashboard.${pos?.name?.toLowerCase()}.com`},
                    {step:"2",title:"Navigate to Developers / API",desc:`Look for Settings → Developers → API Keys, or Integrations → Webhooks depending on your ${pos?.name} plan`},
                    {step:"3",title:"Create a new API key",desc:'Name it "Mise en Place" or similar. Copy the full key — you won\'t see it again.'},
                    {step:"4",title:"Set up a webhook (optional)",desc:`Point your ${pos?.name} webhook to: https://yourdomain.com/api/sales with content-type application/json`},
                    {step:"5",title:"Paste your API key here",desc:"Return to the POS Integration tab, click Connect, and paste the key into the setup form."},
                  ].map(s=>(
                    <div key={s.step} style={{display:"flex",gap:12,padding:"11px 13px",background:"#f9fafb",borderRadius:9,border:"1px solid #e5e7eb"}}>
                      <div style={{width:24,height:24,background:"#1d4ed8",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",flexShrink:0}}>{s.step}</div>
                      <div>
                        <div style={{fontWeight:600,fontSize:13,marginBottom:3}}>{s.title}</div>
                        <div style={{fontSize:12,color:"#6b7280",lineHeight:1.5}}>{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:14,padding:"11px 13px",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:9,fontSize:12,color:"#92400e"}}>
                  💡 Need more help? Contact your {pos?.name} account manager, or email us at support@miseenplace.app
                </div>
                <div style={{marginTop:12,display:"flex",justifyContent:"flex-end"}}>
                  <Btn v="ghost" onClick={()=>setHelpModal(null)}>Close</Btn>
                </div>
              </div>
            </Card>
          </div>
        );
      })()}

      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
    </div>
  );
}
