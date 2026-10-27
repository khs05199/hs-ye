import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

/* =========================================================
   HS & YE — 커플 데이트 앱 (카카오맵 + Supabase)
   ========================================================= */
const CFG = window.HSYE_CONFIG || {};
const MEMBERS = Object.fromEntries(Object.entries(CFG.members || {}).map(([k, v]) => [k.trim().toLowerCase(), v]));

const CATS = {
  food:{l:"맛집",stay:80,i:"🍽"}, cafe:{l:"카페",stay:60,i:"☕"}, walk:{l:"산책·뷰",stay:50,i:"🌿"},
  show:{l:"전시·공연",stay:90,i:"🎨"}, act:{l:"놀거리",stay:120,i:"🎳"}, shop:{l:"쇼핑",stay:60,i:"🛍"},
  stay:{l:"숙소",stay:0,i:"🏨"}, etc:{l:"기타",stay:60,i:"📍"}
};
const ME_NAME = {HS:"HS", YE:"예은"};
function catFromKakao(r){
  const g=r.category_group_code||"", n=r.category_name||"";
  if(g==="CE7"||/카페|디저트/.test(n)) return "cafe";
  if(g==="FD6"||/음식점/.test(n)) return "food";
  if(g==="AD5"||/숙박/.test(n)) return "stay";
  if(g==="CT1"||/문화|전시|공연|미술관|박물관/.test(n)) return "show";
  if(g==="AT4"||/관광|명소|공원|해수욕장|산|호수/.test(n)) return "walk";
  if(/쇼핑|백화점|마트/.test(n)||g==="MT1") return "shop";
  if(/스포츠|오락|테마파크|볼링|방탈출|노래방/.test(n)) return "act";
  return "etc";
}

/* ---------- utils ---------- */
const $ = (s,el=document)=>el.querySelector(s);
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const pad = n => String(n).padStart(2,"0");
const fmtD = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const todayStr = () => fmtD(new Date());
const parseD = s => { const [y,m,d]=String(s).split("-").map(Number); return new Date(y,(m||1)-1,d||1); };
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const dayDiff = (a,b) => Math.round((parseD(fmtD(b))-parseD(fmtD(a)))/86400000);
const WD = ["일","월","화","수","목","금","토"];
const korDate = s => { const d=parseD(s); return `${d.getMonth()+1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
const toMin = t => { const [h,m]=String(t||"11:00").split(":").map(Number); return h*60+(m||0); };
const toHM = m => { m=Math.round(m); const h=Math.floor(m/60)%24; return `${pad(h)}:${pad(((m%60)+60)%60)}`; };
const km = (a,b) => { const R=6371,r=Math.PI/180; const dLa=(b.lat-a.lat)*r,dLo=(b.lng-a.lng)*r; const x=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(x)); };
function leg(a,b){
  const d=km(a,b);
  if(d<0.05) return {d,min:0,mode:"바로 옆"};
  if(d<1.3) return {d,min:Math.max(5,Math.ceil(d*1.25/4.5*60/5)*5),mode:"도보"};
  if(d<60) return {d,min:Math.ceil((d*1.3/22*60+8)/5)*5,mode:"차·대중교통"};
  return {d,min:Math.ceil((d*1.2/80*60+20)/5)*5,mode:"장거리 이동"};
}
const kakaoRoute = (a,b) => `https://map.kakao.com/link/from/${encodeURIComponent(a.name||"출발")},${a.lat},${a.lng}/to/${encodeURIComponent(b.name||"도착")},${b.lat},${b.lng}`;
const kakaoPlaceUrl = p => p.kakaoUrl || `https://map.kakao.com/link/map/${encodeURIComponent(p.name)},${p.lat},${p.lng}`;
let toastT;
function toast(msg){ let t=$(".toast"); if(!t){t=document.createElement("div");t.className="toast";document.body.appendChild(t);} t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2400); }
const lsGet=(k,d)=>{try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch{return d;}};
const lsSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};

/* ---------- state ---------- */
const S = { places:[], plans:[], memories:[], settings:{}, me:null, email:"", tab:lsGet("hsye.tab","home"),
  mapMode:"map", filter:"all", cat:"all", sel:null, openPlan:null, routePlan:null, pick:null, temp:null, ready:false };
let sb = null;

/* ---------- Supabase data layer ----------
   Each table is (id text pk, data jsonb, updated_at). Rows arrive live through realtime. */
const TABLES = ["places","plans","memories","meta"];
function applyRow(table,row){
  if(table==="meta"){ if(row.id==="settings") S.settings=row.data||{}; return; }
  const list=S[table]; const i=list.findIndex(x=>x.id===row.id); const v={id:row.id,...(row.data||{})};
  if(i>=0) list[i]=v; else list.push(v);
}
function removeRow(table,id){ if(table!=="meta") S[table]=S[table].filter(x=>x.id!==id); }
async function loadAll(){
  const res=await Promise.all(TABLES.map(t=>sb.from(t).select("id,data")));
  res.forEach((r,i)=>{ if(r.error) throw r.error; const t=TABLES[i]; if(t!=="meta") S[t]=[]; r.data.forEach(row=>applyRow(t,row)); });
  S.ready=true;
}
function subscribe(){
  let timer;
  sb.channel("hsye-all").on("postgres_changes",{event:"*",schema:"public"},p=>{
    if(!TABLES.includes(p.table)) return;
    if(p.eventType==="DELETE") removeRow(p.table,p.old.id); else applyRow(p.table,p.new);
    clearTimeout(timer); timer=setTimeout(render,60);
  }).subscribe();
  // refresh when the app comes back to the foreground (realtime can sleep on phones)
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") loadAll().then(render).catch(()=>{}); });
}
async function save(table,id,data){
  data.updatedAt=Date.now();
  applyRow(table,{id,data}); render();
  const {error}=await sb.from(table).upsert({id,data,updated_at:new Date().toISOString()});
  if(error){ toast("저장하지 못했어요: "+(error.message||"네트워크를 확인해 주세요")); loadAll().then(render).catch(()=>{}); throw error; }
}
async function del(table,id){
  removeRow(table,id); render();
  const {error}=await sb.from(table).delete().eq("id",id);
  if(error){ toast("삭제하지 못했어요"); loadAll().then(render).catch(()=>{}); throw error; }
}

/* ---------- photos (private bucket + signed URLs) ---------- */
const photoUrls=new Map(); let photoPending=new Set(), photoTimer=null;
function photoSrc(ph){
  if(!ph) return "";
  if(ph.url&&!ph.path) return ph.url;
  const u=photoUrls.get(ph.path); if(u) return u;
  photoPending.add(ph.path); clearTimeout(photoTimer); photoTimer=setTimeout(fetchPhotoUrls,30); return "";
}
async function fetchPhotoUrls(){
  const paths=[...photoPending]; photoPending=new Set(); if(!paths.length) return;
  const {data,error}=await sb.storage.from("photos").createSignedUrls(paths,60*60*24*7);
  if(error||!data) return; data.forEach(d=>{ if(d.signedUrl) photoUrls.set(d.path,d.signedUrl); }); render();
}
const imgTag = (ph,attrs="") => { const s=photoSrc(ph); return s?`<img src="${esc(s)}" alt="" ${attrs}>`:`<div class="photo-ph"></div>`; };
async function resizeImage(file,max=1600){
  const url=URL.createObjectURL(file);
  try{ const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url;});
    const k=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement("canvas"); c.width=Math.round(img.width*k); c.height=Math.round(img.height*k);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(r,"image/jpeg",0.85));
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- data helpers ---------- */
const placeById = id => S.places.find(p=>p.id===id);
const likeState = p => { const h=!!(p.likes&&p.likes.HS), y=!!(p.likes&&p.likes.YE); return h&&y?"both":h?"hs":y?"ye":"none"; };
const COLORS = {both:"#7E4FD6",hs:"#2F5BD3",ye:"#DE4F7B",none:"#8E8A9C"};
const colorOf = p => COLORS[likeState(p)];
function startPointOf(plan){
  const s=plan.start; if(!s) return null;
  if(typeof s==="object"&&s.lat) return s;
  if(typeof s==="string"&&s.startsWith("p:")){ const p=placeById(s.slice(2)); return p?{lat:p.lat,lng:p.lng,name:p.name}:null; }
  return null;
}
function planStops(plan){ return (plan.stops||[]).map(s=>({...s,place:placeById(s.placeId)})).filter(s=>s.place&&typeof s.place.lat==="number"); }
function optimizeOrder(start, stops){
  if(stops.length<2) return stops.slice();
  let route=[], rest=stops.slice(), cur=start;
  if(!cur){ route.push(rest.shift()); cur=route[0].place; }
  while(rest.length){ let bi=0,bd=Infinity; rest.forEach((s,i)=>{const d=km(cur,s.place); if(d<bd){bd=d;bi=i;}}); const n=rest.splice(bi,1)[0]; route.push(n); cur=n.place; }
  const len=r=>{ let t=0,c=start; r.forEach(s=>{ if(c) t+=km(c,s.place); c=s.place; }); return t; };
  let improved=true, guard=0;
  while(improved&&guard++<60){ improved=false;
    for(let i=0;i<route.length-1;i++) for(let j=i+1;j<route.length;j++){
      const cand=route.slice(0,i).concat(route.slice(i,j+1).reverse(),route.slice(j+1));
      if(len(cand)+1e-9<len(route)){ route=cand; improved=true; }
    }
  }
  return route;
}
function timeline(plan){
  const start=startPointOf(plan); const stops=planStops(plan);
  let t=toMin(plan.startTime||"11:00"), prev=start, totalKm=0, moveMin=0; const rows=[];
  stops.forEach(s=>{
    let l=null; if(prev){ l=leg(prev,s.place); totalKm+=l.d; moveMin+=l.min; t+=l.min; }
    const stay=s.stay??(CATS[s.place.cat]||CATS.etc).stay;
    rows.push({...s,from:prev,leg:l,arrive:t,leave:t+stay,stay}); t+=stay; prev=s.place;
  });
  return {start,rows,end:t,totalKm,moveMin};
}
function annivs(){
  if(!S.settings.since) return null;
  const s=parseD(S.settings.since), today=parseD(todayStr());
  const n=dayDiff(s,today)+1; const out=[];
  for(let k=Math.ceil(n/100)*100||100; out.length<2; k+=100){ const d=addDays(s,k-1); out.push({label:`${k}일`,date:d,left:dayDiff(today,d)}); }
  for(let y=1;y<80;y++){ const d=new Date(s.getFullYear()+y,s.getMonth(),s.getDate()); const left=dayDiff(today,d); if(left>=0){ out.push({label:`${y}주년`,date:d,left}); break; } }
  out.sort((a,b)=>a.left-b.left);
  return {n,list:out.slice(0,3)};
}

