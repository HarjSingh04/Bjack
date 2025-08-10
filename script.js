/* HS Blackjack — stable live build */
var BUILD = 'stable-2025-08-10';
var DEBUG_FORCE = false; // live

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
      setTimeout(() => location.replace(location.pathname + (q.toString()?('?'+q):'')), 50);
    }
  }catch(e){}
})();

/* ---------- tiny helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const byId = id => document.getElementById(id);

/* ---------- state ---------- */
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

const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
let decks = 6, shoe = [], cutIndex = 0;

/* ---------- containers (robust) ---------- */
const handContainer = i => byId('hand'+(i+1));
const totalContainer = i => byId('total'+(i+1));

/* ---------- boot ---------- */
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
});

let seats = [];
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
      const hc = handContainer(i), tc = totalContainer(i);
      if (hc) hc.innerHTML='';
      if (tc) tc.textContent='';
      if (seats[i].stack) seats[i].stack.innerHTML='';
      stagedBets[i] = 0; if (seats[i].bet) seats[i].bet.textContent = '$0';
    }
  }
}

/* ---------- chips ---------- */
function initChips(){
  $$('#chipsArea .chip-img').forEach(chip => {
    chip.addEventListener('click', () => {
      if (inRound) return;
      const val = parseInt(chip.getAttribute('data-value'), 10);
      let idx = seats.findIndex(s => s.root.classList.contains('active'));
      if (idx < 0) idx = 0;
      if (idx >= activeSeatsCount) return;
      stagedBets[idx] += val;
      if (seats[idx].bet) seats[idx].bet.textContent = '$'+stagedBets[idx];
      addChipToken(idx, val);
    });
  });

  seats.forEach((s, idx) => {
    s.root.addEventListener('click', (e) => {
      if (e.target.closest('.bet') || e.target.closest('button')) return;
      if (idx >= activeSeatsCount) return;
      seats.forEach(t => t.root.classList.remove('active'));
      s.root.classList.add('active');
    });

    if (s.bet) s.bet.addEventListener('click', () => {
      if (inRound || idx>=activeSeatsCount) return;
      const removed = removeLastChipToken(idx);
      if (removed>0){
        stagedBets[idx] = Math.max(0, stagedBets[idx]-removed);
        s.bet.textContent = '$'+stagedBets[idx];
      }
    });
  });
}

function addChipToken(i, value){
  const stack = seats[i] && seats[i].stack;
  if (!stack) return;
  const t = document.createElement('div');
  t.className = 'chip-token v'+value;
  t.innerHTML = '<span>$'+value+'</span>';
  const n = stack.children.length, x = (-4 + (n%3)*4), y = n*6;
  t.style.transform = `translate(${x}px, ${12-y}px) scale(.8)`;
  t.style.zIndex = String(100+n);
  stack.appendChild(t);
  requestAnimationFrame(() => { t.classList.add('in'); t.style.transform = `translate(${x}px, ${-y}px) scale(1)`; });
}
function removeLastChipToken(i){
  const stack = seats[i] && seats[i].stack;
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
  seats.forEach(s=>{ if(s.bet) s.bet.textContent='$0'; if(s.stack) s.stack.innerHTML=''; });
}

/* ---------- actions ---------- */
function initActions(){
  byId('dealBtn')?.addEventListener('click', startRound);
  byId('hitBtn')?.addEventListener('click', doHit);
  byId('standBtn')?.addEventListener('click', doStand);
  byId('doubleBtn')?.addEventListener('click', doDouble);
  byId('splitBtn')?.addEventListener('click', ()=>{}); // later
}
function setBtn(sel,on){ const b=$(sel); if(!b) return; b.disabled=!on; b.classList.toggle('dimmed', !on); }
function setButtons(h,s,d,sp){ setBtn('#hitBtn',h); setBtn('#standBtn',s); setBtn('#doubleBtn',d); setBtn('#splitBtn',sp); }

