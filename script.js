/* HS Blackjack — multi-seat + BJ autopay + shoe animation (bank-safe rebet) */

/* =============== DOM helpers =============== */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* =============== DOM refs =============== */
const dealerCardsEl = $('#dealerCards');
const dealerTotalEl = $('#dealerTotal');
const bankEl        = $('#playerBank');

const seatsArea     = $('#seatsArea');
const seatRoots     = $$('.seat');
const handEls       = [$('#hand1'), $('#hand2'), $('#hand3')];
const totalEls      = [$('#total1'), $('#total2'), $('#total3')];
const betPills      = [$('#bet1'), $('#bet2'), $('#bet3')];
const stacks        = seatRoots.map(r => r.querySelector('.bet-stack'));

const dealBtn    = $('#dealBtn');
const rebetBtn   = $('#rebetBtn');
const clearBtn   = $('#clearBtn');
const hitBtn     = $('#hitBtn');
const standBtn   = $('#standBtn');
const doubleBtn  = $('#doubleBtn');
const splitBtn   = $('#splitBtn');
const statWinsEl   = $('#statWins');
const statLossesEl = $('#statLosses');
const statPushesEl = $('#statPushes');
const reshuffleToast = $('#reshuffleToast');
const bankruptOverlay = $('#bankruptOverlay');
const restartBankBtn = $('#restartBankBtn');

const chipBtns   = $$('#chipsArea .chip-img');
const seatTogBtns= $$('#seatToggle button');

/* =============== Config =============== */
const DECKS       = 6;
const DEAL_MS     = 260;   // visual pacing between cards
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

let handBets = [0,0,0];
let lastBets = [0,0,0];
let playerBank = parseInt(localStorage.getItem('bjack_bank') || '1000', 10);
let stats = JSON.parse(localStorage.getItem('bjack_stats') || '{"wins":0,"losses":0,"pushes":0}');
let reshuffleToastTimer = null;

/* ===== Chip art + stack rules ===== */
const COIN_SVGS = {
  5:   'assets/chip-5.svg',
  20:  'assets/chip-20.svg',
  50:  'assets/chip-50.svg',
  100: 'assets/chip-100.svg'
};
const COIN_SIZE = 44;
const MAX_PER_STACK = 10;
const H_SPACING = COIN_SIZE * 0.80;
const V_SPACING = COIN_SIZE * 0.22;
const betCoins = [[],[],[]];

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
function isSoft17(hand){
  const t = total(hand);
  if (t !== 17) return false;
  let base = 0;
  let aces = 0;
  for (const c of hand){
    if (c.hidden) continue;
    if (c.r === 'A'){ base += 1; aces++; }
    else base += cardVal(c);
  }
  return aces > 0 && (base + 10 === 17);
}
function showReshuffleToast(){
  if (!reshuffleToast) return;
  reshuffleToast.classList.add('show');
  if (reshuffleToastTimer) clearTimeout(reshuffleToastTimer);
  reshuffleToastTimer = setTimeout(()=> reshuffleToast.classList.remove('show'), 1800);
}
function ensureShoe(){
  if (shoe.length<52){
    const wasUsed = shoe.length>0 || discard.length>0;
    shoe=freshDeck();
    discard.length=0;
    if (wasUsed) showReshuffleToast();
  }
}
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
function saveStats(){ localStorage.setItem('bjack_stats', JSON.stringify(stats)); }
function renderStats(){
  if (statWinsEl) statWinsEl.textContent = `${stats.wins||0}`;
  if (statLossesEl) statLossesEl.textContent = `${stats.losses||0}`;
  if (statPushesEl) statPushesEl.textContent = `${stats.pushes||0}`;
}
function checkBankruptState(){
  if (!bankruptOverlay) return;
  const broke = !inRound && playerBank===0;
  bankruptOverlay.classList.toggle('show', broke);
  bankruptOverlay.setAttribute('aria-hidden', broke ? 'false' : 'true');
}
function renderBank(){
  if (bankEl) bankEl.textContent = `$${playerBank}`;
  localStorage.setItem('bjack_bank', playerBank);
  checkBankruptState();
}

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