/* =========================================================
   Gate screens: config missing / login / not a member
   ========================================================= */
function showGate(html){
  $("#topbar").hidden=true; $("#tabs").hidden=true;
  ["home","map","plan","mem"].forEach(t=>$("#v-"+t).hidden=true);
  const g=$("#v-gate"); g.hidden=false; g.innerHTML=`<div class="auth"><div class="card"><div class="logo"><span class="h">HS</span><span class="amp">&amp;</span><span class="y">YE</span></div>${html}</div></div>`;
}
function configScreen(){
  const miss=[]; if(!CFG.kakaoJsKey) miss.push("카카오 JavaScript 키 (kakaoJsKey)"); if(!CFG.supabaseUrl) miss.push("Supabase 주소 (supabaseUrl)"); if(!CFG.supabaseAnonKey) miss.push("Supabase anon 키 (supabaseAnonKey)");
  showGate(`<h2>설정이 아직 안 끝났어요</h2><p class="small muted" style="margin:0">config.js 파일에 아래 값을 채워 주세요. 방법은 README.md에 단계별로 있어요.</p><ul class="small" style="margin:0;padding-left:18px">${miss.map(m=>`<li>${m}</li>`).join("")}</ul>`);
}
function loginScreen(msg=""){
  showGate(`<p class="small muted" style="margin:0;text-align:center">우리 둘만 쓰는 데이트 앱이에요.<br>등록한 이메일로 로그인해 주세요.</p>
    <form id="loginForm" style="display:flex;flex-direction:column;gap:10px">
      <div class="field"><label for="lgEmail">이메일</label><input id="lgEmail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="lgPw">비밀번호 (6자 이상)</label><input id="lgPw" type="password" autocomplete="current-password" minlength="6" required></div>
      <div id="lgMsg" class="${msg.startsWith("✓")?"ok":"err"}">${esc(msg.replace(/^✓/,""))}</div>
      <button class="btn primary" id="lgIn">로그인</button>
      <button class="btn ghost" type="button" id="lgUp">처음이에요 · 계정 만들기</button>
    </form>`);
  const f=$("#loginForm"), out=$("#lgMsg");
  const vals=()=>({email:$("#lgEmail").value.trim().toLowerCase(),password:$("#lgPw").value});
  f.onsubmit=async e=>{ e.preventDefault(); const v=vals(); out.className="err"; out.textContent="";
    const {error}=await sb.auth.signInWithPassword(v);
    if(error) out.textContent=/confirm/i.test(error.message)?"메일함의 확인 링크를 먼저 눌러 주세요.":"이메일이나 비밀번호가 맞지 않아요.";
  };
  $("#lgUp").onclick=async()=>{ const v=vals(); out.className="err";
    if(!v.email||v.password.length<6){ out.textContent="이메일과 6자 이상 비밀번호를 적어 주세요."; return; }
    if(!MEMBERS[v.email]){ out.textContent="config.js에 등록된 이메일만 가입할 수 있어요."; return; }
    const {data,error}=await sb.auth.signUp({...v,options:{emailRedirectTo:location.origin+location.pathname}});
    if(error){ out.textContent=/registered/i.test(error.message)?"이미 가입된 이메일이에요. 로그인해 주세요.":"가입하지 못했어요: "+error.message; return; }
    if(!data.session){ out.className="ok"; out.textContent="확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요."; }
  };
}
function notMemberScreen(email){
  showGate(`<h2>등록되지 않은 계정이에요</h2><p class="small muted" style="margin:0">${esc(email)} 은(는) config.js 의 members 에 없어요. 이메일을 추가하거나 다른 계정으로 로그인해 주세요.</p><button class="btn" id="lgOut">로그아웃</button>`);
  $("#lgOut").onclick=()=>sb.auth.signOut();
}

/* =========================================================
   Render
   ========================================================= */
function render(){
  if(!S.ready) return;
  const ae=document.activeElement; const keep=ae&&ae.id&&ae.closest(".view")&&!ae.closest(".search")?{id:ae.id,v:ae.value,s:ae.selectionStart}:null;
  $("#v-gate").hidden=true; $("#topbar").hidden=false; $("#tabs").hidden=false;
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("on",b.dataset.tab===S.tab));
  ["home","map","plan","mem"].forEach(t=>$("#v-"+t).hidden=S.tab!==t);
  const mc=$("#meChip"); mc.textContent=ME_NAME[S.me]||""; mc.className="chip "+(S.me==="HS"?"hs":"ye");
  const a=annivs(); const td=$("#topDday"); td.hidden=!a||S.tab==="home"; if(a) td.textContent=`D+${a.n}`;
  if(S.tab==="home") renderHome();
  if(S.tab==="map") renderMap();
  if(S.tab==="plan") renderPlans();
  if(S.tab==="mem") renderMems();
  if(keep){ const el=document.getElementById(keep.id); if(el&&el!==document.activeElement){ el.value=keep.v; el.focus(); try{el.setSelectionRange(keep.s,keep.s);}catch{} } }
}

/* ---------- HOME ---------- */
function renderHome(){
  const a=annivs(); const today=todayStr();
  const upcoming=S.plans.filter(p=>p.date>=today).sort((x,y)=>(x.date+(x.startTime||"")).localeCompare(y.date+(y.startTime||"")));
  const both=S.places.filter(p=>likeState(p)==="both"&&!p.visited);
  const lastYear=S.memories.filter(m=>m.date&&m.date.slice(5)===today.slice(5)&&m.date<today);
  const recentMem=S.memories.slice().sort((x,y)=>(y.date||"").localeCompare(x.date||""))[0];
  const next=upcoming[0];
  let h=`<div class="wrap"><div class="card hero">`;
  if(a){
    h+=`<div class="eyebrow">${esc(korDate(S.settings.since).replace(/\s\(.\)/,""))}부터 함께</div>
      <div class="dday">D+${a.n}<small>일째</small></div>
      <div class="annis">${a.list.map(x=>`<div class="anni"><b>${x.label}</b><span class="small muted mono">${fmtD(x.date).slice(2).replace(/-/g,".")} · ${x.left===0?"오늘!":"D-"+x.left}</span></div>`).join("")}</div>`;
  } else h+=`<div class="eyebrow">우리 처음 만난 날</div><h2 style="margin:6px 0 12px">시작한 날을 적으면 D-day와 기념일을 계산해 줘요</h2><button class="btn primary" data-act="settings">날짜 입력하기</button>`;
  h+=`</div><div class="card"><div class="row between"><h3>다음 데이트</h3><button class="btn sm ghost" data-act="newPlan">+ 플랜 짜기</button></div>`;
  if(next){
    const tl=timeline(next); const dd=dayDiff(parseD(today),parseD(next.date));
    h+=`<div class="li" style="border:0;cursor:pointer" data-open-plan="${next.id}"><div class="datebox"><div class="m">${parseD(next.date).getMonth()+1}월</div><div class="d">${parseD(next.date).getDate()}</div></div>
      <div class="grow"><div class="t">${esc(next.title||"데이트")}</div><div class="small muted">${dd===0?"오늘":dd===1?"내일":"D-"+dd} · ${esc(next.startTime||"")}~${toHM(tl.end)} · ${tl.rows.length}곳 · 이동 ${tl.totalKm.toFixed(1)}km</div>
      <div class="small" style="margin-top:4px;overflow-wrap:anywhere">${tl.rows.map(r=>esc(r.place.name)).join(" → ")||"<span class='muted'>장소를 아직 안 골랐어요</span>"}</div></div></div>`;
    const todo=(next.checklist||[]).filter(c=>!c.done).length; if(todo) h+=`<div class="small muted">준비물·할 일 ${todo}개 남음</div>`;
  } else h+=`<p class="muted small" style="margin:8px 0 0">잡힌 데이트가 없어요. 가고 싶은 곳을 골라 플랜을 만들어 보세요.</p>`;
  h+=`</div><div class="stats"><div class="stat"><div class="n" style="color:var(--both)">${both.length}</div><div class="l">둘 다 ♥ 한 곳</div></div><div class="stat"><div class="n">${S.places.filter(p=>!p.visited).length}</div><div class="l">가고 싶은 곳</div></div><div class="stat"><div class="n">${S.memories.length}</div><div class="l">쌓인 추억</div></div></div>`;
  const memCard=(m,label)=>`<div class="card" data-goto="mem" style="cursor:pointer"><div class="eyebrow">${label}</div><div class="row" style="margin-top:6px;flex-wrap:nowrap">${m.photos&&m.photos[0]?`<div style="width:56px;height:56px;border-radius:10px;overflow:hidden;flex:none">${imgTag(m.photos[0],'style="width:56px;height:56px;object-fit:cover"')}</div>`:""}<div style="min-width:0"><b>${esc(m.title)}</b><div class="small muted">${esc(korDate(m.date))}</div></div></div></div>`;
  if(lastYear.length) h+=memCard(lastYear[0],`${parseD(today).getFullYear()-parseD(lastYear[0].date).getFullYear()}년 전 오늘`);
  h+=`<div class="card"><div class="row between"><h3>둘 다 가고 싶어 하는 곳</h3><button class="btn sm ghost" data-goto="map">지도 보기</button></div><div class="list">`;
  h+= both.length? both.slice(0,5).map(p=>`<div class="li" data-show-place="${p.id}" style="cursor:pointer"><span class="dot both"></span><div class="grow"><div class="t">${esc(p.name)}</div><div class="small muted">${(CATS[p.cat]||CATS.etc).l}${p.address?" · "+esc(p.address):""}</div></div></div>`).join("") : `<p class="small muted" style="margin:8px 0 0">서로 가고 싶은 곳에 ♥를 누르면 겹치는 곳이 여기 모여요.</p>`;
  h+=`</div></div>`;
  if(recentMem&&!lastYear.length) h+=memCard(recentMem,"가장 최근 추억");
  h+=`<details class="card guide"><summary>휴대폰 홈 화면에 앱으로 설치하기 <span class="muted">＋</span></summary>
    <ol><li><b>아이폰(Safari)</b>: 아래 공유 버튼 → <b>홈 화면에 추가</b></li>
    <li><b>갤럭시(Chrome·삼성 인터넷)</b>: 메뉴 ⋮ → <b>홈 화면에 추가</b> 또는 <b>앱 설치</b></li></ol>
    <p class="small muted" style="margin:10px 0 0">설치하면 주소창 없이 앱처럼 열려요.</p></details></div>`;
  $("#v-home").innerHTML=h;
}

