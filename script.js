/* HS Blackjack — ENHC slow deal + Rebet + fade-out + bank guard */
var BUILD = 'stable-2025-08-10-iv';
var DEBUG_FORCE = false; // live

// cache-buster (?fresh=1)
(function freshLoader(){
  try{
    const q = new URLSearchParams(location.search);
    if (q.has('fresh')) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
      }
      if ('caches' in window) {
        caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
      }
      q.delete('fresh');
      setTimeout(() => location.replace(location.pathname + (q.toString()?('?'+q):'')), 40);
    }
  }catch(e){}
})();

/* ------------ helpers ------------ */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const byId = id => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* sum of all staged bets on visible seats */
function stagedSum(){
  let sum = 0;
  for (let i = 0; i < activeSeatsCount; i++) sum += (stagedBets[i] || 0);
  return sum;
}

/* ------------ state ------------ */
let playerBank = 1000;
let activeSeatsCount = 1;
let stagedBets = [0,0,0];

let dealer = [];
let hands  = [[],[],[]];
let handBets = [0,0,0];
let doubled  = [false,false,false];
let finished = [false,false,false];
let activeSeat = 0;
let inRound = false;

// Insurance
let insuranceWager = 0;
let allowInsurance = true; // per your preference

// Rebet
let lastStagedBets = [0,0,0];

const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
let decks = 6, shoe = [], cutIndex = 0;

/* ------------ containers ------------ */
const handContainer  = i => byId('hand'+(i+1));
const totalContainer = i => byId('total'+(i+1));

/* ------------ boot ------------ */
let seats = [];
document.addEventListener('DOMContentLoaded', () => {
  const badge = byId('buildBadge'); if (badge) badge.textContent = `HS Blackjack • ${BUILD}`;

  cacheDom();
  ensureSeat1Active();
  applySeatLayout();
  renderBank();
  initChips();
  initActions();
  initSeatToggle();
  initProfilePanel();
  initInsuranceHandlers();
  updateRebetButton();
});

/* ------------ DOM wiring ------------ */
function cacheDom(){
  seats = $$('.seat').map(seat => ({
    root: seat,
    bet: seat.querySelector('.bet'),
    stack: seat.querySelector('.bet-stack'),
  }));
}
function ensureSeat1Active(){
  seats.forEach(s => s.root.classList.remove('active'));
  if (seats[0]) seats[0].root.classList.add('active');
}
function applySeatLayout(){
  const area = byId('seatsArea');
  if (!area) return;
  area.classList.remove('solo','duo','trio','arc');
  area.classList.add('arc', activeSeatsCount===1?'solo':activeSeatsCount===2?'duo':'trio');

  for (let i=0;i<3;i++){
    const on = i < activeSeatsCount;
    if (!seats[i]) continue;
    seats[i].root.style.visibility = on ? 'visible' : 'hidden';
    if (!on){
      handContainer(i)?.replaceChildren();
      if (totalContainer(i)) totalContainer(i).textContent='';
      if (seats[i].stack) seats[i].stack.innerHTML='';
      stagedBets[i]=0; if (seats[i].bet) seats[i].bet.textContent='$0';
    }
  }
}

/* ------------ chips + stacks ------------ */
function initChips(){
  // PREVENT OVER-BETTING: block chip taps that would exceed bank
  $$('#chipsArea .chip-img').forEach(chip => {
    chip.addEventListener('click', () => {
      if (inRound) return;
      const val = parseInt(chip.getAttribute('data-value'),10);

      // active seat
      let idx = seats.findIndex(s => s.root.classList.contains('active'));
      if (idx<0) idx=0;
      if (idx>=activeSeatsCount) return;

      // NEW: total staged + this chip must not exceed bank
      if (stagedSum() + val > playerBank) {
        const tray = byId('chipsArea');
        tray?.classList.add('shake');
        setTimeout(()=> tray?.classList.remove('shake'), 250);
        return;
      }

      stagedBets[idx]+=val;
      seats[idx].bet && (seats[idx].bet.textContent = '$'+stagedBets[idx]);
      addChipToken(idx,val);
      updateRebetButtonPreview();
    });
  });

  seats.forEach((s, idx) => {
    s.root.addEventListener('click', (e) => {
      if (e.target.closest('.bet') || e.target.closest('button')) return;
      if (idx>=activeSeatsCount) return;
      seats.forEach(t => t.root.classList.remove('active'));
      s.root.classList.add('active');
    });

    s.bet?.addEventListener('click', ()=>{
      if (inRound || idx>=activeSeatsCount) return;
      const removed = removeLastChipToken(idx);
      if (removed>0){
        stagedBets[idx] = Math.max(0, stagedBets[idx]-removed);
        s.bet.textContent = '$'+stagedBets[idx];
        updateRebetButtonPreview();
      }
    });
  });
}

