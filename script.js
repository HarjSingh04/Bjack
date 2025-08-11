/* HS Blackjack — stable multi-seat + BJ autopay */

/* =============== DOM helpers =============== */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* =============== DOM refs =============== */
const dealerCardsEl = $('#dealerCards');
const dealerTotalEl = $('#dealerTotal');
const bankEl        = $('#playerBank');

const seatsArea     = $('#seatsArea');
const seatRoots     = $$('.seat');
const handEls       = [$('#hand1'), $('#hand2'), $('#hand3')];
const totalEls      = [$('#total1'), $('#total2'), $('#total3')];
const betPills      = seatRoots.map(r => r.querySelector('.bet'));       // hidden visually, but we update text
const stacks        = seatRoots.map(r => r.querySelector('.bet-stack'));

const dealBtn    = $('#dealBtn');
const rebetBtn   = $('#rebetBtn');
const hitBtn     = $('#hitBtn');
const standBtn   = $('#standBtn');
const doubleBtn  = $('#doubleBtn');
const splitBtn   = $('#splitBtn');

const chipBtns   = $$('#chipsArea .chip-img');
const seatTogBtns= $$('#seatToggle button');

/* =============== Config =============== */
const DECKS       = 6;
const DEAL_MS     = 260;   // per-card animation pacing
const END_FADE_MS = 420;
const MAX_SEATS   = 3;

/* =============== State =============== */
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

let shoe = [];
let discard = [];

let inRound = false;
let activeSeatsCount = 1;
let activeSeat = 0;

let hands   = [[],[],[]];
let dealer  = [];
let finished= [false,false,false];
let doubled = [false,false,false];

let handBets = [0,0,0];
let lastBets = [0,0,0];
let playerBank = 1000;

/* =============== Shoe / totals =============== */
function freshDeck(){
  const d = [];
  for (const s of SUITS){
    for (const r of RANKS){
      for (let i=0;i<DECKS;i++) d.push({r,s,hidden:false});
    }
  }
  for (let i=d.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [d[i],d[j]] = [d[j],d[i]];
  }
  return d;
}
function ensureShoe(){ if (shoe.length<52){ shoe=freshDeck(); discard.length=0; } }
function draw(){ ensureShoe(); return shoe.pop(); }

function cardVal(c){ if(c.r==='A')return 11; if(['K','Q','J'].includes(c.r))return 10; return Number(c.r); }
function total(hand){
  let t=0,a=0;
  for (const c of hand){
    if (c.hidden) continue;
    if (c.r==='A'){ t+=11; a++; } else t+=cardVal(c);
  }
  while (t>21 && a>0){ t-=10; a--; }
  return t;
}
function isBlackjack(h){ return h.length===2 && total(h)===21; }
function tenish(r){ return r==='10'||r==='J'||r==='Q'||r==='K'; }
function canRanksSplit(h){ return h.length===2 && (h[0].r===h[1].r || (tenish(h[0].r)&&tenish(h[1].r))); }

/* =============== Rendering =============== */
function renderBank(){ bankEl.textContent = `$${playerBank}`; }

function cardNode(c){
  const div = document.createElement('div');
  div.className = 'card deal-slow';
  if (c.hidden){
    div.classList.add('back'); div.innerHTML = `<div class="big">🂠</div>`;
    return div;
  }
  const red = (c.s==='♥'||c.s==='♦'); if (red) div.classList.add('red');
  div.innerHTML = `
    <div class="small">${c.r}</div>
    <div class="big">${c.r}</div>
    <div class="suit">${c.s}</div>
  `;
  return div;
}
function clearNode(n){ while(n && n.firstChild) n.removeChild(n.firstChild); }