/* =============== Dealing shoe animation =============== */
function makeFlyingCard(c){
  const div = document.createElement('div');
  div.className = 'flying-card';
  if (c.hidden){ div.classList.add('back'); div.innerHTML = `<div class="big">🂠</div>`; return div; }
  const red = (c.s==='♥'||c.s==='♦'); if (red) div.classList.add('red');
  div.innerHTML = `
    <div class="small">${c.r}</div>
    <div class="big">${c.r}</div>
    <div class="suit">${c.s}</div>
  `;
  return div;
}
function shoeRect(){
  const shoeImg = $('#dealShoe');
  const r = shoeImg?.getBoundingClientRect();
  return r || {left:0, top:0, width:0, height:0};
}
async function flyFromShoeTo(destCardEl, card){
  if (!destCardEl) return;
  const ghost = makeFlyingCard(card);
  document.body.appendChild(ghost);

  const sr = shoeRect();
  const startX = sr.left + sr.width*0.75;
  const startY = sr.top  + sr.height*0.35;
  ghost.style.transform = `translate(${startX}px, ${startY}px) scale(.86)`;
  ghost.style.opacity = '0.85';

  await new Promise(r => requestAnimationFrame(r));
  const dr = destCardEl.getBoundingClientRect();
  const endX = dr.left + (dr.width - ghost.offsetWidth)/2;
  const endY = dr.top  + (dr.height - ghost.offsetHeight)/2;

  await new Promise(r => requestAnimationFrame(r));
  ghost.style.transform = `translate(${endX}px, ${endY}px) scale(1)`;
  ghost.style.opacity = '1';

  await sleep(220);
  ghost.style.opacity = '0';
  await sleep(120);
  ghost.remove();
}
async function renderAndFly(handIdxOrDealer, card){
  if (handIdxOrDealer==='dealer'){
    renderDealer();
    const last = dealerCardsEl.lastElementChild;
    await flyFromShoeTo(last, card);
  } else {
    renderSeat(handIdxOrDealer);
    const last = handEls[handIdxOrDealer].lastElementChild;
    await flyFromShoeTo(last, card);
  }
}

