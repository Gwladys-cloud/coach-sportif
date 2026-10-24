import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB8S_CBtFoSLmT_eKimT3dWCMlgXJ1qx-Q",
  authDomain: "coach-sportif-44d71.firebaseapp.com",
  projectId: "coach-sportif-44d71",
  storageBucket: "coach-sportif-44d71.firebasestorage.app",
  messagingSenderId: "272131224021",
  appId: "1:272131224021:web:7f5187e533331410a2cd5c"
};


const $ = (id) => document.getElementById(id);
const TYPES = {aviron:"Aviron en huit",velo:"Vélo intérieur",vtt:"VTT / vélo dehors",renfo:"Renfo",autre:"Autre"};
const MOIS = ["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"];
const KEY = "coach_code_v1";

let db = null, unsub = null, code = null, sessions = [];

function store(get, val){ try{ if(get) return localStorage.getItem(KEY); if(val===null) localStorage.removeItem(KEY); else localStorage.setItem(KEY,val);}catch(e){ return null; } }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtDate(d){ const [y,m,j]=d.split("-").map(Number); return j+" "+MOIS[m-1]; }
function fmtDur(min){ if(!min) return "—"; const h=Math.floor(min/60), m=Math.round(min%60); return h? (h+" h "+String(m).padStart(2,"0")) : (m+" min"); }
function num(v,d=1){ return v==null||v===""||isNaN(v) ? "—" : Number(v).toLocaleString("fr-FR",{maximumFractionDigits:d}); }
function paceSec(p){ if(!p) return null; const m=/^(\d{1,2}):(\d{2})$/.exec(String(p).trim()); return m? (+m[1])*60+(+m[2]) : null; }
function secPace(s){ return Math.floor(s/60)+":"+String(Math.round(s%60)).padStart(2,"0"); }
function isoToday(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }

function bilans(list){
  // list sorted ascending
  let bestAllure=null, bestPointe=null, firstAviron=true; const out={};
  list.forEach(s=>{
    let b={t:"",c:""};
    if(s.type==="aviron"){
      const a=paceSec(s.allure), p=paceSec(s.best); const recs=[];
      if(firstAviron){ b={t:"Point de départ",c:""}; firstAviron=false; }
      else{
        if(a!=null && bestAllure!=null && a<bestAllure) recs.push("allure");
        if(p!=null && bestPointe!=null && p<bestPointe) recs.push("pointe");
        if(recs.length) b={t:recs.length===2?"Records d'allure":"Record d'allure",c:"ok"};
        else if(s.arret!=null && s.arret<=15) b={t:"Peu d'arrêts",c:"ok"};
        else b={t:"Séance d'équipe",c:""};
      }
      if(a!=null) bestAllure = bestAllure==null?a:Math.min(bestAllure,a);
      if(p!=null) bestPointe = bestPointe==null?p:Math.min(bestPointe,p);
    } else if(s.type==="velo"||s.type==="vtt"){
      const d=new Date(s.date+"T12:00:00"), hard = d.getDay()===2 && s.date>="2026-11-02";
      if(s.fcMoy==null) b={t:"Vélo",c:""};
      else if(hard) b= s.fcMoy>=135? {t:"Séance dure réussie",c:"ok"} : {t:"Pas assez intense",c:"warn"};
      else if(s.fcMoy<=130) b={t:"Zone 2 parfaite",c:"ok"};
      else if(s.fcMoy<=135) b={t:"Un peu soutenu",c:"warn"};
      else b={t:"Trop soutenu",c:"warn"};
    } else if(s.type==="renfo"){ b={t:"Renfo fait",c:"ok"}; }
    else b={t:"Séance faite",c:""};
    out[s.id]=b;
  });
  return out;
}