function addChipToken(i, value){
  const stack = seats[i]?.stack; if (!stack) return;
  const t = document.createElement('div');
  t.className = 'chip-token v'+value;
  t.innerHTML = '<span>$'+value+'</span>';
  const n = stack.children.length, x=(-4+(n%3)*4), y=n*6;
  t.style.transform = `translate(${x}px, ${12-y}px) scale(.8)`;
  t.style.zIndex = String(100+n);
  stack.appendChild(t);
  requestAnimationFrame(()=>{
    t.classList.add('in');
    t.style.transform = `translate(${x}px, ${-y}px) scale(1)`;
  });
}
function removeLastChipToken(i){
  const stack = seats[i]?.stack;
  const last = stack ? stack.lastElementChild : null;
  if (!last) return 0;
  const m = last.className.match(/v(\d+)/); const val = m?parseInt(m[1],10):0;
  last.classList.remove('in'); last.style.opacity='0';
  setTimeout(()=> last.remove(), 140);
  return val;
}
function lockStacks(){
  seats.slice(0,activeSeatsCount).forEach(s=>{
    if(!s.stack) return;
    Array.from(s.stack.children).forEach(el=>el.classList.add('locked'));
  });
}
function clearStacksAndBets(){
  stagedBets = [0,0,0];
  seats.forEach(s=>{ s.bet && (s.bet.textContent='$0'); s.stack && (s.stack.innerHTML=''); });
}

/* ------------ actions ------------ */
function initActions(){
  byId('dealBtn')?.addEventListener('click', startRound);
  byId('rebetBtn')?.addEventListener('click', doRebet);
  byId('hitBtn')?.addEventListener('click', doHit);
  byId('standBtn')?.addEventListener('click', doStand);
  byId('doubleBtn')?.addEventListener('click', doDouble);
  byId('splitBtn')?.addEventListener('click', ()=>{}); // will add later
}
function setBtn(sel,on){ const b=$(sel); if(!b) return; b.disabled=!on; b.classList.toggle('dimmed', !on); }
function setButtons(h,s,d,sp){ setBtn('#hitBtn',h); setBtn('#standBtn',s); setBtn('#doubleBtn',d); setBtn('#splitBtn',sp); }
function updateRebetButton(){
  const btn = byId('rebetBtn'); if(!btn) return;
  const need = (lastStagedBets[0]||0) + (lastStagedBets[1]||0) + (lastStagedBets[2]||0);
  const enough = playerBank >= need && need>0 && !inRound;
  btn.disabled = !enough; btn.classList.toggle('dimmed', !enough);
}
function updateRebetButtonPreview(){
  const btn = byId('rebetBtn'); if(!btn) return;
  const need = (stagedBets[0]||0) + (stagedBets[1]||0) + (stagedBets[2]||0);
  btn.disabled = need===0 || inRound;
  btn.classList.toggle('dimmed', btn.disabled);
}

/* ------------ shoe + rules ------------ */
function newShoe(n){
  const s=[];
  for(let i=0;i<n;i++) for(const su of SUITS) for(const r of RANKS) s.push({rank:r,suit:su,hidden:false});
  for(let i=s.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=s[i]; s[i]=s[j]; s[j]=t; }
  cutIndex = Math.floor(s.length*0.2);
  return s;
}
function ensureShoe(){ if(!shoe.length || shoe.length<=cutIndex) shoe = newShoe(decks); }
function draw(){ ensureShoe(); return shoe.pop(); }