function renderDealer(){
  clearNode(dealerCardsEl);
  for (const c of dealer){
    const n = cardNode(c);
    dealerCardsEl.appendChild(n);
    requestAnimationFrame(()=> n.classList.add('show'));
  }
  dealerTotalEl.textContent = dealer.some(c=>c.hidden) ? '' : (total(dealer)||'');
}
function renderSeat(i){
  const hand = hands[i]; const el = handEls[i];
  clearNode(el);
  for (const c of hand){
    const n = cardNode(c);
    el.appendChild(n);
    requestAnimationFrame(()=> n.classList.add('show'));
  }
  totalEls[i].textContent = (total(hand) || '');
  if (betPills[i]) betPills[i].textContent = `$${handBets[i]||0}`;
}
function renderAll(){ renderDealer(); for (let i=0;i<MAX_SEATS;i++) renderSeat(i); updateButtonsForState(); }

/* =============== Chips / bets UI =============== */
function rebuildStacksFromBets(){
  for (let i=0;i<activeSeatsCount;i++){
    const s = stacks[i]; if (!s) continue;
    s.innerHTML = '';
    let r = handBets[i] || 0;
    const pushMany = (v, cls)=>{
      while (r >= v){
        const t = document.createElement('div');
        t.className = `chip-token ${cls} in locked`;
        t.innerHTML = `<span>$${v}</span>`;
        const n = s.children.length, x=(-4+(n%3)*4), y=n*6;
        t.style.transform = `translate(${x}px, ${-y}px) scale(1)`;
        t.style.zIndex = String(100+n);
        s.appendChild(t);
        r -= v;
      }
    };
    pushMany(100,'v100'); pushMany(50,'v50'); pushMany(20,'v20'); pushMany(5,'v5');
  }
}
function addToBet(i, amount){
  const want = handBets.slice(0,activeSeatsCount).reduce((a,b)=>a+b,0) + amount;
  if (want > playerBank){
    const tray = $('#chipsArea'); tray?.classList.add('shake'); setTimeout(()=> tray?.classList.remove('shake'), 250);
    return;
  }
  handBets[i] += amount;
  if (betPills[i]) betPills[i].textContent = `$${handBets[i]}`;
  const s = stacks[i];
  if (s){
    const t = document.createElement('div');
    t.className = `chip-token v${amount}`;
    t.innerHTML = `<span>$${amount}</span>`;
    const n = s.children.length, x=(-4+(n%3)*4), y=n*6;
    t.style.transform = `translate(${x}px, ${12-y}px) scale(.8)`;
    t.style.zIndex = String(100+n);
    s.appendChild(t);
    requestAnimationFrame(()=>{ t.classList.add('in'); t.style.transform = `translate(${x}px, ${-y}px) scale(1)`; t.classList.add('locked'); });
  }
  updateButtonsForState();
}

/* =============== Buttons =============== */
function updateButtonsForState(){
  const anyStaged = handBets.slice(0,activeSeatsCount).some(v=>v>0);
  dealBtn.disabled  = inRound || !anyStaged;
  rebetBtn.disabled = inRound || !lastBets.slice(0,activeSeatsCount).some(v=>v>0);

  const h = hands[activeSeat] || [];
  const canHit    = inRound && !finished[activeSeat] && total(h) < 21;
  const canStand  = inRound && !finished[activeSeat];
  const canDouble = inRound && !finished[activeSeat] && h.length===2 && playerBank>=handBets[activeSeat];
  const canSplit  = inRound && !finished[activeSeat] && h.length===2 && canRanksSplit(h) && activeSeatsCount<3 && playerBank>=handBets[activeSeat];

  hitBtn.disabled    = !canHit;
  standBtn.disabled  = !canStand;
  doubleBtn.disabled = !canDouble;
  splitBtn.disabled  = !canSplit;

  syncActionStyles();
}
function syncActionStyles(){
  ['dealBtn','rebetBtn','hitBtn','standBtn','doubleBtn','splitBtn'].forEach(id=>{
    const b = document.getElementById(id); if (b) b.classList.toggle('dimmed', b.disabled);
  });
  dealBtn.classList.toggle('ready', !dealBtn.disabled && !inRound);
}

