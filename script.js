/* HS Blackjack — Multi-seat + slow deal + payout bubbles + bank guard + SPLIT-as-seat */
var BUILD = 'stable-2025-08-11-split';
var DEBUG_FORCE = false; // live

/* ===== speed knob ===== */
const DEAL_MS = 380;    // card-to-card pacing (ms)
const BUBBLE_MS = 1100; // payout bubble show time

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
function stagedSum(){ let sum=0; for(let i=0;i<activeSeatsCount;i++) sum += (stagedBets[i]||0); return sum; }
function isTenVal(r){ return r==='10'||r==='J'||r==='Q'||r==='K'; }

/* ------------ state ------------ */
let playerBank = 1000;
let activeSeatsCount = 1;       // user-selected seats before round; may grow by Split during round
let stagedBets = [0,0,0];

let dealer = [];
let hands  = [[],[],[]];
let handBets = [0,0,0];
let doubled  = [false,false,false];
let finished = [false,false,false];
let activeSeat = 0;
let inRound = false;

// Insurance (single-seat UI for now)
let insuranceWager = 0;
let allowInsurance = true;

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
  $$('#chipsArea .chip-img').forEach(chip => {
    chip.addEventListener('click', () => {
      if (inRound) return;
      const val = parseInt(chip.getAttribute('data-value'),10);
      let idx = seats.findIndex(s => s.root.classList.contains('active'));
      if (idx<0) idx=0;
      if (idx>=activeSeatsCount) return;
      if (stagedSum() + val > playerBank) {
        const tray = byId('chipsArea'); tray?.classList.add('shake');
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
function cloneStackTokens(fromIndex, toIndex){
  const src = seats[fromIndex]?.stack, dst = seats[toIndex]?.stack;
  if (!src || !dst) return;
  dst.innerHTML = '';
  Array.from(src.children).forEach((node, n)=> {
    const m = node.className.match(/v(\d+)/);
    const valClass = m ? 'v'+m[1] : '';
    const t = document.createElement('div');
    t.className = `chip-token ${valClass} in locked`;
    t.innerHTML = node.innerHTML;
    const x = (-4 + (n%3)*4), y = n*6;
    t.style.transform = `translate(${x}px, ${-y}px) scale(1)`;
    t.style.zIndex = String(100+n);
    dst.appendChild(t);
  });
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
  byId('splitBtn')?.addEventListener('click', doSplit);
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
function isBJ(cards){
  const open = cards.filter(c=>!c.hidden);
  return open.length===2 && total(cards)===21;
}
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
function canSplit(i){
  const h = hands[i];
  if (!h || h.length !== 2) return false;
  const a = h[0].rank, b = h[1].rank;
  const isPair = a === b || (isTenVal(a) && isTenVal(b)); // allow 10/J/Q/K pair
  const hasSeatRoom = activeSeatsCount < 3;               // we’ll host split on a new seat
  const canAfford = playerBank >= handBets[i];
  return isPair && hasSeatRoom && canAfford && inRound && !finished[i];
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
  if (slow){ requestAnimationFrame(()=> c.classList.add('show')); }
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

  // highlight active seat
  seats.forEach((s,idx)=> s?.root.classList.toggle('active', idx===activeSeat && inRound));

  updateButtonsForState();
}
function updateButtonsForState(){
  if(!inRound){ setButtons(false,false,false,false); return; }
  if(finished[activeSeat]){ setButtons(false,false,false,false); return; }
  const t = Number(total(hands[activeSeat]));
  const canH = t<21;
  const canS = true;
  const canD = canDouble(activeSeat);
  const canSp = canSplit(activeSeat);
  setButtons(canH,canS,canD,canSp);
}

/* ------------ insurance bar ------------ */
function initInsuranceHandlers(){
  byId('insYes')?.addEventListener('click', ()=>{
    if (activeSeatsCount!==1) { hideInsuranceBar(); return; } // per-seat later
    const half = Math.floor(handBets[0]/2);
    if (playerBank >= half) { insuranceWager = half; playerBank -= half; renderBank(); }
    hideInsuranceBar();
  });
  byId('insNo')?.addEventListener('click', hideInsuranceBar);
}
function showInsuranceBar(){
  if (!allowInsurance) return;
  if (activeSeatsCount!==1) return;
  byId('insuranceBar')?.classList.add('show');
}
function hideInsuranceBar(){
  byId('insuranceBar')?.classList.remove('show');
  insuranceWager = 0;
}

/* ------------ seat turn helpers ------------ */
function advanceSeatOrDealer(){
  for (let i=activeSeat+1; i<activeSeatsCount; i++){
    if (!finished[i]) { activeSeat = i; renderAll(); return; }
  }
  dealerPlayAndSettleAll();
}

/* ------------ round flow (ENHC) ------------ */
async function startRound(){
  const need = stagedSum();
  if (need <= 0 || need > playerBank) return;

  inRound=true; setButtons(false,false,false,false); updateRebetButton();

  lastStagedBets = stagedBets.slice();

  dealer=[]; hands=[[],[],[]]; handBets=[0,0,0]; doubled=[false,false,false]; finished=[false,false,false]; activeSeat=0;

  for(let s=0;s<activeSeatsCount;s++){ handBets[s]=stagedBets[s]; playerBank -= handBets[s]; }
  renderBank(); lockStacks();

  byId('dealerArea')?.classList.remove('fade-out');
  $$('#seatsArea .seat').forEach(seat=> seat.classList.remove('fade-out'));

  byId('dealerCards')?.replaceChildren(); if(byId('dealerTotal')) byId('dealerTotal').textContent='';
  for(let i=0;i<activeSeatsCount;i++){ handContainer(i)?.replaceChildren(); if(totalContainer(i)) totalContainer(i).textContent=''; }

  if (DEBUG_FORCE){
    for(let i=0;i<activeSeatsCount;i++){ hands[i].push({rank:'A',suit:'♠',hidden:false}); hands[i].push({rank:'9',suit:'♥',hidden:false}); }
    dealer.push({rank:'6',suit:'♣',hidden:false});
    await slowDealRender();
  } else {
    // Pass 1: each player gets first card, then dealer upcard
    for (let i=0;i<activeSeatsCount;i++){ const c=draw(); c.hidden=false; hands[i].push(c); await slowDealRender(); }
    const du = draw(); du.hidden=false; dealer.push(du); await slowDealRender();
    // Pass 2: each player gets second card
    for (let i=0;i<activeSeatsCount;i++){ const c=draw(); c.hidden=false; hands[i].push(c); await slowDealRender(); }
  }

  if (dealer[0] && dealer[0].rank==='A'){
    const anyNonBJ = [...Array(activeSeatsCount)].some((_,i)=>!isBJ(hands[i]));
    if (anyNonBJ) showInsuranceBar(); else hideInsuranceBar();
  } else hideInsuranceBar();

  // Natural BJs auto-pay 3:2
  for (let i=0;i<activeSeatsCount;i++){
    if (isBJ(hands[i])){ playerBank += Math.floor(handBets[i]*2.5); finished[i]=true; }
  }
  renderBank();

  if (finished.slice(0,activeSeatsCount).every(v=>v)){ await endRoundFadeAndReset([]); return; }

  activeSeat = 0; while (activeSeat<activeSeatsCount && finished[activeSeat]) activeSeat++; renderAll();
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
  seats.forEach((s,idx)=> s?.root.classList.toggle('active', idx===activeSeat && inRound));
  await sleep(DEAL_MS);
}

/* Player actions */
async function doHit(){
  if(!inRound || finished[activeSeat]) return;
  const h = hands[activeSeat];
  if (Number(total(h))>=21) return;
  const c=draw(); c.hidden=false; h.push(c);
  await slowDealRender();
  const t=Number(total(h));
  if (t>=21){ finished[activeSeat]=true; advanceSeatOrDealer(); } else updateButtonsForState();
}
async function doDouble(){
  if(!inRound || finished[activeSeat]) return;
  if(!canDouble(activeSeat)) return;
  if(playerBank < handBets[activeSeat]) return;
  playerBank -= handBets[activeSeat]; renderBank();
  doubled[activeSeat]=true;
  const c=draw(); c.hidden=false; hands[activeSeat].push(c);
  await slowDealRender();
  finished[activeSeat]=true; advanceSeatOrDealer();
}
async function doStand(){
  if(!inRound || finished[activeSeat]) return;
  finished[activeSeat]=true;
  advanceSeatOrDealer();
}

function setBetLabel(i, amt){
  const s = seats[i]; if (!s || !s.bet) return;
  s.bet.textContent = '$' + (amt||0);
}

function rebuildStacksFromBets(){
  for (let i = 0; i < activeSeatsCount; i++){
    const s = seats[i]; if (!s || !s.stack) continue;
    s.stack.innerHTML = '';
    let r = handBets[i] || 0;
    const pushMany = (v, cls) => { while (r >= v){ 
      const t = document.createElement('div');
      t.className = `chip-token ${cls} in locked`;
      t.innerHTML = `<span>$${v}</span>`;
      const n = s.stack.children.length, x=(-4+(n%3)*4), y=n*6;
      t.style.transform = `translate(${x}px, ${-y}px) scale(1)`;
      t.style.zIndex = String(100+n);
      s.stack.appendChild(t);
      r -= v;
    }};
    pushMany(100,'v100'); pushMany(50,'v50'); pushMany(20,'v20'); pushMany(5,'v5');
  }
}


/* Split: turn the right-adjacent empty seat into the split hand */
async function doSplit(){
  if (!canSplit(activeSeat)) return;

  const insertAt = activeSeat + 1;

  // Expand to host the new split seat
  activeSeatsCount = Math.min(3, activeSeatsCount + 1);
  applySeatLayout();
  cacheDom(); // refresh seat DOM refs (bet/stack)

  // Shift right-side seat data (if there was one) to make room
  for (let i = activeSeatsCount - 1; i > insertAt; i--){
    hands[i]    = hands[i-1];
    handBets[i] = handBets[i-1];
    doubled[i]  = doubled[i-1];
    finished[i] = finished[i-1];
  }

  // Move one card to the new split hand
  const moved = hands[activeSeat].pop();
  hands[insertAt] = [ moved ];
  finished[insertAt] = false;
  doubled[insertAt]  = false;

  // Copy stake to new hand and deduct from bank
  const stake = handBets[activeSeat];
  handBets[insertAt] = stake;
  playerBank -= stake; renderBank();

  // Rebuild ALL bet pills + chip stacks from current handBets
  for (let i=0; i<activeSeatsCount; i++) setBetLabel(i, handBets[i]);
  rebuildStacksFromBets();

  // Deal one extra card to each split hand
  const c1 = draw(); c1.hidden=false; hands[activeSeat].push(c1);
  await slowDealRender();
  const c2 = draw(); c2.hidden=false; hands[insertAt].push(c2);
  await slowDealRender();

  updateButtonsForState();
}


/* ------------ Dealer play & settle ALL seats ------------ */
async function dealerPlayAndSettleAll(){
  hideInsuranceBar();

  // Reveal hole card if needed
  if (dealer.length === 1) {
    const hole = draw(); hole.hidden = false; dealer.push(hole);
    await slowDealRender();
  }

  // Dealer draws to 17 (stand on all 17s; you can change soft rule elsewhere)
  while (true) {
    const t = Number(total(dealer));
    if (t < 17) {
      const c = draw(); c.hidden = false; dealer.push(c);
      await slowDealRender();
    } else break;
  }

  // Insurance settle (single-seat only for now)
  if (activeSeatsCount === 1 && insuranceWager > 0) {
    if (isBJ(dealer)) playerBank += insuranceWager * 3; // 2:1 profit + stake
    insuranceWager = 0;
  }

  // --- Settle each seat (hardened) ---
  const dRaw = Number(total(dealer));
  const d = Number.isFinite(dRaw) ? dRaw : 0;

  const bubblePlans = [];
  for (let i = 0; i < activeSeatsCount; i++) {
    const bet = handBets[i];
    if (!bet || bet <= 0) continue;

    const pRaw = Number(total(hands[i]));
    const p = Number.isFinite(pRaw) ? pRaw : 0;
    const dbl = !!doubled[i];

    let plan;
    if (p > 21) {
      // player bust
      plan = { seat:i, text:`– $${bet * (dbl ? 2 : 1)}`, cls:'lose' };
    } else if (d > 21) {
      // dealer bust
      playerBank += bet * (dbl ? 4 : 2);
      plan = { seat:i, text:`+ $${bet * (dbl ? 2 : 1)}`, cls:'win' };
    } else if (p > d) {
      // player higher
      playerBank += bet * (dbl ? 4 : 2);
      plan = { seat:i, text:`+ $${bet * (dbl ? 2 : 1)}`, cls:'win' };
    } else if (p === d) {
      // push returns the stake (double returns doubled stake)
      playerBank += bet * (dbl ? 2 : 1);
      plan = { seat:i, text:`Push`, cls:'push' };
    } else {
      // dealer higher
      plan = { seat:i, text:`– $${bet * (dbl ? 2 : 1)}`, cls:'lose' };
    }

    bubblePlans.push(plan);
  }
  renderBank();

  await showPayoutBubbles(bubblePlans);
  await endRoundFadeAndReset();
}

/* ===== payout bubbles ===== */
async function showPayoutBubbles(plans){
  plans.forEach(p=>{
    const seat = seats[p.seat]?.root; if(!seat) return;
    let div = seat.querySelector('.payout');
    if (!div){ div = document.createElement('div'); div.className='payout'; seat.appendChild(div); }
    div.textContent = p.text;
    div.classList.remove('win','push','lose','show');
    div.classList.add(p.cls);
    requestAnimationFrame(()=> div.classList.add('show'));
  });
  await sleep(BUBBLE_MS);
  plans.forEach(p=>{
    const seat = seats[p.seat]?.root; const div = seat?.querySelector('.payout');
    if (div) div.classList.remove('show');
  });
}

/* ------------ Round end fade + reset ------------ */
async function endRoundFadeAndReset(){
  byId('dealerArea')?.classList.add('fade-out');
  $$('#seatsArea .seat').forEach(seat=> seat.classList.add('fade-out'));
  await sleep(380);

  byId('dealerCards')?.replaceChildren(); if(byId('dealerTotal')) byId('dealerTotal').textContent='';
  for(let i=0;i<3;i++){
    handContainer(i)?.replaceChildren();
    if(totalContainer(i)) totalContainer(i).textContent='';
    const seat = seats[i]?.root;
    const bubble = seat?.querySelector('.payout'); if (bubble) bubble.remove();
  }
  clearStacksAndBets();

  // Reset to the user-selected seats (don’t keep extra split seats next round)
  // If you want to keep the expanded seats next hand, remove the next two lines.
  // (We’ll just collapse to however many have stagedBets > 0)
  // For now: keep whatever seat toggle the user set before dealing:
  // (No change to activeSeatsCount here)

  inRound=false;
  setButtons(false,false,false,false);
  updateRebetButton();
}

/* ------------ Rebet ------------ */
function doRebet(){
  if (inRound) return;

  const needed = (lastStagedBets[0]||0) + (lastStagedBets[1]||0) + (lastStagedBets[2]||0);
  if (needed <= 0 || playerBank < needed) { updateRebetButton(); return; }

  clearStacksAndBets();

  for (let i=0;i<activeSeatsCount;i++){
    const amt = lastStagedBets[i]||0;
    if (amt<=0) continue;
    stagedBets[i] = amt;
    seats[i].bet && (seats[i].bet.textContent = '$'+amt);
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
      if (inRound) return; // don’t allow changing seats mid-round
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

/* ------------ insurance handlers ------------ */
function initInsuranceHandlers(){
  byId('insYes')?.addEventListener('click', ()=>{
    if (activeSeatsCount!==1) { hideInsuranceBar(); return; }
    const half = Math.floor(handBets[0]/2);
    if (playerBank >= half) { insuranceWager = half; playerBank -= half; renderBank(); }
    hideInsuranceBar();
  });
  byId('insNo')?.addEventListener('click', hideInsuranceBar);
}