/* =========================================================
   MAP (Kakao)
   ========================================================= */
const K = { map:null, ps:null, geo:null, overlays:new Map(), labels:[], route:[], temp:null, loading:null, failed:false };
function loadKakao(){
  if(K.loading) return K.loading;
  K.loading=new Promise((res,rej)=>{
    if(window.kakao&&window.kakao.maps&&window.kakao.maps.services) return res();
    const s=document.createElement("script");
    s.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(CFG.kakaoJsKey)}&libraries=services&autoload=false`;
    s.onload=()=>{ try{ window.kakao.maps.load(()=>res()); }catch(e){ rej(e); } };
    s.onerror=()=>rej(new Error("load"));
    document.head.appendChild(s);
    setTimeout(()=>rej(new Error("timeout")),15000);
  }).then(()=>{ const sv=window.kakao.maps.services; K.ps=K.ps||new sv.Places(); K.geo=K.geo||new sv.Geocoder(); }).catch(e=>{ K.failed=true; throw e; });
  return K.loading;
}
function buildMapShell(){
  const host=$("#v-map"); if(host.dataset.built) return; host.dataset.built="1";
  host.innerHTML=`<div id="kmap"></div><div class="map-msg" id="mapMsg">지도를 불러오는 중…</div>
    <div class="map-top"><div class="search"><svg class="sicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="mapQ" type="search" enterkeyhint="search" placeholder="카카오맵에서 장소 검색 (예: 수성못 카페)" autocomplete="off" aria-label="장소 검색"><div class="sres" id="sres" hidden></div></div><div id="mapTop"></div></div>
    <div class="map-ctrl" id="mapCtrl"><button data-act="myLoc" aria-label="내 위치" style="font-size:16px">◎</button><button data-act="fitAll" aria-label="우리 장소 전체 보기" style="font-size:14px">⤢</button></div>
    <button class="btn primary fab" id="addPlaceBtn" data-act="pickNew">＋ 지도에서 찍어 추가</button>
    <div id="listOverlay" class="list-overlay" hidden></div><div id="popHost"></div>`;
  bindSearch();
  loadKakao().then(initMap).catch(()=>{
    $("#mapMsg").innerHTML=`<div><b>카카오 지도를 불러오지 못했어요</b><p class="small">카카오디벨로퍼스에서 ① 카카오맵 사용 설정이 켜져 있는지, ② JavaScript SDK 도메인에 <b>${esc(location.origin)}</b> 이 등록됐는지, ③ config.js 의 JavaScript 키가 맞는지 확인해 주세요.</p></div>`;
  });
}
function initMap(){
  const el=$("#kmap"); const k=window.kakao.maps;
  const last=lsGet("hsye.view",null);
  K.map=new k.Map(el,{center:new k.LatLng(last?last.lat:35.8690,last?last.lng:128.5950),level:last?last.level:7});
  $("#mapMsg").hidden=true;
  k.event.addListener(K.map,"click",e=>onMapClick(e.latLng));
  k.event.addListener(K.map,"idle",()=>{ const c=K.map.getCenter(); lsSet("hsye.view",{lat:c.getLat(),lng:c.getLng(),level:K.map.getLevel()}); });
  k.event.addListener(K.map,"zoom_changed",syncLabels);
  if(!last&&S.places.length) fitAll();
  renderMap();
}
// keep taps on our overlays from also counting as a tap on the map underneath
function stopMap(el){ ["mousedown","touchstart","pointerdown"].forEach(t=>el.addEventListener(t,()=>{ try{ window.kakao.maps.event.preventMap(); }catch{} },{passive:true})); }
function pinEl(p){
  const st=likeState(p), c=COLORS[st];
  const el=document.createElement("div"); el.className="kpin"+(p.visited?" visited":"")+(S.sel===p.id?" sel":"");
  el.innerHTML=`<svg viewBox="0 0 30 38"><path d="M15 37C6 26 1 21 1 14a14 14 0 0 1 28 0c0 7-5 12-14 23z" fill="${c}" stroke="#fff" stroke-width="2"/></svg><b>${p.visited?"✓":st==="both"?"♥":(CATS[p.cat]||CATS.etc).i}</b><span class="kpin-label">${esc(p.name)}</span>`;
  stopMap(el);
  el.addEventListener("click",ev=>{ ev.stopPropagation(); S.sel=p.id; S.temp=null; clearTemp(); syncPins(); renderPop(); });
  return el;
}
function visiblePlaces(){
  return S.places.filter(p=>{
    if(typeof p.lat!=="number") return false;
    if(S.filter==="both"&&likeState(p)!=="both") return false;
    if(S.filter==="HS"&&!(p.likes&&p.likes.HS)) return false;
    if(S.filter==="YE"&&!(p.likes&&p.likes.YE)) return false;
    if(S.filter==="todo"&&p.visited) return false;
    if(S.filter==="done"&&!p.visited) return false;
    if(S.cat!=="all"&&p.cat!==S.cat) return false;
    return true;
  });
}
function syncLabels(){ if(!K.map) return; const show=K.map.getLevel()<=5; document.querySelectorAll("#kmap .kpin-label").forEach(l=>{ const sel=l.parentElement.classList.contains("sel"); l.style.display=show||sel?"":"none"; }); }
function syncPins(){
  if(!K.map) return; const k=window.kakao.maps;
  K.overlays.forEach(o=>o.setMap(null)); K.overlays.clear();
  K.route.forEach(o=>o.setMap(null)); K.route=[];
  if(S.routePlan){
    const pl=S.plans.find(x=>x.id===S.routePlan);
    if(pl){ const t=timeline(pl); const pts=[t.start,...t.rows.map(r=>r.place)].filter(Boolean);
      if(pts.length>1){ const line=new k.Polyline({path:pts.map(p=>new k.LatLng(p.lat,p.lng)),strokeWeight:5,strokeColor:"#7E4FD6",strokeOpacity:.85,strokeStyle:"shortdash"}); line.setMap(K.map); K.route.push(line); }
      if(t.start){ const d=document.createElement("div"); d.className="knum start"; d.textContent="출"; const o=new k.CustomOverlay({position:new k.LatLng(t.start.lat,t.start.lng),content:d,yAnchor:.5}); o.setMap(K.map); K.route.push(o); }
      t.rows.forEach((r,i)=>{ const d=document.createElement("div"); d.className="knum"; d.textContent=i+1; d.title=r.place.name; stopMap(d); d.onclick=e=>{e.stopPropagation(); S.sel=r.place.id; renderPop();}; const o=new k.CustomOverlay({position:new k.LatLng(r.place.lat,r.place.lng),content:d,yAnchor:.5,zIndex:3}); o.setMap(K.map); K.route.push(o); });
    }
  } else {
    visiblePlaces().forEach(p=>{ const o=new k.CustomOverlay({position:new k.LatLng(p.lat,p.lng),content:pinEl(p),yAnchor:1,zIndex:S.sel===p.id?5:likeState(p)==="both"?3:2}); o.setMap(K.map); K.overlays.set(p.id,o); });
  }
  syncLabels();
}
function clearTemp(){ if(K.temp){ K.temp.setMap(null); K.temp=null; } }
function showTemp(t){
  clearTemp(); if(!K.map) return; const k=window.kakao.maps;
  const el=document.createElement("div"); el.className="kpin sel";
  el.innerHTML=`<svg viewBox="0 0 30 38"><path d="M15 37C6 26 1 21 1 14a14 14 0 0 1 28 0c0 7-5 12-14 23z" fill="#1E1C29" stroke="#fff" stroke-width="2"/></svg><b>★</b><span class="kpin-label">${esc(t.name)}</span>`;
  K.temp=new k.CustomOverlay({position:new k.LatLng(t.lat,t.lng),content:el,yAnchor:1,zIndex:9}); K.temp.setMap(K.map);
}
function panTo(lat,lng,level){ if(!K.map) return; const k=window.kakao.maps; if(level) K.map.setLevel(level); K.map.panTo(new k.LatLng(lat,lng)); }
function fitAll(){
  if(!K.map) return; const k=window.kakao.maps; const pts=visiblePlaces(); if(!pts.length){ toast("아직 찍어둔 장소가 없어요"); return; }
  if(pts.length===1) return panTo(pts[0].lat,pts[0].lng,4);
  const b=new k.LatLngBounds(); pts.forEach(p=>b.extend(new k.LatLng(p.lat,p.lng))); K.map.setBounds(b,80,40,140,40);
}
function fitRoute(pl){
  if(!K.map) return; const k=window.kakao.maps; const t=timeline(pl); const pts=[t.start,...t.rows.map(r=>r.place)].filter(Boolean); if(!pts.length) return;
  if(pts.length===1) return panTo(pts[0].lat,pts[0].lng,4);
  const b=new k.LatLngBounds(); pts.forEach(p=>b.extend(new k.LatLng(p.lat,p.lng))); K.map.setBounds(b,140,40,220,40);
}
function addressOf(lat,lng){
  return new Promise(res=>{ if(!K.geo) return res(""); K.geo.coord2Address(lng,lat,(r,st)=>{ if(st===window.kakao.maps.services.Status.OK&&r[0]){ res((r[0].road_address&&r[0].road_address.address_name)||(r[0].address&&r[0].address.address_name)||""); } else res(""); }); });
}
async function onMapClick(ll){
  const lat=ll.getLat(), lng=ll.getLng();
  if(S.pick==="new"){ S.pick=null; const address=await addressOf(lat,lng); render(); placeSheet(null,{name:"",lat,lng,address,cat:"etc"}); return; }
  if(S.pick){ const p=placeById(S.pick); S.pick=null; if(p){ const address=await addressOf(lat,lng); const d={...p}; delete d.id; d.lat=lat; d.lng=lng; if(address) d.address=address; save("places",p.id,d).then(()=>toast("위치를 옮겼어요")).catch(()=>{}); S.sel=p.id; } render(); return; }
  if(S.sel||S.temp){ S.sel=null; S.temp=null; clearTemp(); syncPins(); renderPop(); }
}
function renderMap(){
  buildMapShell();
  const filters=[["all","전체"],["both","둘 다 ♥"],["HS","HS ♥"],["YE","YE ♥"],["todo","안 가본 곳"],["done","가본 곳"]].map(([k,l])=>`<button class="chip ${S.filter===k?"on":""}" data-filter="${k}">${l}</button>`).join("");
  const cats=`<button class="chip ${S.cat==="all"?"on":""}" data-cat="all">모든 종류</button>`+Object.entries(CATS).map(([k,c])=>`<button class="chip ${S.cat===k?"on":""}" data-cat="${k}">${c.i} ${c.l}</button>`).join("");
  let top=`<div class="row" style="flex-wrap:nowrap"><div class="seg"><button class="${S.mapMode==="map"?"on":""}" data-mode="map">지도</button><button class="${S.mapMode==="list"?"on":""}" data-mode="list">목록</button></div><div class="chips" style="flex:1">${filters}</div></div>`;
  if(S.mapMode==="list") top+=`<div class="chips">${cats}</div>`;
  if(S.pick) top+=`<div class="pick-hint"><span>${S.pick==="new"?"추가할 곳을 지도에서 눌러 주세요":`<b>${esc((placeById(S.pick)||{}).name||"")}</b>의 정확한 위치를 눌러 주세요`}</span><button class="btn sm" data-act="cancelPick">취소</button></div>`;
  if(S.routePlan){ const pl=S.plans.find(x=>x.id===S.routePlan); if(pl) top+=`<div class="pick-hint"><span>동선 보기 · ${esc(pl.title||"데이트")}</span><button class="btn sm" data-act="clearRoute">닫기</button></div>`; }
  $("#mapTop").innerHTML=top;
  $("#listOverlay").hidden=S.mapMode!=="list";
  $("#mapCtrl").hidden=S.mapMode==="list";
  $("#addPlaceBtn").hidden=!!S.pick||S.mapMode==="list";
  if(S.mapMode==="list") renderPlaceList();
  if(K.map){ K.map.relayout(); syncPins(); }
  renderPop();
}
function heartBtns(p){
  return `<div class="hearts">${["HS","YE"].map(w=>`<button class="heart ${w.toLowerCase()} ${p.likes&&p.likes[w]?"on":""}" ${w===S.me?`data-like="${p.id}"`:"disabled"} aria-label="${ME_NAME[w]} 하트">♥ ${w}</button>`).join("")}</div>`;
}
function renderPop(){
  const host=$("#popHost"); if(!host) return;
  if(S.mapMode==="list"||S.pick){ host.innerHTML=""; return; }
  const p=S.sel&&placeById(S.sel);
  if(!p&&S.temp){ const t=S.temp;
    host.innerHTML=`<div class="place-pop"><div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><div style="min-width:0"><div class="eyebrow">${esc(t.catName||"")}</div><div style="font-weight:800;font-size:17px;overflow-wrap:anywhere">${esc(t.name)}</div>${t.address?`<div class="small muted">${esc(t.address)}</div>`:""}${t.phone?`<div class="small muted mono">${esc(t.phone)}</div>`:""}</div><button class="icon-btn" data-act="closeTemp" aria-label="닫기">✕</button></div>
      <div class="row"><button class="btn sm primary" data-act="addTemp">＋ 가고 싶은 곳에 추가</button>${t.kakaoUrl?`<a class="btn sm ghost" href="${esc(t.kakaoUrl)}" target="_blank" rel="noopener">카카오맵 상세</a>`:""}</div></div>`; return; }
  if(!p){ host.innerHTML=""; return; }
  const c=CATS[p.cat]||CATS.etc;
  host.innerHTML=`<div class="place-pop"><div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><div style="min-width:0"><div class="eyebrow">${c.i} ${c.l}</div><div style="font-weight:800;font-size:17px;overflow-wrap:anywhere">${esc(p.name)}</div>${p.address?`<div class="small muted">${esc(p.address)}</div>`:""}</div><button class="icon-btn" data-act="closePop" aria-label="닫기">✕</button></div>
    ${p.memo?`<div class="small" style="overflow-wrap:anywhere">${esc(p.memo)}</div>`:""}
    <div class="row between">${heartBtns(p)}<span class="small muted">${p.addedBy?esc(ME_NAME[p.addedBy])+"가 찍음":""}</span></div>
    <div class="row"><a class="btn sm ghost" href="${esc(kakaoPlaceUrl(p))}" target="_blank" rel="noopener">카카오맵</a><button class="btn sm" data-edit-place="${p.id}">수정</button><button class="btn sm" data-pick="${p.id}">위치 옮기기</button><button class="btn sm" data-visit="${p.id}">${p.visited?"안 가본 걸로":"다녀왔어요 ✓"}</button></div></div>`;
}
function renderPlaceList(){
  const order={both:0,hs:1,ye:1,none:2};
  const vis=visiblePlaces().sort((a,b)=>(a.visited-b.visited)||(order[likeState(a)]-order[likeState(b)])||(b.updatedAt||0)-(a.updatedAt||0));
  let h=`<div class="wrap" style="gap:10px">`;
  if(!vis.length) h+=`<div class="empty"><b>${S.places.length?"조건에 맞는 장소가 없어요":"아직 찍어둔 곳이 없어요"}</b><span class="small">위 검색창에서 가게 이름을 찾거나, 지도에서 직접 찍어 저장해 보세요.</span></div>`;
  vis.forEach(p=>{ const c=CATS[p.cat]||CATS.etc;
    h+=`<div class="pcard" style="${p.visited?"opacity:.6":""}"><span class="dot" style="background:${colorOf(p)};margin-top:6px"></span><div class="grow">
      <div class="row between" style="flex-wrap:nowrap"><span class="t" style="overflow-wrap:anywhere">${esc(p.name)}</span>${p.visited?'<span class="chip">다녀옴 ✓</span>':""}</div>
      <div class="small muted">${c.i} ${c.l}${p.address?" · "+esc(p.address):""} · ${p.stay??c.stay}분</div>
      ${p.memo?`<div class="small" style="overflow-wrap:anywhere">${esc(p.memo)}</div>`:""}
      <div class="row between" style="margin-top:4px">${heartBtns(p)}<div class="row"><button class="btn sm" data-show-place="${p.id}">지도</button><button class="btn sm" data-edit-place="${p.id}">수정</button></div></div></div></div>`; });
  h+=`<div style="height:56px"></div></div>`;
  $("#listOverlay").innerHTML=h;
}

/* ---------- Kakao place search ---------- */
const SR={q:"",items:[],busy:false,err:"",seq:0};
function bindSearch(){
  const inp=$("#mapQ"); let t;
  document.addEventListener("pointerdown",e=>{ if(!e.target.closest(".search")){ const b=$("#sres"); if(b) b.hidden=true; } });
  inp.addEventListener("focus",()=>{ if(SR.q) renderSR(); });
  inp.addEventListener("input",()=>{ SR.q=inp.value; clearTimeout(t); t=setTimeout(runSearch,250); });
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); clearTimeout(t); runSearch().then(()=>{ if(SR.items[0]) chooseResult(SR.items[0]); }); } if(e.key==="Escape"){ inp.blur(); $("#sres").hidden=true; } });
}
function runSearch(){
  const q=SR.q.trim(); const my=++SR.seq;
  const saved=S.places.filter(p=>q&&p.name.replace(/\s/g,"").includes(q.replace(/\s/g,""))).slice(0,3).map(p=>({saved:true,placeId:p.id,name:p.name,address:p.address||"",lat:p.lat,lng:p.lng}));
  if(!q){ SR.items=[]; renderSR(); return Promise.resolve(); }
  if(!K.ps||!K.map){ SR.items=saved; SR.err="지도가 아직 준비되지 않았어요."; renderSR(); return Promise.resolve(); }
  SR.busy=true; SR.err=""; renderSR();
  return new Promise(res=>{
    const c=K.map.getCenter();
    K.ps.keywordSearch(q,(data,status)=>{
      if(my!==SR.seq) return res();
      SR.busy=false; const ok=window.kakao.maps.services.Status;
      const found=status===ok.OK?data.map(r=>({name:r.place_name,address:r.road_address_name||r.address_name,lat:+r.y,lng:+r.x,phone:r.phone,kakaoUrl:r.place_url,kakaoId:r.id,cat:catFromKakao(r),catName:(r.category_name||"").split(">").pop().trim(),dist:r.distance})):[];
      if(status===ok.ERROR) SR.err="검색 중 문제가 생겼어요. 잠시 후 다시 해 주세요.";
      SR.items=saved.concat(found); renderSR(); res();
    },{location:c,sort:window.kakao.maps.services.SortBy.ACCURACY,size:15});
  });
}
function renderSR(){
  const box=$("#sres"); if(!box) return; const q=SR.q.trim();
  if(!q){ box.hidden=true; box.innerHTML=""; return; }
  let h=SR.items.map((r,i)=>`<button class="sr" data-sr="${i}"><span>${r.saved?"📍":(CATS[r.cat]||CATS.etc).i}</span><span class="grow"><b>${esc(r.name)}</b><span class="small muted">${r.saved?"찍어둔 곳 · ":""}${esc(r.catName?r.catName+" · ":"")}${esc(r.address||"")}</span></span>${r.dist?`<span class="small muted mono">${r.dist>=1000?(r.dist/1000).toFixed(1)+"km":r.dist+"m"}</span>`:""}</button>`).join("");
  if(SR.busy&&!SR.items.length) h+=`<div class="small muted" style="padding:10px 14px">찾는 중…</div>`;
  else if(!SR.items.length) h+=`<div class="small muted" style="padding:10px 14px">검색 결과가 없어요. 다른 이름이나 동네를 붙여 검색해 보세요.</div>`;
  if(SR.err) h+=`<div class="small" style="padding:4px 14px 10px;color:var(--ye)">${esc(SR.err)}</div>`;
  box.innerHTML=h; box.hidden=false;
}
function chooseResult(r){
  $("#sres").hidden=true; $("#mapQ").blur(); S.mapMode="map"; S.routePlan=null;
  if(r.placeId){ S.sel=r.placeId; S.temp=null; clearTemp(); }
  else { S.sel=null; S.temp=r; showTemp(r); }
  render(); panTo(r.lat,r.lng,Math.min(K.map?K.map.getLevel():4,4));
}

/* ---------- PLANS ---------- */
function renderPlans(){
  const today=todayStr();
  const up=S.plans.filter(p=>p.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
  const past=S.plans.filter(p=>p.date<today).sort((a,b)=>b.date.localeCompare(a.date));
  let h=`<div class="wrap"><div class="row between"><h2>데이트 플랜</h2><button class="btn primary" data-act="newPlan">＋ 새 플랜</button></div>`;
  if(!S.plans.length) h+=`<div class="empty"><b>계획된 데이트가 없어요</b><span class="small">날짜와 출발 시간, 가고 싶은 곳을 고르면<br>가장 짧은 동선과 시간표를 자동으로 짜 줘요.</span><button class="btn primary" data-act="newPlan">첫 플랜 짜기</button></div>`;
  up.forEach(p=>h+=planCard(p,false));
  if(past.length){ h+=`<div class="eyebrow" style="margin-top:8px">지난 데이트</div>`; past.forEach(p=>h+=planCard(p,true)); }
  $("#v-plan").innerHTML=h+`</div>`;
}
function planCard(p,isPast){
  const d=parseD(p.date), open=S.openPlan===p.id, t=timeline(p), dd=dayDiff(parseD(todayStr()),d);
  let h=`<div class="card plan"><div class="plan-head" data-toggle-plan="${p.id}" style="cursor:pointer"><div class="datebox ${isPast?"past":""}"><div class="m">${d.getMonth()+1}월 ${WD[d.getDay()]}</div><div class="d">${d.getDate()}</div></div>
    <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:16px;overflow-wrap:anywhere">${esc(p.title||"데이트")}</div>
    <div class="small muted">${isPast?"지난 데이트":dd===0?"오늘":dd===1?"내일":"D-"+dd} · <span class="mono">${esc(p.startTime||"")}–${toHM(t.end)}</span> · ${t.rows.length}곳</div>
    ${!open?`<div class="small" style="margin-top:2px;overflow-wrap:anywhere">${t.rows.map(r=>esc(r.place.name)).join(" → ")}</div>`:""}</div><span class="muted">${open?"▴":"▾"}</span></div>`;
  if(open){
    h+=`<div class="sum"><span>총 이동 <b>${t.totalKm.toFixed(1)}km</b></span><span>이동 시간 <b>약 ${t.moveMin}분</b></span><span>끝나는 시간 <b>${toHM(t.end)}</b></span></div><div class="tl">`;
    if(t.start) h+=`<div class="tl-stop"><div class="tl-time">${esc(p.startTime)}</div><div class="tl-rail"><div class="tl-num start">출</div></div><div class="tl-body"><div class="t">${esc(t.start.name)}에서 출발</div></div></div>`;
    t.rows.forEach((r,i)=>{
      if(r.leg) h+=`<div class="tl-leg"><div></div><div class="tl-rail"></div><div class="info">${r.leg.mode} 약 ${r.leg.min}분 · ${r.leg.d<1?Math.round(r.leg.d*1000)+"m":r.leg.d.toFixed(1)+"km"} · <a href="${esc(kakaoRoute(r.from,r.place))}" target="_blank" rel="noopener">카카오맵 길찾기</a></div></div>`;
      const c=CATS[r.place.cat]||CATS.etc;
      h+=`<div class="tl-stop"><div class="tl-time">${toHM(r.arrive)}</div><div class="tl-rail"><div class="tl-num">${i+1}</div></div><div class="tl-body">
        <div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><span class="t">${c.i} ${esc(r.place.name)}</span><span class="small muted mono" style="white-space:nowrap">~${toHM(r.leave)}</span></div>
        <div class="row between"><span class="stepper"><button data-stay="${p.id}|${i}|-10" aria-label="10분 줄이기">−</button><span class="small mono">${r.stay}분</span><button data-stay="${p.id}|${i}|10" aria-label="10분 늘리기">＋</button></span>
        <span class="row" style="gap:2px"><button class="btn sm ghost" data-move="${p.id}|${i}|-1" ${i===0?"disabled":""} aria-label="위로">↑</button><button class="btn sm ghost" data-move="${p.id}|${i}|1" ${i===t.rows.length-1?"disabled":""} aria-label="아래로">↓</button><button class="btn sm ghost" data-rmstop="${p.id}|${i}" aria-label="빼기">✕</button></span></div></div></div>`;
    });
    h+=`</div>`;
    if(!t.rows.length) h+=`<p class="small muted" style="margin:0">아직 들를 곳이 없어요. ‘장소 고르기’로 추가해 주세요.</p>`;
    h+=`<p class="small muted" style="margin:0">이동 시간은 거리로 계산한 예상치예요. 정확한 시간은 구간별 ‘카카오맵 길찾기’로 확인하세요.</p>`;
    h+=`<div class="row"><button class="btn sm primary" data-opt="${p.id}">동선 최적화</button><button class="btn sm" data-edit-plan="${p.id}">장소 고르기·수정</button><button class="btn sm" data-route="${p.id}">지도에서 보기</button></div>`;
    const cl=p.checklist||[];
    h+=`<div><h3 style="margin-bottom:4px">준비물 · 할 일 <span class="muted small">${cl.filter(c=>c.done).length}/${cl.length}</span></h3>
      ${cl.map((c,i)=>`<label class="check ${c.done?"done":""}"><input type="checkbox" data-check="${p.id}|${i}" ${c.done?"checked":""}><span style="flex:1;overflow-wrap:anywhere">${esc(c.t)}</span><button class="btn sm ghost" data-rmcheck="${p.id}|${i}" aria-label="삭제">✕</button></label>`).join("")}
      <form class="row" data-addcheck="${p.id}" style="flex-wrap:nowrap;margin-top:6px"><div class="field" style="flex:1"><input id="ck-${p.id}" placeholder="예: 식당 예약, 보조배터리" autocomplete="off"></div><button class="btn sm">추가</button></form></div>`;
    if(p.note) h+=`<div class="small" style="background:var(--sunk);border-radius:12px;padding:10px;overflow-wrap:anywhere">${esc(p.note)}</div>`;
    h+=`<div class="row between"><button class="btn sm" data-plan-mem="${p.id}">이 날 추억 남기기</button><button class="btn sm danger" data-delplan="${p.id}">삭제</button></div>`;
  }
  return h+`</div>`;
}
async function patchPlan(id,fn){ const p=S.plans.find(x=>x.id===id); if(!p) return; const d=JSON.parse(JSON.stringify(p)); delete d.id; fn(d); try{ await save("plans",id,d);}catch{} }

/* ---------- MEMORIES ---------- */
function renderMems(){
  const ms=S.memories.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  let h=`<div class="wrap"><div class="row between"><h2>우리의 추억</h2><button class="btn primary" data-act="newMem">＋ 추억 남기기</button></div>`;
  if(!ms.length) h+=`<div class="empty"><b>첫 추억을 남겨 보세요</b><span class="small">사진과 한 줄 일기를 남기면 날짜별로 차곡차곡 쌓여요.<br>다녀온 장소와 연결하면 지도에도 ✓ 표시돼요.</span><button class="btn primary" data-act="newMem">추억 남기기</button></div>`;
  let lastM="";
  ms.forEach(m=>{
    const mk=(m.date||"").slice(0,7); if(mk!==lastM){ lastM=mk; const d=parseD(m.date); h+=`<div class="month">${d.getFullYear()}년 ${d.getMonth()+1}월</div>`; }
    const ph=m.photos||[]; const pl=m.placeId&&placeById(m.placeId);
    h+=`<div class="card mem">${ph.length?`<div class="photos n${Math.min(ph.length,3)}">${ph.slice(0,6).map((x,i)=>`<button data-lightbox="${m.id}|${i}" aria-label="사진 크게 보기">${imgTag(x,'loading="lazy"')}</button>`).join("")}</div>`:""}
      <div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><div style="min-width:0"><div style="font-weight:800;font-size:16px;overflow-wrap:anywhere">${esc(m.title||"")}</div><div class="small muted">${esc(korDate(m.date))}${pl?" · 📍"+esc(pl.name):""}</div></div>${m.rating?`<span class="stars" aria-label="${m.rating}점">${"♥".repeat(m.rating)}</span>`:""}</div>
      ${m.text?`<div style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(m.text)}</div>`:""}
      <div class="row between"><span class="chip ${m.by==="HS"?"hs":m.by==="YE"?"ye":""}">${m.by?esc(ME_NAME[m.by])+"가 남김":""}</span><button class="btn sm ghost" data-edit-mem="${m.id}">수정</button></div></div>`;
  });
  $("#v-mem").innerHTML=h+`</div>`;
}

/* =========================================================
   Sheets
   ========================================================= */
function openSheet(html,onReady){
  const L=$("#layer"); L.innerHTML=`<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const scrim=$(".scrim",L); scrim.addEventListener("click",e=>{ if(e.target===scrim) closeSheet(); });
  onReady&&onReady($(".sheet",L));
}
function closeSheet(){ $("#layer").innerHTML=""; }

// small reusable "search a place" field used for start points
function placeSearchField(sh,inputId,listId,onPick){
  const inp=$("#"+inputId,sh), list=$("#"+listId,sh); let t;
  inp.addEventListener("input",()=>{ clearTimeout(t); t=setTimeout(()=>{ const q=inp.value.trim(); if(!q||!K.ps){ list.innerHTML=K.ps?"":`<div class="small muted">지도 탭을 한 번 연 뒤 검색할 수 있어요.</div>`; return; }
    K.ps.keywordSearch(q,(data,st)=>{ if(st!==window.kakao.maps.services.Status.OK){ list.innerHTML=`<div class="small muted">결과가 없어요</div>`; return; }
      list.innerHTML=data.slice(0,5).map((r,i)=>`<button type="button" class="pick" data-i="${i}" style="border:0;text-align:left"><span class="grow"><b>${esc(r.place_name)}</b><br><span class="small muted">${esc(r.road_address_name||r.address_name)}</span></span></button>`).join("");
      list.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{ const r=data[+b.dataset.i]; onPick({name:r.place_name,lat:+r.y,lng:+r.x}); list.innerHTML=""; inp.value=r.place_name; });
    }); },300); });
}
function settingsSheet(){
  let home=S.settings.home&&S.settings.home.lat?S.settings.home:null;
  openSheet(`<h2>설정</h2>
    <div class="field"><label for="setSince">처음 만난 날 (1일)</label><input type="date" id="setSince" value="${esc(S.settings.since||"")}"></div>
    <div class="field"><label for="setHomeQ">자주 출발하는 곳</label><input id="setHomeQ" value="${esc(home?home.name:"")}" placeholder="예: 동대구역, 계명대 성서캠퍼스" autocomplete="off"><div id="setHomeList" class="picklist"></div></div>
    <div class="row between"><span class="small muted">로그인: ${esc(S.email)} (${esc(ME_NAME[S.me]||"")})</span><button class="btn sm" id="logout">로그아웃</button></div>
    <div class="row"><button class="btn" data-act="close" style="flex:1">닫기</button><button class="btn primary" id="setSave" style="flex:2">저장</button></div>`,sh=>{
    placeSearchField(sh,"setHomeQ","setHomeList",p=>{ home=p; });
    $("#logout",sh).onclick=()=>{ closeSheet(); sb.auth.signOut(); };
    $("#setSave",sh).onclick=async()=>{ const d={...S.settings,since:$("#setSince",sh).value,home:$("#setHomeQ",sh).value.trim()?home:null}; try{ await save("meta","settings",d); closeSheet(); toast("저장했어요"); }catch{} };
  });
}
function placeSheet(p,pre){
  const isNew=!p; p=p||{cat:pre&&pre.cat||"food",name:pre&&pre.name||"",address:pre&&pre.address||"",memo:"",stay:(CATS[pre&&pre.cat]||CATS.food).stay};
  openSheet(`<h2>${isNew?"가고 싶은 곳 저장":"장소 수정"}</h2>
    ${isNew&&pre&&pre.address?`<div class="small muted">📍 ${esc(pre.address)}</div>`:""}
    <div class="field"><label for="pName">장소 이름</label><input id="pName" value="${esc(p.name||"")}" placeholder="예: 수성못 오리배" autocomplete="off"></div>
    <div class="two"><div class="field"><label for="pCat">종류</label><select id="pCat">${Object.entries(CATS).map(([k,c])=>`<option value="${k}" ${p.cat===k?"selected":""}>${c.i} ${c.l}</option>`).join("")}</select></div>
    <div class="field"><label for="pStay">머무는 시간(분)</label><input id="pStay" type="number" inputmode="numeric" min="0" step="10" value="${p.stay??(CATS[p.cat]||CATS.etc).stay}"></div></div>
    <div class="field"><label for="pMemo">메모</label><textarea id="pMemo" placeholder="예: 평일 저녁 웨이팅 짧음, 창가 자리">${esc(p.memo||"")}</textarea></div>
    ${isNew?`<label class="check"><input type="checkbox" id="pLike" checked><span>나도 가고 싶어요 ♥</span></label>`:""}
    <div class="row">${isNew?"":`<button class="btn danger" id="pDel">삭제</button>`}<button class="btn" data-act="close" style="flex:1">취소</button><button class="btn primary" id="pSave" style="flex:2">저장</button></div>`,sh=>{
    $("#pCat",sh).onchange=e=>{ $("#pStay",sh).value=CATS[e.target.value].stay; };
    if(isNew&&!p.name) setTimeout(()=>$("#pName",sh).focus(),50);
    $("#pSave",sh).onclick=async()=>{
      const name=$("#pName",sh).value.trim(); if(!name){ $("#pName",sh).focus(); toast("장소 이름을 적어 주세요"); return; }
      const d={...p}; delete d.id; Object.assign(d,{name,cat:$("#pCat",sh).value,stay:Math.max(0,+$("#pStay",sh).value||0),memo:$("#pMemo",sh).value.trim()});
      if(isNew){ Object.assign(d,{lat:pre.lat,lng:pre.lng,address:pre.address||"",phone:pre.phone||"",kakaoUrl:pre.kakaoUrl||"",kakaoId:pre.kakaoId||"",addedBy:S.me,likes:{},visited:false,createdAt:Date.now()}); if($("#pLike",sh).checked) d.likes[S.me]=true; }
      const id=isNew?uid():p.id;
      try{ await save("places",id,d); closeSheet(); toast(isNew?"저장했어요":"수정했어요"); S.sel=id; S.temp=null; clearTemp(); render(); }catch{}
    };
    const db=$("#pDel",sh); if(db){ let armed=false; db.onclick=async()=>{ if(!armed){armed=true;db.textContent="한 번 더 누르면 삭제";return;} try{ await del("places",p.id); closeSheet(); S.sel=null; toast("삭제했어요"); }catch{} }; }
  });
}
function planSheet(plan){
  const isNew=!plan; const nextSat=fmtD(addDays(new Date(),((6-new Date().getDay()+7)%7)||7));
  plan=plan||{title:"",date:nextSat,startTime:"11:00",start:S.settings.home||null,stops:[],checklist:[]};
  let start=startPointOf(plan);
  const chosen=new Set((plan.stops||[]).map(s=>s.placeId)); const order={both:0,hs:1,ye:1,none:2};
  const cands=S.places.slice().sort((a,b)=>(chosen.has(b.id)-chosen.has(a.id))||(a.visited-b.visited)||(order[likeState(a)]-order[likeState(b)]));
  const homeOpt=S.settings.home&&S.settings.home.lat?`<button type="button" class="chip" id="plHome">🏠 ${esc(S.settings.home.name)}</button>`:"";
  openSheet(`<h2>${isNew?"새 데이트 플랜":"플랜 수정"}</h2>
    <div class="field"><label for="plTitle">제목</label><input id="plTitle" value="${esc(plan.title)}" placeholder="예: 수성못 가을 산책 데이트" autocomplete="off"></div>
    <div class="two"><div class="field"><label for="plDate">날짜</label><input type="date" id="plDate" value="${esc(plan.date)}"></div><div class="field"><label for="plTime">출발 시간</label><input type="time" id="plTime" value="${esc(plan.startTime)}"></div></div>
    <div class="field"><label for="plStartQ">출발 장소 <span class="muted">(비우면 첫 장소에서 시작)</span></label><input id="plStartQ" value="${esc(start?start.name:"")}" placeholder="역·학교·집 근처 검색" autocomplete="off"><div class="row">${homeOpt}<button type="button" class="chip" id="plNoStart">출발지 없음</button></div><div id="plStartList" class="picklist"></div></div>
    <div class="field"><label>들를 곳 고르기 <span id="plCount" class="muted"></span></label>
      <div class="picklist">${cands.length?cands.map(p=>`<label class="pick"><input type="checkbox" value="${p.id}" ${chosen.has(p.id)?"checked":""}><span class="dot" style="background:${colorOf(p)}"></span><span class="grow"><b style="overflow-wrap:anywhere">${esc(p.name)}</b><br><span class="small muted">${(CATS[p.cat]||CATS.etc).l}${p.address?" · "+esc(p.address):""}${p.visited?" · 다녀옴":""}</span></span></label>`).join(""):`<div class="small muted">먼저 ‘가고 싶은 곳’ 탭에서 장소를 저장하면 여기서 고를 수 있어요.</div>`}</div></div>
    <label class="check"><input type="checkbox" id="plOpt" checked><span>저장할 때 가장 짧은 동선으로 순서 정리</span></label>
    <div class="field"><label for="plNote">메모</label><textarea id="plNote" placeholder="예: 저녁은 7시 예약, 비 오면 실내 코스로">${esc(plan.note||"")}</textarea></div>
    <div class="row"><button class="btn" data-act="close" style="flex:1">취소</button><button class="btn primary" id="plSave" style="flex:2">저장</button></div>`,sh=>{
    const upd=()=>{ $("#plCount",sh).textContent=`${sh.querySelectorAll(".pick input:checked").length}곳 선택`; }; upd();
    sh.querySelectorAll(".pick input").forEach(i=>i.onchange=upd);
    placeSearchField(sh,"plStartQ","plStartList",p=>{ start=p; });
    const hb=$("#plHome",sh); if(hb) hb.onclick=()=>{ start=S.settings.home; $("#plStartQ",sh).value=start.name; };
    $("#plNoStart",sh).onclick=()=>{ start=null; $("#plStartQ",sh).value=""; };
    $("#plSave",sh).onclick=async()=>{
      const ids=[...sh.querySelectorAll(".pick input:checked")].map(i=>i.value);
      const oldStay=Object.fromEntries((plan.stops||[]).map(s=>[s.placeId,s.stay]));
      const keepOrder=(plan.stops||[]).map(s=>s.placeId).filter(id=>ids.includes(id)).concat(ids.filter(id=>!chosen.has(id)));
      let stops=keepOrder.map(id=>{ const pl=placeById(id); return {placeId:id,stay:oldStay[id]??(pl.stay??(CATS[pl.cat]||CATS.etc).stay)}; });
      const d={...plan}; delete d.id;
      Object.assign(d,{title:$("#plTitle",sh).value.trim()||"데이트",date:$("#plDate",sh).value||todayStr(),startTime:$("#plTime",sh).value||"11:00",start:$("#plStartQ",sh).value.trim()&&start?start:null,note:$("#plNote",sh).value.trim()});
      if($("#plOpt",sh).checked){ const st=startPointOf(d); stops=optimizeOrder(st,stops.map(s=>({...s,place:placeById(s.placeId)}))).map(({place,...s})=>s); }
      d.stops=stops; if(isNew){ d.createdBy=S.me; d.createdAt=Date.now(); if(!d.checklist) d.checklist=[]; }
      const id=isNew?uid():plan.id;
      try{ await save("plans",id,d); closeSheet(); S.openPlan=id; S.tab="plan"; lsSet("hsye.tab","plan"); render(); toast(isNew?"플랜을 만들었어요":"수정했어요"); }catch{}
    };
  });
}
function memSheet(m,preset){
  const isNew=!m; m=m||{date:todayStr(),title:"",text:"",rating:0,photos:[],...(preset||{})};
  let photos=(m.photos||[]).slice(), rating=m.rating||0; const uploaded=[];
  openSheet(`<h2>${isNew?"추억 남기기":"추억 수정"}</h2>
    <div class="two"><div class="field"><label for="mDate">날짜</label><input type="date" id="mDate" value="${esc(m.date)}"></div>
    <div class="field"><label for="mPlace">장소 (선택)</label><select id="mPlace"><option value="">선택 안 함</option>${S.places.map(p=>`<option value="${p.id}" ${m.placeId===p.id?"selected":""}>${esc(p.name)}</option>`).join("")}</select></div></div>
    <div class="field"><label for="mTitle">한 줄 제목</label><input id="mTitle" value="${esc(m.title)}" placeholder="예: 첫눈 오던 날 김광석길" autocomplete="off"></div>
    <div class="field"><label for="mText">그날 이야기</label><textarea id="mText" placeholder="무엇을 먹고, 무슨 얘기를 했는지 남겨 보세요">${esc(m.text||"")}</textarea></div>
    <div class="field"><label>오늘의 하트</label><div class="row" id="mRate"></div></div>
    <div class="field"><label for="mFiles">사진</label><div class="photos" id="mPhotos" style="grid-template-columns:repeat(4,1fr)"></div><input type="file" id="mFiles" accept="image/*" multiple><span class="small muted" id="mUpMsg"></span></div>
    <div class="row">${isNew?"":`<button class="btn danger" id="mDel">삭제</button>`}<button class="btn" data-act="close" style="flex:1">취소</button><button class="btn primary" id="mSave" style="flex:2">저장</button></div>`,sh=>{
    const drawRate=()=>{ $("#mRate",sh).innerHTML=[1,2,3,4,5].map(n=>`<button type="button" class="heart ${n<=rating?"on ye":""}" data-r="${n}" aria-label="${n}점">♥</button>`).join(""); };
    const drawPh=()=>{ $("#mPhotos",sh).innerHTML=photos.map((p,i)=>`<button type="button" data-rmph="${i}" aria-label="사진 빼기" style="position:relative">${p.preview?`<img src="${p.preview}" alt="">`:imgTag(p)}<span style="position:absolute;top:2px;right:4px;color:#fff;font-weight:800;text-shadow:0 0 3px #000">✕</span></button>`).join(""); };
    drawRate(); drawPh();
    $("#mRate",sh).onclick=e=>{ const b=e.target.closest("[data-r]"); if(b){ rating=+b.dataset.r===rating?0:+b.dataset.r; drawRate(); } };
    $("#mPhotos",sh).onclick=e=>{ const b=e.target.closest("[data-rmph]"); if(b){ photos.splice(+b.dataset.rmph,1); drawPh(); } };
    let busy=0; const msg=$("#mUpMsg",sh);
    $("#mFiles",sh).onchange=async e=>{
      const files=[...e.target.files]; e.target.value="";
      for(const f of files){ busy++; msg.textContent=`사진 올리는 중… (${busy})`;
        try{
          const blob=await resizeImage(f); const path=`${new Date().getFullYear()}/${uid()}.jpg`;
          const {error}=await sb.storage.from("photos").upload(path,blob,{contentType:"image/jpeg"});
          if(error) throw error;
          const preview=URL.createObjectURL(blob); photos.push({path,preview}); uploaded.push(path); drawPh();
        }catch(err){ toast("사진을 올리지 못했어요"); }
        busy--; msg.textContent=busy?`사진 올리는 중… (${busy})`:"";
      }
    };
    $("#mSave",sh).onclick=async()=>{
      if(busy){ toast("사진 업로드가 끝나면 저장할게요"); return; }
      const title=$("#mTitle",sh).value.trim(); if(!title){ $("#mTitle",sh).focus(); toast("한 줄 제목을 적어 주세요"); return; }
      const d={...m}; delete d.id;
      Object.assign(d,{date:$("#mDate",sh).value||todayStr(),placeId:$("#mPlace",sh).value,title,text:$("#mText",sh).value.trim(),rating,photos:photos.map(({path,url})=>path?{path}:{url})});
      if(isNew){ d.by=S.me; d.createdAt=Date.now(); }
      // remove photos that were taken out of an existing memory
      const removed=(m.photos||[]).filter(o=>o.path&&!photos.some(x=>x.path===o.path)).map(o=>o.path);
      const id=isNew?uid():m.id;
      try{ await save("memories",id,d);
        if(removed.length) sb.storage.from("photos").remove(removed).catch(()=>{});
        if(d.placeId){ const p=placeById(d.placeId); if(p&&!p.visited){ const pd={...p}; delete pd.id; pd.visited=true; save("places",p.id,pd).catch(()=>{}); } }
        closeSheet(); toast("추억을 저장했어요"); S.tab="mem"; lsSet("hsye.tab","mem"); render(); }catch{}
    };
    const cancelUploads=()=>{ const keep=new Set(photos.map(p=>p.path)); const orphan=uploaded.filter(p=>!keep.has(p)); if(orphan.length) sb.storage.from("photos").remove(orphan).catch(()=>{}); };
    sh.querySelector('[data-act="close"]').addEventListener("click",()=>{ if(uploaded.length) sb.storage.from("photos").remove(uploaded).catch(()=>{}); });
    $("#mSave",sh).addEventListener("click",cancelUploads);
    const db=$("#mDel",sh); if(db){ let armed=false; db.onclick=async()=>{ if(!armed){armed=true;db.textContent="한 번 더 누르면 삭제";return;}
      try{ await del("memories",m.id); const paths=(m.photos||[]).filter(p=>p.path).map(p=>p.path).concat(uploaded); if(paths.length) sb.storage.from("photos").remove(paths).catch(()=>{}); closeSheet(); toast("삭제했어요"); }catch{} }; }
  });
}