function val(r){ if(r==='A')return 11; if(r==='K'||r==='Q'||r==='J')return 10; return parseInt(r,10); }
function total(cards){
  let t=0,a=0;
  for(const c of cards){ if(c.hidden) continue; t+=val(c.rank); if(c.rank==='A') a++; }
  while(t>21 && a>0){ t-=10; a--; }
  return t||'';
}
function isBJ(cards){ return cards.length>=2 && total(cards)===21 && cards.filter(c=>!c.hidden).length===2; }
function isSoft(cards){
  let t=0,a=0;
  for(const c of cards){ if(c.hidden) continue; t+=val(c.rank); if(c.rank==='A') a++; }
  while(t>21 && a>0){ t-=10; a--; }
  return a>0 && t<=21;
}
function canDouble(i){
  const h = hands[i]; if(h.length!==2) return false;
  const t = Number(total(h)); if(Number.isNaN(t)) return false;
  return (t===9 || t===10 || t===11) && playerBank>=handBets[i];
}

/* ------------ bank ui ------------ */
function renderBank(){ byId('playerBank').textContent = '$'+playerBank; }

/* ------------ render ------------ */
function putCard(container, card, slow=false){
  if(!container) return;
  const c = document.createElement('div');
  const red = (card.suit==='♥'||card.suit==='♦')?' red':'';
  if(card.hidden){ c.className='card back'; c.textContent='🂠'; }
  else{ c.className='card'+red; c.innerHTML = `<span class="small">${card.rank}</span><span class="big">${card.rank}</span><span class="suit">${card.suit}</span>`; }
  if (slow){ c.classList.add('deal-slow'); }
  container.appendChild(c);
  if (slow){
    requestAnimationFrame(()=> c.classList.add('show'));
  }
}
function renderAll(){
  // dealer
  const dcon = byId('dealerCards'); if (dcon){ dcon.innerHTML=''; for(const cd of dealer) putCard(dcon, cd); }
  if (byId('dealerTotal')) byId('dealerTotal').textContent = total(dealer);

  // players
  for(let s=0;s<activeSeatsCount;s++){
    const con = handContainer(s); if(con){ con.innerHTML=''; for(const cd of hands[s]) putCard(con, cd); }
    const tcon = totalContainer(s); if(tcon) tcon.textContent = total(hands[s]);

    const root = seats[s]?.root;
    if(root){
      root.classList.remove('tight','tighter');
      const n = hands[s].length;
      if (n>=5 && n<=6) root.classList.add('tight');
      if (n>=7) root.classList.add('tighter');
    }
  }
}

/* ------------ insurance bar ------------ */
function initInsuranceHandlers(){
  byId('insYes')?.addEventListener('click', ()=>{
    const half = Math.floor(handBets[0]/2);
    if (playerBank >= half) {
      insuranceWager = half;
      playerBank -= half;
      renderBank();
    }
    hideInsuranceBar();
  });
  byId('insNo')?.addEventListener('click', hideInsuranceBar);
}
function showInsuranceBar(){
  if (!allowInsurance) return;
  byId('insuranceBar')?.classList.add('show');
}
function hideInsuranceBar(){
  byId('insuranceBar')?.classList.remove('show');
  insuranceWager = 0;
}