/* Hotkeys */
(function hotkeys(){
  window.addEventListener('keydown', (e)=>{
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    const clickIf = id=>{ const el=document.getElementById(id); if(el && !el.disabled){ el.click(); e.preventDefault(); } };
    if (key===' ' || key==='enter'){ clickIf(!rebetBtn.disabled?'rebetBtn':'dealBtn'); return; }
    if (key==='h') clickIf('hitBtn');
    if (key==='s') clickIf('standBtn');
    if (key==='d') clickIf('doubleBtn');
    if (key==='p') clickIf('splitBtn');
    if (key==='r') clickIf('rebetBtn');
  }, false);
})();

/* =============== Anim helpers =============== */
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function slowRenderAll(){ renderDealer(); for (let i=0;i<activeSeatsCount;i++) renderSeat(i); await sleep(DEAL_MS); }

/* =============== Round flow =============== */
function stageTotal(){ return handBets.slice(0,activeSeatsCount).reduce((a,b)=>a+b,0); }

async function onDeal(){
  if (inRound) return;
  const need = stageTotal(); if (need<=0 || need>playerBank) return;

  // Lock stakes
  lastBets = handBets.slice(0,activeSeatsCount);
  playerBank -= need; renderBank();
  inRound = true; finished=[false,false,false]; doubled=[false,false,false];
  dealer = []; hands=[[],[],[]]; activeSeat = 0;

  clearNode(dealerCardsEl); dealerTotalEl.textContent='';
  for (let i=0;i<activeSeatsCount;i++){ clearNode(handEls[i]); totalEls[i].textContent=''; }

  // Deal: P1..Pn, dealer up, P1..Pn
  for (let i=0;i<activeSeatsCount;i++){ const c=draw(); c.hidden=false; hands[i].push(c); await slowRenderAll(); }
  const up = draw(); up.hidden=false; dealer.push(up); await slowRenderAll();
  for (let i=0;i<activeSeatsCount;i++){ const c=draw(); c.hidden=false; hands[i].push(c); await slowRenderAll(); }

  // Natural Blackjack autopay (3:2) immediately
  const bjPlans=[];
  for (let i=0;i<activeSeatsCount;i++){
    if (isBlackjack(hands[i])){
      const bet = handBets[i];
      const profit = Math.floor(bet*1.5);
      playerBank += bet + profit;
      finished[i]=true;
      bjPlans.push({seat:i,text:`BJ + $${profit}`,cls:'win'});
    }
  }
  renderBank();
  if (bjPlans.length){
    await showPayoutBubbles(bjPlans);
    const allBJ = finished.slice(0,activeSeatsCount).every(Boolean);
    if (allBJ){ await endRoundFadeAndReset(); return; }
  }

  // Move to first unfinished seat
  activeSeat = 0; while (activeSeat<activeSeatsCount && finished[activeSeat]) activeSeat++;
  renderAll();
  updateButtonsForState();
}