/* =========================================================
   Events
   ========================================================= */
function goTab(t){ S.tab=t; lsSet("hsye.tab",t); render(); }
$("#tabs").addEventListener("click",e=>{ const b=e.target.closest("[data-tab]"); if(b) goTab(b.dataset.tab); });
$("#settingsBtn").onclick=settingsSheet;
window.addEventListener("resize",()=>{ if(K.map) K.map.relayout(); });

document.addEventListener("submit",async e=>{
  const f=e.target.closest("[data-addcheck]"); if(!f) return; e.preventDefault();
  const id=f.dataset.addcheck, inp=$("input",f), t=inp.value.trim(); if(!t) return; inp.value="";
  await patchPlan(id,d=>{ d.checklist=(d.checklist||[]).concat({t,done:false}); });
});
document.addEventListener("change",async e=>{
  const c=e.target.closest("[data-check]"); if(!c) return; const [id,i]=c.dataset.check.split("|");
  await patchPlan(id,d=>{ d.checklist[+i].done=c.checked; });
});
document.addEventListener("click",async e=>{
  const t=e.target.closest("button,[data-goto],[data-open-plan],[data-toggle-plan],[data-show-place]"); if(!t) return;
  const ds=t.dataset;
  if(ds.act){
    const a=ds.act;
    if(a==="close") closeSheet();
    else if(a==="settings") settingsSheet();
    else if(a==="newPlan") planSheet();
    else if(a==="newMem") memSheet();
    else if(a==="closePop"){ S.sel=null; syncPins(); renderPop(); }
    else if(a==="closeTemp"){ S.temp=null; clearTemp(); renderPop(); }
    else if(a==="addTemp") placeSheet(null,S.temp);
    else if(a==="cancelPick"){ S.pick=null; render(); }
    else if(a==="pickNew"){ S.pick="new"; S.sel=null; S.temp=null; clearTemp(); render(); }
    else if(a==="clearRoute"){ S.routePlan=null; render(); }
    else if(a==="fitAll") fitAll();
    else if(a==="myLoc"){
      if(!navigator.geolocation){ toast("이 기기에서는 위치를 쓸 수 없어요"); return; }
      navigator.geolocation.getCurrentPosition(p=>panTo(p.coords.latitude,p.coords.longitude,4),()=>toast("위치 권한을 허용하면 내 위치로 이동해요"),{enableHighAccuracy:true,timeout:8000});
    }
    return;
  }
  if(ds.sr){ chooseResult(SR.items[+ds.sr]); return; }
  if(ds.goto){ goTab(ds.goto); return; }
  if(ds.openPlan){ S.openPlan=ds.openPlan; goTab("plan"); return; }
  if(ds.togglePlan){ S.openPlan=S.openPlan===ds.togglePlan?null:ds.togglePlan; render(); return; }
  if(ds.mode){ S.mapMode=ds.mode; render(); return; }
  if(ds.filter){ S.filter=ds.filter; render(); return; }
  if(ds.cat){ S.cat=ds.cat; render(); return; }
  if(ds.like){ const p=placeById(ds.like); if(!p) return; const d={...p}; delete d.id; d.likes={...(p.likes||{})}; if(d.likes[S.me]) delete d.likes[S.me]; else d.likes[S.me]=true; save("places",p.id,d).catch(()=>{}); return; }
  if(ds.editPlace) return placeSheet(placeById(ds.editPlace));
  if(ds.showPlace){ const p=placeById(ds.showPlace); if(!p) return; S.mapMode="map"; S.sel=p.id; S.routePlan=null; S.temp=null; clearTemp(); goTab("map"); setTimeout(()=>panTo(p.lat,p.lng,4),60); return; }
  if(ds.pick){ S.pick=ds.pick; S.sel=null; const p=placeById(ds.pick); render(); if(p) panTo(p.lat,p.lng,3); return; }
  if(ds.visit){ const p=placeById(ds.visit); const d={...p}; delete d.id; d.visited=!p.visited; save("places",p.id,d).then(()=>toast(d.visited?"다녀온 곳으로 표시했어요":"가고 싶은 곳으로 되돌렸어요")).catch(()=>{}); return; }
  if(ds.stay){ const [id,i,dv]=ds.stay.split("|"); const pl=S.plans.find(x=>x.id===id); const cur=timeline(pl).rows[+i]; await patchPlan(id,d=>{ const k=d.stops.findIndex(s=>s.placeId===cur.placeId); d.stops[k].stay=Math.max(0,cur.stay+ +dv); }); return; }
  if(ds.move){ const [id,i,dv]=ds.move.split("|"); const pl=S.plans.find(x=>x.id===id); const rows=planStops(pl).map(s=>s.placeId); const a=+i,b=a+ +dv; [rows[a],rows[b]]=[rows[b],rows[a]]; await patchPlan(id,d=>{ const m=Object.fromEntries(d.stops.map(s=>[s.placeId,s])); d.stops=rows.map(r=>m[r]).concat(d.stops.filter(s=>!rows.includes(s.placeId))); }); return; }
  if(ds.rmstop){ const [id,i]=ds.rmstop.split("|"); const pl=S.plans.find(x=>x.id===id); const pid=planStops(pl)[+i].placeId; await patchPlan(id,d=>{ d.stops=d.stops.filter(s=>s.placeId!==pid); }); return; }
  if(ds.opt){ const pl=S.plans.find(x=>x.id===ds.opt); const before=timeline(pl).totalKm; let after=before;
    await patchPlan(ds.opt,d=>{ const st=startPointOf(d); const valid=planStops(d); d.stops=optimizeOrder(st,valid).map(({place,...s})=>s); after=timeline(d).totalKm; });
    toast(after<before-0.05?`이동 거리 ${before.toFixed(1)}→${after.toFixed(1)}km로 줄였어요`:"이미 가장 짧은 동선이에요"); return; }
  if(ds.editPlan) return planSheet(S.plans.find(x=>x.id===ds.editPlan));
  if(ds.route){ const pl=S.plans.find(x=>x.id===ds.route); S.routePlan=ds.route; S.mapMode="map"; S.sel=null; S.temp=null; clearTemp(); goTab("map"); setTimeout(()=>fitRoute(pl),80); return; }
  if(ds.rmcheck){ const [id,i]=ds.rmcheck.split("|"); await patchPlan(id,d=>{ d.checklist.splice(+i,1); }); return; }
  if(ds.delplan){ if(t.dataset.armed!=="1"){ t.dataset.armed="1"; t.textContent="한 번 더 누르면 삭제"; return; } await del("plans",ds.delplan).catch(()=>{}); S.openPlan=null; toast("플랜을 삭제했어요"); return; }
  if(ds.planMem){ const pl=S.plans.find(x=>x.id===ds.planMem); const st=planStops(pl); return memSheet(null,{date:pl.date,title:pl.title||"",placeId:st[0]?st[0].placeId:""}); }
  if(ds.editMem) return memSheet(S.memories.find(x=>x.id===ds.editMem));
  if(ds.lightbox){ const [id,i]=ds.lightbox.split("|"); const m=S.memories.find(x=>x.id===id); const src=photoSrc(m.photos[+i]); if(!src) return; const L=$("#layer"); L.innerHTML=`<div class="lightbox" role="dialog" aria-label="사진"><img src="${esc(src)}" alt=""></div>`; $(".lightbox",L).onclick=()=>L.innerHTML=""; return; }
});