function render(){
  const asc=[...sessions].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  const desc=[...asc].reverse();
  const bl=bilans(asc);
  const rowing=asc.filter(s=>s.type==="aviron" && paceSec(s.allure)!=null);

  // tiles
  const tiles=[];
  if(rowing.length){
    const last=rowing[rowing.length-1], first=rowing[0];
    const diff=paceSec(first.allure)-paceSec(last.allure);
    tiles.push(`<div class="tile"><span class="tl">Allure en bateau</span><b>${esc(last.allure)}</b><span class="tu">/500 m en déplacement · ${fmtDate(last.date)}</span>${diff>0?`<span class="td">−${diff} s depuis le ${fmtDate(first.date)}</span>`:""}</div>`);
    const bests=asc.filter(s=>paceSec(s.best)!=null);
    if(bests.length){ const b=bests.reduce((x,y)=>paceSec(y.best)<paceSec(x.best)?y:x); tiles.push(`<div class="tile"><span class="tl">Meilleure allure</span><b>${esc(b.best)}</b><span class="tu">/500 m · ${fmtDate(b.date)}</span></div>`); }
  }
  const now=new Date(); const mon=new Date(now); mon.setHours(0,0,0,0); mon.setDate(mon.getDate()-((mon.getDay()+6)%7));
  const monIso=new Date(mon.getTime()-mon.getTimezoneOffset()*60000).toISOString().slice(0,10);
  const week=asc.filter(s=>s.date>=monIso);
  tiles.push(`<div class="tile"><span class="tl">Cette semaine</span><b>${week.length}</b><span class="tu">séance${week.length>1?"s":""} · ${fmtDur(week.reduce((t,s)=>t+(+s.duree||0),0))}</span></div>`);
  const withMax=asc.filter(s=>s.fcMax);
  if(withMax.length){ const m=withMax.reduce((x,y)=>y.fcMax>x.fcMax?y:x); tiles.push(`<div class="tile"><span class="tl">FC max vue</span><b>${m.fcMax}</b><span class="tu">bpm · ${TYPES[m.type]||""} ${fmtDate(m.date)}</span></div>`); }
  $("tiles").innerHTML=tiles.join("");

  // bars
  $("bars").innerHTML = rowing.length ? rowing.slice(-8).map(s=>{
    const v=1800/paceSec(s.allure), w=Math.min(100,v*10);
    return `<div class="hb" title="${fmtDate(s.date)} · ${num(v)} km/h${s.dist?" · "+num(s.dist)+" km":""}"><span class="hl">${fmtDate(s.date)}</span><span class="track"><span class="fill" style="width:${w.toFixed(0)}%"></span></span><span class="hv">${num(v)} km/h</span></div>`;
  }).join("") : `<p class="sub">Ajoute une sortie d'aviron avec ton allure en déplacement pour voir ta progression.</p>`;

  // rows
  $("rows").innerHTML = desc.length ? desc.map(s=>{
    const b=bl[s.id]||{t:"",c:""};
    const fc = s.fcMoy||s.fcMax ? `${s.fcMoy||"—"} / ${s.fcMax||"—"}` : "—";
    return `<tr><td>${fmtDate(s.date)}</td><td>${esc(TYPES[s.type]||s.type)}${s.ressenti?` <span class="rs">· ${esc(s.ressenti)}</span>`:""}</td><td>${fmtDur(s.duree)}</td><td>${s.dist?num(s.dist)+" km":"—"}</td><td>${fc}</td><td>${b.t?`<span class="pill ${b.c}">${esc(b.t)}</span>`:""}</td><td><button type="button" class="del" data-id="${esc(s.id)}" aria-label="Supprimer la séance du ${fmtDate(s.date)}">✕</button></td></tr>`;
  }).join("") : `<tr><td colspan="7" class="sub">Aucune séance pour l'instant : ajoute la première avec le formulaire.</td></tr>`;
}

function showCode(msg){
  $("code-card").hidden=false; $("stats-body").hidden=true; $("stats-status").hidden=true;
  $("code-err").hidden=!msg; $("code-err").textContent=msg||"";
}

function connect(c){
  code=c; if(unsub){ unsub(); unsub=null; }
  $("code-card").hidden=true; $("stats-status").hidden=false; $("stats-status").textContent="Chargement de tes séances…";
  const col=collection(db,"espaces",code,"seances");
  unsub=onSnapshot(col, async (snap)=>{
    sessions=snap.docs.map(d=>({id:d.id,...d.data()}));
    $("stats-status").hidden=true; $("stats-body").hidden=false; render(); const fb=$("fab"), st=document.querySelector('section[data-tab="stats"]'); if(fb&&st) fb.hidden=st.hidden;
  }, (err)=>{
    store(false,null);
    showCode(err && err.code==="permission-denied" ? "Ce code ne fonctionne pas, ou la base n'est pas encore configurée. Vérifie-le et réessaie." : "Impossible de joindre la base pour l'instant. Vérifie ta connexion internet et réessaie.");
  });
}

function toggleAviron(){ const av=$("f-type").value==="aviron"; document.querySelectorAll(".row-aviron").forEach(el=>el.hidden=!av); }