async function onHit(){
  if (!inRound || finished[activeSeat]) return;
  const h = hands[activeSeat]; if (total(h)>=21) return;
  const c = draw(); c.hidden=false; h.push(c);
  await slowRenderAll();
  if (total(h)>=21){ finished[activeSeat]=true; advanceSeatOrDealer(); }
  else updateButtonsForState();
}
async function onStand(){
  if (!inRound || finished[activeSeat]) return;
  finished[activeSeat]=true; advanceSeatOrDealer();
}
async function onDouble(){
  if (!inRound || finished[activeSeat]) return;
  const bet = handBets[activeSeat];
  if (hands[activeSeat].length!==2 || playerBank<bet) return;
  playerBank -= bet; handBets[activeSeat]+=bet; renderBank(); rebuildStacksFromBets();
  doubled[activeSeat]=true;
  const c = draw(); c.hidden=false; hands[activeSeat].push(c);
  await slowRenderAll();
  finished[activeSeat]=true; advanceSeatOrDealer();
}
async function onSplit(){
  if (!inRound || finished[activeSeat]) return;
  const h = hands[activeSeat];
  if (!(h.length===2 && canRanksSplit(h))) return;
  if (activeSeatsCount>=3) return;
  const stake = handBets[activeSeat]; if (playerBank<stake) return;

  activeSeatsCount = Math.min(3, activeSeatsCount+1);
  applySeatLayout();

  const insertAt = activeSeat + 1;
  for (let i=activeSeatsCount-1;i>insertAt;i--){
    hands[i]=hands[i-1]; handBets[i]=handBets[i-1]; finished[i]=finished[i-1]; doubled[i]=doubled[i-1];
  }
  const moved = h.pop();
  hands[insertAt] = [moved];
  finished[insertAt]=false; doubled[insertAt]=false;

  handBets[insertAt] = stake;
  playerBank -= stake; renderBank();

  for (let i=0;i<activeSeatsCount;i++){ if (betPills[i]) betPills[i].textContent = `$${handBets[i]||0}`; }
  rebuildStacksFromBets();

  const c1 = draw(); c1.hidden=false; hands[activeSeat].push(c1); await slowRenderAll();
  const c2 = draw(); c2.hidden=false; hands[insertAt].push(c2); await slowRenderAll();
  updateButtonsForState();
}

/* =============== Turn progression =============== */
function applySeatLayout(){
  seatsArea.classList.remove('solo','duo','trio','arc');
  seatsArea.classList.add('arc', activeSeatsCount===1?'solo':activeSeatsCount===2?'duo':'trio');
  for (let i=0;i<3;i++) seatRoots[i].style.display = (i<activeSeatsCount)?'':'none';
}
function nextUnfinishedSeat(fromIdx){ for (let i=fromIdx+1;i<activeSeatsCount;i++){ if(!finished[i]) return i; } return -1; }
function allPlayersBustedOnly(){ for (let i=0;i<activeSeatsCount;i++){ if (total(hands[i])<=21) return false; } return true; }

async function settleAllBustedImmediately(){
  const plans=[];
  for (let i=0;i<activeSeatsCount;i++){
    const bet=handBets[i]||0; if(!bet) continue;
    const dbl=!!doubled[i];
    if (total(hands[i])>21) plans.push({seat:i,text:`– $${bet*(dbl?2:1)}`,cls:'lose'});
  }
  await showPayoutBubbles(plans);
  await endRoundFadeAndReset();
}
function advanceSeatOrDealer(){
  const nxt = nextUnfinishedSeat(activeSeat);
  if (nxt>=0){ activeSeat=nxt; renderAll(); return; }
  if (allPlayersBustedOnly()) settleAllBustedImmediately();
  else dealerPlayAndSettleAll();
}

/* =============== Dealer play & settle =============== */
async function dealerPlayAndSettleAll(){
  if (dealer.length===1){
    const hole = draw(); hole.hidden=false; dealer.push(hole);
    await slowRenderAll();
  }
  while (true){
    const t = total(dealer);
    if (t<17){ const c=draw(); c.hidden=false; dealer.push(c); await slowRenderAll(); }
    else break;
  }

  const d = Number.isFinite(Number(total(dealer))) ? Number(total(dealer)) : 0;
  const plans=[];
  for (let i=0;i<activeSeatsCount;i++){
    const bet = handBets[i]; if(!bet||bet<=0) continue;
    const p = Number.isFinite(Number(total(hands[i]))) ? Number(total(hands[i])) : 0;
    const dbl = !!doubled[i];
    let plan;
    if (p>21){ plan={seat:i,text:`– $${bet*(dbl?2:1)}`,cls:'lose'}; }
    else if (d>21){ playerBank+=bet*(dbl?4:2); plan={seat:i,text:`+ $${bet*(dbl?2:1)}`,cls:'win'}; }
    else if (p>d){ playerBank+=bet*(dbl?4:2); plan={seat:i,text:`+ $${bet*(dbl?2:1)}`,cls:'win'}; }
    else if (p===d){ playerBank+=bet*(dbl?2:1); plan={seat:i,text:`Push`,cls:'push'}; }
    else { plan={seat:i,text:`– $${bet*(dbl?2:1)}`,cls:'lose'}; }
    plans.push(plan);
  }
  renderBank();
  await showPayoutBubbles(plans);
  await endRoundFadeAndReset();
}

