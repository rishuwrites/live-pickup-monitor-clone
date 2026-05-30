javascript:(async()=>{

// ─────────────────────────────────────────────────────────────
// 🔧 CONFIG
// ─────────────────────────────────────────────────────────────
const PICKUP_MONITOR_URL="https://script.google.com/macros/s/AKfycbwDjSwykFzMWHerWI0SA_ROS0uKYSpE09eWY5NaLzUlqG39O2h3W3bfzAWsy7-SYVVW/exec";
const FACILITY_CODE="NXS2";
const INTERVAL_MS=3*60*1000; // 3 minutes
const DELAY_MS=300;           // delay between each courier fetch
// ─────────────────────────────────────────────────────────────

const THE16=[
  "BLITZNDD","BLUEDART","BUSYBEESPPD","BusybeesSDD",
  "DELCARTB2B","DELHIVERY","DELHIVERYPDS","DOT",
  "DTDCVB2B","FASTBEETLE","GPSUPPLY","PURPLEDRONE",
  "SHADOWFAX","shreerajxpress","Velocity","XPRESSBEES"
];

// ── Remove existing panel if re-run ──────────────────────────
if(document.getElementById("snapshotPanel"))
  document.getElementById("snapshotPanel").remove();
if(window.__snapshotTimer)
  clearInterval(window.__snapshotTimer);

// ── IST timestamp ─────────────────────────────────────────────
function nowIST(){
  const now=new Date();
  const ist=new Date(now.getTime()+(5.5*60*60*1000));
  return ist.toISOString().replace("T"," ").replace("Z","")+" IST";
}

// ── UI Panel ──────────────────────────────────────────────────
const panel=document.createElement("div");
panel.id="snapshotPanel";
panel.innerHTML=`
  <div id="sp-header">
    <span>📡 Pickup Monitor</span>
    <div style="display:flex;gap:6px;align-items:center">
      <span id="sp-next" style="font-size:11px;color:#8b949e"></span>
      <button id="sp-refresh" title="Refresh Now">🔄</button>
      <button id="sp-close">✖</button>
    </div>
  </div>
  <div id="sp-status">Initialising...</div>
  <div id="sp-grid"></div>
  <div id="sp-footer"></div>
`;
document.body.appendChild(panel);

const spStyle=document.createElement("style");
spStyle.id="snapshotPanelStyle";
spStyle.innerHTML=`
#snapshotPanel{
  position:fixed;bottom:20px;right:20px;width:340px;
  background:#0d1117;color:#c9d1d9;font-family:Consolas,monospace;
  border-radius:12px;z-index:999999;
  box-shadow:0 8px 32px rgba(0,0,0,0.6);
  border:1px solid #30363d;overflow:hidden;
}
#sp-header{
  background:#161b22;padding:10px 14px;
  display:flex;justify-content:space-between;align-items:center;
  font-weight:bold;font-size:13px;border-bottom:1px solid #30363d;
}
#sp-header button{
  background:#21262d;border:1px solid #30363d;color:#c9d1d9;
  border-radius:5px;cursor:pointer;padding:3px 8px;font-size:12px;
}
#sp-header button:hover{background:#30363d}
#sp-status{
  padding:8px 14px;font-size:12px;color:#58a6ff;
  border-bottom:1px solid #21262d;min-height:28px;
}
#sp-grid{
  padding:10px 14px;display:grid;
  grid-template-columns:1fr 1fr;gap:6px;
  max-height:300px;overflow-y:auto;
}
.sp-card{
  background:#161b22;border-radius:7px;padding:7px 10px;
  border-left:3px solid #30363d;font-size:11px;
}
.sp-card.has-count{border-left-color:#e65100}
.sp-card.zero{border-left-color:#2ea043}
.sp-card.error{border-left-color:#f85149}
.sp-name{color:#8b949e;margin-bottom:2px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sp-count{font-size:16px;font-weight:bold}
.sp-count.has-count{color:#ffa657}
.sp-count.zero{color:#3fb950}
.sp-count.error{color:#f85149;font-size:12px}
#sp-footer{
  padding:7px 14px;font-size:10px;color:#484f58;
  border-top:1px solid #21262d;text-align:right;
}
`;
document.head.appendChild(spStyle);

const spStatus=document.getElementById("sp-status");
const spGrid=document.getElementById("sp-grid");
const spFooter=document.getElementById("sp-footer");
const spNext=document.getElementById("sp-next");

// ── Countdown timer ───────────────────────────────────────────
let nextRunAt=null;
let countdownTimer=null;

function startCountdown(){
  if(countdownTimer) clearInterval(countdownTimer);
  nextRunAt=Date.now()+INTERVAL_MS;
  countdownTimer=setInterval(()=>{
    const left=Math.max(0,nextRunAt-Date.now());
    const m=Math.floor(left/60000);
    const s=Math.floor((left%60000)/1000);
    spNext.textContent=`next: ${m}:${s.toString().padStart(2,"0")}`;
    if(left===0) clearInterval(countdownTimer);
  },1000);
}

// ── Session check ─────────────────────────────────────────────
async function checkSession(){
  try{
    const res=await fetch(
      `https://app.nexs.lenskart.com/nexs/manifest/api/v1/fetch/filter?page=0&size=1&sort=createdAt,desc`,
      {method:"GET",credentials:"include",
       headers:{"accept":"application/json","facility-code":FACILITY_CODE,
                "source-domain":"https://app.nexs.lenskart.com"}}
    );
    return res.status!==401&&res.status!==403;
  }catch(e){return false;}
}

// ── Fetch count for one courier ───────────────────────────────
async function fetchCount(courier){
  const res=await fetch(
    `https://app.nexs.lenskart.com/nexs/manifest/api/v1/fetch/filter?page=0&size=150&sort=createdAt,desc&shippingProvider=${encodeURIComponent(courier)}`,
    {method:"GET",credentials:"include",
     headers:{"accept":"application/json","facility-code":FACILITY_CODE,
              "source-domain":"https://app.nexs.lenskart.com"}}
  );
  if(res.status===401||res.status===403) throw new Error("SESSION_EXPIRED");
  if(!res.ok) throw new Error("HTTP "+res.status);
  const data=await res.json();
  return(data?.data?.content||[])
    .filter(item=>item.status==="CREATED"&&item.count>0&&item.shippingProvider===courier)
    .reduce((sum,item)=>sum+item.count,0);
}

// ── Push snapshot to sheet ────────────────────────────────────
async function pushToSheet(counts){
  const RUN_ID="SNAP-"+Math.random().toString(36).slice(2,8).toUpperCase();
  const payload={
    type:"snapshot",
    timestamp:nowIST(),
    runId:RUN_ID,
    facilityCode:FACILITY_CODE,
    counts
  };
  try{
    await fetch(PICKUP_MONITOR_URL,{
      method:"POST",
      mode:"no-cors",
      body:JSON.stringify(payload),
      headers:{"Content-Type":"text/plain"}
    });
    return true;
  }catch(e){
    return false;
  }
}

// ── Render cards ──────────────────────────────────────────────
function renderCards(counts,isError){
  spGrid.innerHTML="";
  THE16.forEach(courier=>{
    const card=document.createElement("div");
    card.className="sp-card";
    const nameDiv=document.createElement("div");
    nameDiv.className="sp-name";
    nameDiv.title=courier;
    nameDiv.textContent=courier;
    const countDiv=document.createElement("div");
    countDiv.className="sp-count";

    if(isError&&counts[courier]===undefined){
      card.classList.add("error");
      countDiv.classList.add("error");
      countDiv.textContent="ERR";
    } else {
      const c=counts[courier]??0;
      if(c>0){
        card.classList.add("has-count");
        countDiv.classList.add("has-count");
        countDiv.textContent="📦 "+c;
      } else {
        card.classList.add("zero");
        countDiv.classList.add("zero");
        countDiv.textContent="✅ 0";
      }
    }
    card.appendChild(nameDiv);
    card.appendChild(countDiv);
    spGrid.appendChild(card);
  });
}

// ── Main fetch + push cycle ───────────────────────────────────
let isRunning=false;

async function runSnapshot(){
  if(isRunning) return;
  isRunning=true;
  spStatus.style.color="#58a6ff";
  spStatus.textContent="🔍 Checking session...";

  // Session check
  const ok=await checkSession();
  if(!ok){
    spStatus.style.color="#f85149";
    spStatus.textContent="❌ Session expired — please log in to NEXS and re-run";
    spNext.textContent="";
    if(countdownTimer) clearInterval(countdownTimer);
    if(window.__snapshotTimer) clearInterval(window.__snapshotTimer);
    isRunning=false;
    return;
  }

  spStatus.style.color="#58a6ff";
  spStatus.textContent="⏳ Fetching counts (0/16)...";

  const counts={};
  let sessionExpired=false;
  let fetched=0;

  for(const courier of THE16){
    try{
      counts[courier]=await fetchCount(courier);
    }catch(e){
      if(e.message==="SESSION_EXPIRED"){
        sessionExpired=true;
        break;
      }
      counts[courier]=0; // treat fetch error as 0, not fatal
    }
    fetched++;
    spStatus.textContent=`⏳ Fetching counts (${fetched}/16)...`;
    await new Promise(r=>setTimeout(r,DELAY_MS));
  }

  if(sessionExpired){
    spStatus.style.color="#f85149";
    spStatus.textContent="❌ Session expired mid-run — please log in and re-run";
    spNext.textContent="";
    if(countdownTimer) clearInterval(countdownTimer);
    if(window.__snapshotTimer) clearInterval(window.__snapshotTimer);
    isRunning=false;
    return;
  }

  // DELHIVERY special rule: subtract DELHIVERYPDS
  const rawDelhivery=counts["DELHIVERY"]??0;
  const rawPDS=counts["DELHIVERYPDS"]??0;
  counts["DELHIVERY"]=Math.max(0,rawDelhivery-rawPDS);

  // Push to sheet
  spStatus.textContent="📤 Pushing to sheet...";
  const pushed=await pushToSheet(counts);

  // Render cards
  renderCards(counts,false);

  // Status
  const ts=nowIST().split(" IST")[0].split(" ")[1]; // just HH:MM:SS
  if(pushed){
    spStatus.style.color="#3fb950";
    spStatus.textContent=`✅ Pushed at ${ts} IST`;
  } else {
    spStatus.style.color="#d29922";
    spStatus.textContent=`⚠ Sheet push failed — counts shown locally`;
  }

  // Footer
  const pending=Object.values(counts).filter(v=>v>0).length;
  spFooter.textContent=`${pending} couriers with pending · last run ${ts} IST`;

  isRunning=false;
  startCountdown();
}

// ── Close button ──────────────────────────────────────────────
document.getElementById("sp-close").onclick=()=>{
  if(window.__snapshotTimer) clearInterval(window.__snapshotTimer);
  if(countdownTimer) clearInterval(countdownTimer);
  panel.remove();
  document.getElementById("snapshotPanelStyle")?.remove();
  delete window.__snapshotTimer;
};

// ── Manual refresh button ─────────────────────────────────────
document.getElementById("sp-refresh").onclick=()=>{
  if(window.__snapshotTimer) clearInterval(window.__snapshotTimer);
  if(countdownTimer) clearInterval(countdownTimer);
  runSnapshot().then(()=>{
    window.__snapshotTimer=setInterval(runSnapshot,INTERVAL_MS);
  });
};

// ── Start ─────────────────────────────────────────────────────
await runSnapshot();
window.__snapshotTimer=setInterval(runSnapshot,INTERVAL_MS);

})();