/* ------------ round flow (ENHC) ------------ */
async function startRound(){
  // must have a bet and it must be affordable
  const need = stagedSum();
  if (need <= 0 || need > playerBank) return;

  inRound=true; setButtons(false,false,false,false); updateRebetButton();

  // copy staged bets to lastStagedBets for Rebet
  lastStagedBets = stagedBets.slice();

  // reset state
  dealer=[]; hands=[[],[],[]]; handBets=[0,0,0]; doubled=[false,false,false]; finished=[false,false,false]; activeSeat=0;
  // take bets
  for(let s=0;s<activeSeatsCount;s++){ handBets[s]=stagedBets[s]; playerBank -= handBets[s]; }
  renderBank(); lockStacks();

  // clear visuals & remove any previous fade class
  byId('dealerArea')?.classList.remove('fade-out');
  $$('#seatsArea .seat').forEach(seat=> seat.classList.remove('fade-out'));

  byId('dealerCards')?.replaceChildren(); if(byId('dealerTotal')) byId('dealerTotal').textContent='';
  for(let i=0;i<activeSeatsCount;i++){ handContainer(i)?.replaceChildren(); if(totalContainer(i)) totalContainer(i).textContent=''; }

  if (DEBUG_FORCE){
    hands[0].push({rank:'A',suit:'♠',hidden:false}); hands[0].push({rank:'K',suit:'♥',hidden:false});
    dealer.push({rank:'3',suit:'♣',hidden:false});
    await slowDealRender();
    if (isBJ(hands[0])) { playerBank += Math.floor(handBets[0]*2.5); renderBank(); await endRoundFadeAndReset(); return; }
    setButtons(true,true,canDouble(0),false); updateRebetButton(); return;
  }

  // === ENHC slow sequence ===
  // Pass 1: each player gets first card, then dealer gets one upcard
  for (let i=0;i<activeSeatsCount;i++){ const c=draw(); c.hidden=false; hands[i].push(c); await slowDealRender(); }
  const du = draw(); du.hidden=false; dealer.push(du); await slowDealRender();

  // Pass 2: each player gets second card (dealer does NOT take a hole card now)
  for (let i=0;i<activeSeatsCount;i++){ const c=draw(); c.hidden=false; hands[i].push(c); await slowDealRender(); }

  // Insurance decision
  if (dealer[0] && dealer[0].rank==='A' && !isBJ(hands[0])) showInsuranceBar(); else hideInsuranceBar();

  // Natural blackjack auto-pay (player) 3:2
  if (isBJ(hands[0])) {
    playerBank += Math.floor(handBets[0]*2.5);
    renderBank();
    await endRoundFadeAndReset();
    return;
  }

  // enable player actions
  setButtons(true,true,canDouble(0),false);
  updateRebetButton();
}

async function slowDealRender(){
  const dcon = byId('dealerCards');
  if (dcon){ dcon.innerHTML=''; for(const cd of dealer) putCard(dcon, cd, true); }
  if (byId('dealerTotal')) byId('dealerTotal').textContent = total(dealer);

  for (let s=0;s<activeSeatsCount;s++){
    const con = handContainer(s); if(!con) continue;
    con.innerHTML='';
    for (const cd of hands[s]) putCard(con, cd, true);
    const tcon = totalContainer(s); if (tcon) tcon.textContent = total(hands[s]);

    const root = seats[s]?.root;
    if(root){
      root.classList.remove('tight','tighter');
      const n = hands[s].length;
      if (n>=5 && n<=6) root.classList.add('tight');
      if (n>=7) root.classList.add('tighter');
    }
  }
  await sleep(300); // pacing between each append
}

/* Player actions */
async function doHit(){
  if(!inRound) return;
  const h = hands[activeSeat];
  if (Number(total(h))>=21) return;
  const c=draw(); c.hidden=false; h.push(c);
  await slowDealRender();
  const t=Number(total(h));
  if (t>=21) { await doStand(); } else { setButtons(true,true,canDouble(activeSeat),false); }
}

async function doDouble(){
  if(!inRound) return;
  if(!canDouble(activeSeat)) return;
  if(playerBank < handBets[activeSeat]) return;
  playerBank -= handBets[activeSeat]; renderBank();
  doubled[activeSeat]=true;
  const c=draw(); c.hidden=false; hands[activeSeat].push(c);
  await slowDealRender();
  await doStand();
}

async function doStand(){
  if(!inRound) return;
  finished[activeSeat]=true;
  await dealerPlayAndSettle_ENHC();
}