/* =============== Chips / bets UI =============== */
function layoutBetCoins(seatIndex){
  const host = stacks[seatIndex]; if (!host) return;
  const coins = betCoins[seatIndex] || [];
  const denoms = [5,20,50,100];
  const piles = [];
  const byVal = {5:[],20:[],50:[],100:[]};
  coins.forEach(c => byVal[c.value].push(c));
  denoms.forEach(v=>{
    const arr = byVal[v];
    if (!arr.length) return;
    for (let k=0;k<arr.length;k+=MAX_PER_STACK){
      piles.push(arr.slice(k, k+MAX_PER_STACK));
    }
  });

  const areaW = host.clientWidth || 1;
  const totalWidth = (piles.length-1)*H_SPACING + COIN_SIZE;
  const startX = Math.max(0, (areaW - totalWidth)/2);

  piles.forEach((stack, pi)=>{
    const baseX = startX + pi*H_SPACING;
    stack.forEach((coinObj, ci)=>{
      const x = baseX;
      const y = (host.clientHeight - COIN_SIZE) - ci*V_SPACING;
      const rot = (Math.random()*6 - 3).toFixed(1);
      coinObj.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
      coinObj.el.style.zIndex = 100 + pi*MAX_PER_STACK + ci;
      coinObj.el.classList.add('in');
    });
  });
}
function rebuildStacksFromBets(){
  for (let i=0;i<activeSeatsCount;i++){
    const host = stacks[i]; if (!host) continue;
    host.innerHTML = '';
    betCoins[i] = [];
    let r = handBets[i] || 0;
    const denoms = [100,50,20,5];
    for (const d of denoms){
      while (r >= d){
        const el = document.createElement('div');
        el.className = 'coin';
        el.style.backgroundImage = `url('${COIN_SVGS[d]}')`;
        host.appendChild(el);
        betCoins[i].push({value:d, el});
        r -= d;
      }
    }
    layoutBetCoins(i);
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

  const host = stacks[i];
  if (host){
    const coin = document.createElement('div');
    coin.className = 'coin';
    coin.style.backgroundImage = `url('${COIN_SVGS[amount]}')`;
    host.appendChild(coin);
    betCoins[i].push({value:amount, el:coin});

    // fly from chip tray to bet box
    const activeChipBtn = document.querySelector(`#chipsArea .chip-img[data-value="${amount}"]`);
    if (activeChipBtn){
      const from = activeChipBtn.getBoundingClientRect();
      const to   = host.getBoundingClientRect();
      const startX = from.left - to.left + from.width/2  - (COIN_SIZE/2);
      const startY = from.top  - to.top  + from.height/2 - (COIN_SIZE/2);
      coin.style.transform = `translate(${startX}px, ${startY}px) scale(.85)`;
      coin.style.opacity = '0.85';
      requestAnimationFrame(()=> coin.classList.add('in'));
    }
  }
  layoutBetCoins(i);
  updateButtonsForState();
}
function clearBet(i) {
  if (inRound) return;
  handBets[i] = 0;
  betCoins[i] = [];
  if (stacks[i]) stacks[i].innerHTML = '';
  if (betPills[i]) betPills[i].textContent = '$0';
  updateButtonsForState();
}

/* =============== Buttons =============== */
function stageTotal(){ return handBets.slice(0,activeSeatsCount).reduce((a,b)=>a+b,0); }

function updateButtonsForState(){
  const staged = stageTotal();
  const anyStaged = staged > 0;

  // Guard: cannot Deal if staged exceeds bank
  dealBtn.disabled  = inRound || !anyStaged || staged > playerBank;

  rebetBtn.disabled = inRound || !lastBets.slice(0,activeSeatsCount).some(v=>v>0);

  const h = hands[activeSeat] || [];
  const canHit    = inRound && !finished[activeSeat] && total(h) < 21;
  const canStand  = inRound && !finished[activeSeat];
  const canDouble = inRound && !finished[activeSeat] && h.length===2 && playerBank>=handBets[activeSeat];
  const canSplit  = inRound && !finished[activeSeat] && h.length===2 && canRanksSplit(h) && activeSeatsCount<3 && playerBank>=handBets[activeSeat];
  const canClear  = !inRound && (handBets[activeSeat] > 0);

  hitBtn.disabled    = !canHit;
  standBtn.disabled  = !canStand;
  doubleBtn.disabled = !canDouble;
  splitBtn.disabled  = !canSplit;
  if (clearBtn) clearBtn.disabled = !canClear;

  ['dealBtn','rebetBtn','clearBtn','hitBtn','standBtn','doubleBtn','splitBtn'].forEach(id=>{
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
    if (key==='1') addToBet(activeSeat, 5);
    if (key==='2') addToBet(activeSeat, 20);
    if (key==='3') addToBet(activeSeat, 50);
    if (key==='4') addToBet(activeSeat, 100);
    if (key==='0' || key==='x') clearBet(activeSeat);
  }, false);
})();

/* =============== Anim helpers =============== */
async function slowRenderAll(){ renderDealer(); for (let i=0;i<activeSeatsCount;i++) renderSeat(i); await sleep(DEAL_MS); }

/* =============== Round flow =============== */
async function onDeal(){
  if (inRound) return;
  const need = stageTotal(); if (need<=0 || need>playerBank) return;

  // Lock stakes
  lastBets = handBets.slice(0,activeSeatsCount);
  inRound = true; finished=[false,false,false];
  playerBank -= need; renderBank();
  dealer = []; hands=[[],[],[]]; activeSeat = 0;

  clearNode(dealerCardsEl); dealerTotalEl.textContent='';
  for (let i=0;i<activeSeatsCount;i++){ clearNode(handEls[i]); totalEls[i].textContent=''; }

  // Deal sequence:
  for (let i=0;i<activeSeatsCount;i++){
    const c=draw(); c.hidden=false; hands[i].push(c);
    await renderAndFly(i, c);
    await sleep(DEAL_MS);
  }
  const up = draw(); up.hidden=false; dealer.push(up);
  await renderAndFly('dealer', up); await sleep(DEAL_MS);
  for (let i=0;i<activeSeatsCount;i++){
    const c=draw(); c.hidden=false; hands[i].push(c);
    await renderAndFly(i, c);
    await sleep(DEAL_MS);
  }

  // Natural Blackjack autopay (3:2)
  const bjPlans=[];
  for (let i=0;i<activeSeatsCount;i++){
    if (isBlackjack(hands[i])){
      const bet = handBets[i];
      const profit = Math.floor(bet*1.5);
      playerBank += bet + profit;
      finished[i]=true;
      stats.wins++;
      bjPlans.push({seat:i,text:`BJ + $${profit}`,cls:'win'});
    }
  }
  if (bjPlans.length){ saveStats(); renderStats(); }
  renderBank();
  if (bjPlans.length){
    await showPayoutBubbles(bjPlans);
    const allBJ = finished.slice(0,activeSeatsCount).every(Boolean);
    if (allBJ){ await endRoundFadeAndReset(); return; }
  }

  activeSeat = 0; while (activeSeat<activeSeatsCount && finished[activeSeat]) activeSeat++;
  renderAll();
  updateButtonsForState();
}