function init(){
  window.__statsReady=true;
  try{ db=getFirestore(initializeApp(firebaseConfig)); }catch(e){ $("stats-status").textContent="La base de données n'a pas pu démarrer. Recharge la page."; return; }
  $("f-date").value=isoToday(); toggleAviron();
  $("f-type").addEventListener("change",toggleAviron);
  $("code-form").addEventListener("submit",(e)=>{ e.preventDefault(); const c=$("code-input").value.trim().toLowerCase(); if(c.length<24){ showCode("Le code fait au moins 24 caractères. Recopie-le en entier."); return; } store(false,c); connect(c); });
  $("code-change").addEventListener("click",()=>{ if(unsub){unsub();unsub=null;} store(false,null); $("code-input").value=""; showCode(""); });
  $("add-form").addEventListener("submit", async (e)=>{
    e.preventDefault(); if(!code) return;
    const n=(id)=>{ const v=$(id).value.trim().replace(",","."); return v===""?null:Number(v); };
    const type=$("f-type").value;
    const s={date:$("f-date").value,type,duree:n("f-duree"),dist:n("f-dist"),fcMoy:n("f-fcmoy"),fcMax:n("f-fcmax"),ressenti:$("f-ressenti").value||null,cree:Date.now()};
    if(type==="aviron"){ s.allure=$("f-allure").value.trim()||null; s.best=$("f-best").value.trim()||null; s.arret=n("f-arret"); }
    if(!s.date||!s.duree){ $("f-msg").textContent="Indique au moins la date et la durée."; return; }
    if((s.allure&&paceSec(s.allure)==null)||(s.best&&paceSec(s.best)==null)){ $("f-msg").textContent="Écris les allures sous la forme 3:28."; return; }
    $("f-submit").disabled=true; $("f-msg").textContent="Enregistrement…";
    try{
      await addDoc(collection(db,"espaces",code,"seances"),s);
      $("f-msg").textContent="Séance ajoutée ✓";
      ["f-duree","f-dist","f-fcmoy","f-fcmax","f-allure","f-best","f-arret"].forEach(id=>$(id).value=""); $("f-ressenti").value="";
    }catch(err){ $("f-msg").textContent="La séance n'a pas pu être enregistrée. Vérifie ta connexion et réessaie."; }
    $("f-submit").disabled=false;
  });
  $("rows").addEventListener("click", async (e)=>{
    const btn=e.target.closest(".del"); if(!btn) return;
    if(!btn.classList.contains("confirm")){ btn.classList.add("confirm"); btn.textContent="Supprimer ?"; setTimeout(()=>{ if(btn.isConnected){btn.classList.remove("confirm"); btn.textContent="✕";} },4000); return; }
    btn.disabled=true;
    try{ await deleteDoc(doc(db,"espaces",code,"seances",btn.dataset.id)); }catch(err){ btn.disabled=false; btn.textContent="Échec"; }
  });
  $("imp-btn").addEventListener("click", async ()=>{
    if(!code) return; const msg=$("imp-msg"); let list;
    try{ list=JSON.parse($("imp-text").value.trim()); }catch(e){ msg.textContent="Le texte n'est pas au bon format. Recopie-le en entier, crochets compris."; return; }
    if(!Array.isArray(list)||!list.length){ msg.textContent="Aucune séance trouvée dans le texte."; return; }
    const ok=list.filter(x=>x&&/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&TYPES[x.type]&&x.duree);
    if(!ok.length){ msg.textContent="Aucune séance valide dans le texte."; return; }
    $("imp-btn").disabled=true; msg.textContent="Import en cours…";
    try{
      const col=collection(db,"espaces",code,"seances"), b=writeBatch(db), have=new Set(sessions.map(x=>x.date+"|"+x.type));
      let n=0; ok.forEach(x=>{ if(have.has(x.date+"|"+x.type)) return; const clean={date:x.date,type:x.type,duree:+x.duree,dist:x.dist??null,fcMoy:x.fcMoy??null,fcMax:x.fcMax??null,ressenti:x.ressenti??null,cree:Date.now()}; if(x.type==="aviron"){clean.allure=x.allure??null;clean.best=x.best??null;clean.arret=x.arret??null;} b.set(doc(col),clean); n++; });
      if(n) await b.commit();
      msg.textContent = n ? (n+" séance"+(n>1?"s":"")+" importée"+(n>1?"s":"")+" ✓") : "Ces séances sont déjà dans ton historique.";
      $("imp-text").value="";
    }catch(e){ msg.textContent="L'import n'a pas abouti. Vérifie ta connexion et réessaie."; }
    $("imp-btn").disabled=false;
  });
  const saved=store(true);
  if(saved && saved.length>=24) connect(saved); else showCode("");
}
init();