async function dealerPlayAndSettle_ENHC(){
  hideInsuranceBar();

  // ENHC: only now dealer draws "hole" (second) card, then plays out to S17
  if (dealer.length===1){
    const hole = draw(); hole.hidden=false; dealer.push(hole);
    await slowDealRender();
  }

  // S17
  while(true){
    const t = Number(total(dealer));
    if (t<17) { const c=draw(); c.hidden=false; dealer.push(c); await slowDealRender(); }
    else break;
  }

  // Resolve insurance (2:1 if dealer has BJ)
  if (insuranceWager>0){
    if (isBJ(dealer)) playerBank += insuranceWager*3;
    insuranceWager=0; renderBank();
  }

  // settle seat 1 (extend later)
  const bet=handBets[0], dbl=doubled[0], p=Number(total(hands[0])), d=Number(total(dealer));
  if (p>21){ /* lose */ }
  else if (d>21){ playerBank += bet*(dbl?4:2); }
  else if (p>d){  playerBank += bet*(dbl?4:2); }
  else if (p===d){ playerBank += bet*(dbl?2:1); }
  // else lose

  renderBank();
  await endRoundFadeAndReset();
}

/* ------------ Round end fade + reset ------------ */
async function endRoundFadeAndReset(){
  byId('dealerArea')?.classList.add('fade-out');
  $$('#seatsArea .seat').forEach(seat=> seat.classList.add('fade-out'));
  await sleep(380);

  byId('dealerCards')?.replaceChildren(); if(byId('dealerTotal')) byId('dealerTotal').textContent='';
  for(let i=0;i<3;i++){ handContainer(i)?.replaceChildren(); if(totalContainer(i)) totalContainer(i).textContent=''; }
  clearStacksAndBets();
  hideInsuranceBar();

  inRound=false;
  setButtons(false,false,false,false);
  updateRebetButton();
}

/* ------------ Rebet ------------ */
function doRebet(){
  if (inRound) return;

  const needed = (lastStagedBets[0]||0) + (lastStagedBets[1]||0) + (lastStagedBets[2]||0);
  if (needed <= 0 || playerBank < needed) { updateRebetButton(); return; }

  // clear any currently staged chips first
  clearStacksAndBets();

  // Stage onto visible seats only; build stack tokens visually
  for (let i=0;i<activeSeatsCount;i++){
    const amt = lastStagedBets[i]||0;
    if (amt<=0) continue;
    stagedBets[i] = amt;
    seats[i].bet && (seats[i].bet.textContent = '$'+amt);

    // build tokens from denominations (100/50/20/5 greedy)
    let r = amt;
    const pushMany = (v) => { while(r>=v){ addChipToken(i, v); r-=v; } };
    pushMany(100); pushMany(50); pushMany(20); pushMany(5);
  }
  updateRebetButtonPreview();
}

/* ------------ seat toggle ------------ */
function initSeatToggle(){
  $$('#seatToggle button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('#seatToggle button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      activeSeatsCount = parseInt(btn.getAttribute('data-seats'),10)||1;
      ensureSeat1Active(); applySeatLayout();
    });
  });
}

/* ------------ profile / settings ------------ */
function initProfilePanel(){
  const profileBtn = byId('profileBtn');
  const panel = byId('profilePanel');
  const closeBtn = byId('closeProfile');
  profileBtn?.addEventListener('click', ()=> panel?.classList.add('open'));
  closeBtn  ?.addEventListener('click', ()=> panel?.classList.remove('open'));

  byId('decksInput')?.addEventListener('change', (e)=>{
    const v = parseInt(e.target.value,10);
    if (v>=1 && v<=8) decks=v;
  });

  byId('resetBank')?.addEventListener('click', ()=>{
    playerBank=1000; renderBank(); clearStacksAndBets();
    inRound=false; dealer=[]; hands=[[],[],[]];
    byId('dealerCards')?.replaceChildren(); if(byId('dealerTotal')) byId('dealerTotal').textContent='';
    for (let i=0;i<3;i++){ handContainer(i)?.replaceChildren(); if(totalContainer(i)) totalContainer(i).textContent=''; }
    updateRebetButton();
  });

  byId('resetStats')?.addEventListener('click', ()=>{
    try{ localStorage.clear(); }catch(e){}
    location.href = location.pathname + '?fresh=1';
  });
}