async function onHit(){
  if (!inRound || finished[activeSeat]) return;
  const h = hands[activeSeat]; if (total(h)>=21) return;
  const c = draw(); c.hidden=false; h.push(c);
  await renderAndFly(activeSeat, c);
  if (total(h)>21){
    await showPayoutBubbles([{seat:activeSeat,text:'BUST!',cls:'lose'}]);
    finished[activeSeat]=true;
    advanceSeatOrDealer();
  }
  else if (total(h)>=21){ finished[activeSeat]=true; advanceSeatOrDealer(); }
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
  const c = draw(); c.hidden=false; hands[activeSeat].push(c);
  await renderAndFly(activeSeat, c);
  if (total(hands[activeSeat])>21){
    await showPayoutBubbles([{seat:activeSeat,text:'BUST!',cls:'lose'}]);
  }
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
    hands[i]=hands[i-1]; handBets[i]=handBets[i-1]; finished[i]=finished[i-1];
  }
  const moved = h.pop();
  hands[insertAt] = [moved];
  finished[insertAt]=false;

  handBets[insertAt] = stake;
  playerBank -= stake; renderBank();

  for (let i=0;i<activeSeatsCount;i++){ if (betPills[i]) betPills[i].textContent = `$${handBets[i]||0}`; }
  rebuildStacksFromBets();

  const c1 = draw(); c1.hidden=false; hands[activeSeat].push(c1); await renderAndFly(activeSeat, c1);
  const c2 = draw(); c2.hidden=false; hands[insertAt].push(c2); await renderAndFly(insertAt, c2);
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
    if (total(hands[i])>21){
      plans.push({seat:i,text:`– $${bet}`,cls:'lose'});
      stats.losses++;
    }
  }
  saveStats(); renderStats();
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
    await renderAndFly('dealer', hole);
  }
  while (true){
    const t = total(dealer);
    if (t<17 || isSoft17(dealer)){
      const c=draw(); c.hidden=false; dealer.push(c);
      await renderAndFly('dealer', c);
    } else break;
  }

  const d = Number.isFinite(Number(total(dealer))) ? Number(total(dealer)) : 0;
  const plans=[];
  for (let i=0;i<activeSeatsCount;i++){
    const bet = handBets[i]; if(!bet||bet<=0) continue;
    const p = Number.isFinite(Number(total(hands[i]))) ? Number(total(hands[i])) : 0;
    let plan;
    if (p>21){ plan={seat:i,text:`– $${bet}`,cls:'lose'}; stats.losses++; }
    else if (d>21){ playerBank+=bet*2; plan={seat:i,text:`+ $${bet}`,cls:'win'}; stats.wins++; }
    else if (p>d){ playerBank+=bet*2; plan={seat:i,text:`+ $${bet}`,cls:'win'}; stats.wins++; }
    else if (p===d){ playerBank+=bet; plan={seat:i,text:`Push`,cls:'push'}; stats.pushes++; }
    else { plan={seat:i,text:`– $${bet}`,cls:'lose'}; stats.losses++; }
    plans.push(plan);
  }
  saveStats(); renderStats();
  renderBank();
  await showPayoutBubbles(plans);
  await endRoundFadeAndReset();
}