/* ---------- shoe ---------- */
function newShoe(n){
  const s=[];
  for(let i=0;i<n;i++){
    for (const su of SUITS) for (const r of RANKS) s.push({rank:r, suit:su, hidden:false});
  }
  for(let i=s.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=s[i]; s[i]=s[j]; s[j]=t; }
  cutIndex = Math.floor(s.length*0.2);
  return s;
}
function ensureShoe(){ if (!shoe.length || shoe.length<=cutIndex) shoe = newShoe(decks); }
function draw(){ ensureShoe(); return shoe.pop(); }

/* ---------- rules helpers ---------- */
function val(r){ if(r==='A')return 11; if(r==='K'||r==='Q'||r==='J')return 10; return parseInt(r,10); }
function total(cards){
  let t=0,a=0;
  for(const c of cards){ if(c.hidden) continue; t+=val(c.rank); if(c.rank==='A') a++; }
  while(t>21 && a>0){ t-=10; a--; }
  return t || '';
}
function isBJ(cards){ return cards.length===2 && total(cards)===21; }
function isSoft(cards){
  let t=0,a=0;
  for(const c of cards){ if(c.hidden) continue; t+=val(c.rank); if(c.rank==='A') a++; }
  while(t>21 && a>0){ t-=10; a--; }
  return a>0 && t<=21;
}
function canDouble(i){
  const h = hands[i]; if (h.length!==2) return false;
  const t = Number(total(h)); if (Number.isNaN(t)) return false;
  return (t===9 || t===10 || t===11) && playerBank>=handBets[i];
}

/* ---------- bank & ui ---------- */
function renderBank(){ byId('playerBank').textContent = '$'+playerBank; }

/* ---------- render ---------- */
function putCard(container, card){
  if(!container) return;
  const c = document.createElement('div');
  if (card.hidden){
    c.className = 'card back';
    c.textContent = '🂠';
  } else {
    const red = (card.suit==='♥'||card.suit==='♦')?' red':'';
    c.className = 'card'+red;
    c.innerHTML = `<span class="small">${card.rank}</span><span class="big">${card.rank}</span><span class="suit">${card.suit}</span>`;
  }
  container.appendChild(c);
}
function renderAll(){
  const dcon = byId('dealerCards'); if (dcon){ dcon.innerHTML=''; for(const cd of dealer) putCard(dcon, cd); }
  if (byId('dealerTotal')) byId('dealerTotal').textContent = total(dealer);

  for (let s=0;s<activeSeatsCount;s++){
    const con = handContainer(s); if (con){ con.innerHTML=''; for(const cd of hands[s]) putCard(con, cd); }
    const tcon = totalContainer(s); if (tcon) tcon.textContent = total(hands[s]);
  }
}
function updateButtonsForState(){
  if (!inRound){ setButtons(false,false,false,false); return; }
  const t = Number(total(hands[activeSeat]));
  const h = t<21;
  const st = true;
  const d = canDouble(activeSeat);
  setButtons(h,st,d,false);
}

/* ---------- round flow ---------- */
function startRound(){
  // need a bet
  let any=false; for(let i=0;i<activeSeatsCount;i++) if(stagedBets[i]>0) any=true;
  if(!any) return;

  inRound = true;
  dealer=[]; hands=[[],[],[]]; handBets=[0,0,0]; doubled=[false,false,false]; finished=[false,false,false];
  activeSeat=0;

  for (let s=0;s<activeSeatsCount;s++){ handBets[s]=stagedBets[s]; playerBank -= handBets[s]; }
  renderBank(); lockStacks();

  // clear visuals
  byId('dealerCards')?.replaceChildren();
  if(byId('dealerTotal')) byId('dealerTotal').textContent='';
  for (let i=0;i<activeSeatsCount;i++){
    handContainer(i)?.replaceChildren();
    if (totalContainer(i)) totalContainer(i).textContent='';
  }

  if (DEBUG_FORCE){
    hands[0].push({rank:'A',suit:'♠',hidden:false});
    hands[0].push({rank:'K',suit:'♥',hidden:false});
    dealer.push({rank:'3',suit:'♣',hidden:false});
    dealer.push({rank:'Q',suit:'♦',hidden:true});
    if(activeSeatsCount>=2){ hands[1].push({rank:'9',suit:'♠',hidden:false}); hands[1].push({rank:'7',suit:'♦',hidden:false}); }
    if(activeSeatsCount>=3){ hands[2].push({rank:'5',suit:'♣',hidden:false}); hands[2].push({rank:'6',suit:'♥',hidden:false}); }
    renderAll(); updateButtonsForState(); settleImmediateBlackjacks(); return;
  }

  // real deal: P1..Pn, D up, P1..Pn, D hole
  for (let r=0;r<2;r++){
    for (let i=0;i<activeSeatsCount;i++){ const c = draw(); c.hidden=false; hands[i].push(c); }
    const cd = draw(); cd.hidden = (r===1); dealer.push(cd);
  }

  // render after DOM tick (prevents “no cards” race)
  setTimeout(()=>{
    renderAll();

    // natural blackjack auto-pay 3:2
    if (isBJ(hands[0])) {
      playerBank += Math.floor(handBets[0]*2.5);
      renderBank(); inRound=false; clearStacksAndBets(); setButtons(false,false,false,false);
      return;
    }

    updateButtonsForState();
  },0);
}