/* =========================================================
   Boot
   ========================================================= */
let booted=false;
async function enter(session){
  if(!session){ booted=false; S.ready=false; loginScreen(); return; }
  const email=(session.user.email||"").toLowerCase();
  const me=MEMBERS[email]; if(!me){ notMemberScreen(email); return; }
  S.me=me; S.email=email;
  if(booted) return; booted=true;
  showGate(`<p class="muted" style="text-align:center;margin:0">불러오는 중…</p>`);
  try{ await loadAll(); }catch(e){ booted=false; showGate(`<h2>데이터를 불러오지 못했어요</h2><p class="small muted" style="margin:0">Supabase에서 schema.sql 을 실행했는지, 로그인 이메일이 schema.sql 에 적혀 있는지 확인해 주세요.</p><p class="small err" style="margin:0">${esc(e.message||"")}</p><button class="btn" onclick="location.reload()">다시 시도</button>`); return; }
  subscribe(); render();
  loadKakao().catch(()=>{});
}
async function boot(){
  if(!CFG.kakaoJsKey||!CFG.supabaseUrl||!CFG.supabaseAnonKey) return configScreen();
  sb=createClient(CFG.supabaseUrl,CFG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  const {data}=await sb.auth.getSession(); await enter(data.session);
  sb.auth.onAuthStateChange((ev,session)=>{ if(ev==="SIGNED_OUT"){ booted=false; S.ready=false; loginScreen(); } else if(session) enter(session); });
}
if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
boot();