/* =============== Bubbles & end reset =============== */
async function showPayoutBubbles(plans){
  plans.forEach(p=>{
    const seat = seatRoots[p.seat];
    const anchor = seat.querySelector('.cards') || seat;
    let div = anchor.querySelector('.payout');
    if(!div){ div=document.createElement('div'); div.className='payout'; anchor.appendChild(div); }
    div.textContent=p.text;
    div.className=`payout ${p.cls}`;
    requestAnimationFrame(()=> div.classList.add('show'));
  });
  await sleep(1000);
  plans.forEach(p=>{
    const anchor = (seatRoots[p.seat].querySelector('.cards') || seatRoots[p.seat]);
    const div = anchor.querySelector('.payout'); if(div) div.classList.remove('show');
  });
}
async function endRoundFadeAndReset(){
  $('#dealerArea')?.classList.add('fade-out');
  seatRoots.forEach(s=>s.classList.add('fade-out'));
  await sleep(END_FADE_MS);

  dealer=[]; for(let i=0;i<MAX_SEATS;i++){ hands[i]=[]; finished[i]=false; }
  clearNode(dealerCardsEl); dealerTotalEl.textContent='';
  handEls.forEach(el=> clearNode(el)); totalEls.forEach(el=> el.textContent='');
  stacks.forEach(h => h && (h.innerHTML='')); betCoins.forEach(arr => arr.length=0);

  inRound=false; activeSeat=0;
  seatRoots.forEach(s=>s.classList.remove('fade-out'));
  $('#dealerArea')?.classList.remove('fade-out');
  checkBankruptState();
  updateButtonsForState();
}

/* =============== Rebet (bank‑aware) =============== */
function onRebet(){
  if (inRound) return;
  if (!lastBets.slice(0,activeSeatsCount).some(v=>v>0)) return;

  // Build as much of lastBets as the bank allows (left-to-right seats)
  handBets = [0,0,0];
  let remaining = playerBank;
  let trimmed = false;

  for (let i=0; i<activeSeatsCount; i++){
    const want = lastBets[i] || 0;
    const put  = Math.min(want, remaining);
    handBets[i] = put;
    if (put < want) trimmed = true;
    remaining -= put;
  }

  // Update UI
  for (let i=0;i<activeSeatsCount;i++){
    if (betPills[i]) betPills[i].textContent = `$${handBets[i]||0}`;
  }
  rebuildStacksFromBets();
  updateButtonsForState();

  if (trimmed){
    const tray = $('#chipsArea');
    tray?.classList.add('shake');
    setTimeout(()=> tray?.classList.remove('shake'), 300);
  }
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
      updateButtonsForState();
    });
    const box=root.querySelector('.bet-box');
    if(box){
      box.addEventListener('click',(e)=>{
        if(inRound) return;
        e.stopPropagation();
        seatRoots.forEach(r=>r.classList.remove('active'));
        root.classList.add('active');
        activeSeat=idx;
        updateButtonsForState();
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
  clearBtn ?.addEventListener('click', ()=> clearBet(activeSeat));
  hitBtn   .addEventListener('click', onHit);
  standBtn .addEventListener('click', onStand);
  doubleBtn.addEventListener('click', onDouble);
  splitBtn .addEventListener('click', onSplit);
  restartBankBtn?.addEventListener('click', ()=>{
    playerBank = 1000;
    localStorage.removeItem('bjack_bank');
    renderBank();
    updateButtonsForState();
  });
}
function bindSeatToggle(){
  seatTogBtns.forEach(b=>{
    b.addEventListener('click',()=>{
      if(inRound) return;
      seatTogBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      activeSeatsCount=parseInt(b.getAttribute('data-seats'),10)||1;
      activeSeat = Math.min(activeSeat, activeSeatsCount-1);
      applySeatLayout(); updateButtonsForState();
    });
  });
}

/* =============== Boot =============== */
function boot(){
  applySeatLayout();
  bindSeatClicks(); bindChips(); bindActions(); bindSeatToggle();
  renderStats();
  renderBank(); renderAll();
  rebuildStacksFromBets();
}
document.addEventListener('DOMContentLoaded', boot);