function doHit(){
  if(!inRound) return;
  const h = hands[activeSeat];
  if (Number(total(h))>=21) return;
  const c = draw(); c.hidden=false; h.push(c);
  renderAll();
  const t = Number(total(h));
  if (t>=21) doStand(); else updateButtonsForState();
}

function doDouble(){
  if(!inRound) return;
  if(!canDouble(activeSeat)) return;
  if(playerBank < handBets[activeSeat]) return;
  playerBank -= handBets[activeSeat]; renderBank();
  doubled[activeSeat] = true;
  const c = draw(); c.hidden=false; hands[activeSeat].push(c);
  renderAll();
  doStand();
}

function doStand(){
  if(!inRound) return;
  finished[activeSeat]=true;
  dealerPlayAndSettle();
}

function dealerPlayAndSettle(){
  // reveal hole
  dealer.forEach(c=>c.hidden=false);
  // S17
  while(true){
    const t = Number(total(dealer)); const soft = isSoft(dealer);
    if (t<17) { const c=draw(); c.hidden=false; dealer.push(c); }
    else break;
  }
  renderAll();

  // settle only seat 1 (for now)
  const bet=handBets[0], dbl=doubled[0], p=Number(total(hands[0])), d=Number(total(dealer));
  if (p>21){ /* lose */ }
  else if (d>21){ playerBank += bet*(dbl?4:2); }
  else if (p>d){  playerBank += bet*(dbl?4:2); }
  else if (p===d){ playerBank += bet*(dbl?2:1); }
  // else lose

  renderBank();
  inRound=false; clearStacksAndBets(); setButtons(false,false,false,false);
}

/* immediate blackjack payout (debug and live) */
function settleImmediateBlackjacks(){
  let any=false;
  for (let i=0;i<activeSeatsCount;i++){
    if (isBJ(hands[i])){ playerBank += Math.floor(handBets[i]*2.5); finished[i]=true; any=true; }
  }
  if (any){ renderBank(); inRound=false; clearStacksAndBets(); setButtons(false,false,false,false); }
}

/* ---------- seat toggle ---------- */
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

/* ---------- profile panel ---------- */
function initProfilePanel(){
  const profileBtn = byId('profileBtn');
  const panel = byId('profilePanel');
  const closeBtn = byId('closeProfile');
  profileBtn?.addEventListener('click', ()=> panel?.classList.add('open'));
  closeBtn  ?.addEventListener('click', ()=> panel?.classList.remove('open'));

  byId('resetBank')?.addEventListener('click', ()=>{
    playerBank=1000; renderBank(); clearStacksAndBets();
    inRound=false; dealer=[]; hands=[[],[],[]];
    byId('dealerCards')?.replaceChildren(); if(byId('dealerTotal')) byId('dealerTotal').textContent='';
    for (let i=0;i<3;i++){ handContainer(i)?.replaceChildren(); if(totalContainer(i)) totalContainer(i).textContent=''; }
  });

  byId('resetStats')?.addEventListener('click', ()=>{
    try{ localStorage.clear(); }catch(e){}
    location.href = location.pathname + '?fresh=1';
  });
}