/* =============== Bubbles & end reset =============== */
async function showPayoutBubbles(plans){
  plans.forEach(p=>{
    const seat = seatRoots[p.seat];
    let div = seat.querySelector('.payout');
    if(!div){ div=document.createElement('div'); div.className='payout'; seat.appendChild(div); }
    div.textContent=p.text;
    div.className=`payout ${p.cls}`;
    requestAnimationFrame(()=> div.classList.add('show'));
  });
  await sleep(1000);
  plans.forEach(p=>{
    const seat = seatRoots[p.seat];
    const div = seat.querySelector('.payout'); if(div) div.classList.remove('show');
  });
}
async function endRoundFadeAndReset(){
  $('#dealerArea')?.classList.add('fade-out');
  seatRoots.forEach(s=>s.classList.add('fade-out'));
  await sleep(END_FADE_MS);

  dealer=[]; for(let i=0;i<MAX_SEATS;i++){ hands[i]=[]; finished[i]=false; doubled[i]=false; }
  clearNode(dealerCardsEl); dealerTotalEl.textContent='';
  handEls.forEach(el=> clearNode(el)); totalEls.forEach(el=> el.textContent='');

  inRound=false; activeSeat=0;
  seatRoots.forEach(s=>s.classList.remove('fade-out'));
  $('#dealerArea')?.classList.remove('fade-out');
  updateButtonsForState();
}

/* =============== Rebet =============== */
function onRebet(){
  if (inRound) return;
  if (!lastBets.slice(0,activeSeatsCount).some(v=>v>0)) return;
  handBets=[0,0,0];
  for(let i=0;i<activeSeatsCount;i++){
    handBets[i]=lastBets[i]||0;
    if (betPills[i]) betPills[i].textContent=`$${handBets[i]}`;
  }
  rebuildStacksFromBets();
  updateButtonsForState();
}

/* =============== Binding =============== */
function bindSeatClicks(){
  seatRoots.forEach((root, idx)=>{
    root.addEventListener('click',(e)=>{
      if(inRound) return;
      if(idx>=activeSeatsCount) return;
      if(e.target.closest('button')) return;
      seatRoots.forEach(r=>r.classList.remove('active'));
      root.classList.add('active');
      activeSeat=idx;
    });
    const box=root.querySelector('.bet-box');
    if(box){
      box.addEventListener('click',(e)=>{
        if(inRound) return;
        e.stopPropagation();
        seatRoots.forEach(r=>r.classList.remove('active'));
        root.classList.add('active');
        activeSeat=idx;
      });
    }
  });
}
function bindChips(){
  chipBtns.forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(inRound) return;
      const val=parseInt(btn.getAttribute('data-value'),10);
      let idx=activeSeat; if(idx>=activeSeatsCount) idx=activeSeatsCount-1;
      addToBet(idx,val);
    });
  });
}
function bindActions(){
  dealBtn  .addEventListener('click', onDeal);
  rebetBtn .addEventListener('click', onRebet);
  hitBtn   .addEventListener('click', onHit);
  standBtn .addEventListener('click', onStand);
  doubleBtn.addEventListener('click', onDouble);
  splitBtn .addEventListener('click', onSplit);
}
function bindSeatToggle(){
  seatTogBtns.forEach(b=>{
    b.addEventListener('click',()=>{
      if(inRound) return;
      seatTogBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      activeSeatsCount=parseInt(b.getAttribute('data-seats'),10)||1;
      applySeatLayout(); updateButtonsForState();
    });
  });
}

function boot(){
  applySeatLayout();
  bindSeatClicks(); bindChips(); bindActions(); bindSeatToggle();
  renderBank(); renderAll();
}
document.addEventListener('DOMContentLoaded', boot);