/* ==============================
   HS Blackjack — script.js
   ============================== */

// ---------- Build + fresh loader + SW ----------
const BUILD = '2025-08-10-02'; // bump when deploying

(async function freshLoader(){
  const q = new URLSearchParams(location.search);
  if (q.has('fresh')) {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in self) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    q.delete('fresh');
    const url = location.pathname + (q.toString() ? `?${q}` : '');
    location.replace(url);
  }
})();

window.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('buildBadge');
  if (badge) badge.textContent = `HS Blackjack • v${BUILD}`;
});

// Register SW with version cache-bust
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`./sw.js?v=${BUILD}`).catch(()=>{});
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
}

// ---------- State ----------
let playerBank = 1000;
let activeSeatsCount = 1;        // 1 by default (solo)
let stagedBets = [0,0,0];        // visual bets before deal
let currentHands = [[],[],[]];
let dealerHand = [];
let deck = [];

let seats = [];                  // DOM refs
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  ensureSeat1Active();           // <— important: Seat 1 is active target for chips
  applySeatLayout();             // solo/duo/trio positioning
  renderBank();
  initChips();
  initActions();
  initSeatToggle();
  initProfilePanel();
});

// ---------- DOM cache ----------
function cacheDom(){
  seats = Array.from(document.querySelectorAll('.seat')).map(seat => ({
    root: seat,
    cards: seat.querySelector('.cards'),
    total: seat.querySelector('.total'),
    bet: seat.querySelector('.bet'),
    stack: seat.querySelector('.bet-stack')
  }));
}

function ensureSeat1Active(){
  // Visually mark Seat 1 as active so chips have a target
  seats.forEach(s => s.root.classList.remove('active'));
  if (seats[0]) seats[0].root.classList.add('active');
}

// ---------- Layout control ----------
function applySeatLayout(){
  const area = document.getElementById('seatsArea');
  area.classList.remove('solo','duo','trio');
  area.classList.add(activeSeatsCount === 1 ? 'solo' : activeSeatsCount === 2 ? 'duo' : 'trio');

  seats.forEach((s,i) => {
    const on = i < activeSeatsCount;
    s.root.style.visibility = on ? 'visible' : 'hidden';
    if (!on) {
      s.cards.innerHTML = '';
      s.total.textContent = '';
      stagedBets[i] = 0;
      s.bet.textContent = '$0';
      s.stack.innerHTML = '';
    }
  });
}

// ---------- Chips (tray -> staged bet) ----------
function initChips(){
  $$('#chipsArea .chip-img').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = parseInt(chip.dataset.value, 10);
      // Put chips on the FIRST ACTIVE seat (Seat 1 by default)
      const seatIndex = seats.findIndex(s => s.root.classList.contains('active'));
      const idx = seatIndex >= 0 ? seatIndex : 0;
      if (idx >= activeSeatsCount) return; // ignore invisible seats

      stagedBets[idx] += val;
      updateBetDisplay(idx);
      addChipToStack(idx, val);
    });
  });

  // Tap the bet pill to remove the LAST chip placed (nice UX)
  seats.forEach((s, idx) => {
    s.bet.addEventListener('click', () => {
      if (idx >= activeSeatsCount) return;
      const removed = removeLastChipToken(idx);
      if (removed > 0) {
        stagedBets[idx] = Math.max(0, stagedBets[idx] - removed);
        updateBetDisplay(idx);
      }
    });
  });

  // Allow tapping a seat card area to mark it active (when 2–3 seats visible)
  seats.forEach((s, idx) => {
    s.root.addEventListener('click', (e) => {
      // ignore clicks on buttons/bet pill
      if (e.target.closest('.bet') || e.target.closest('button')) return;
      if (idx >= activeSeatsCount) return;
      seats.forEach(t => t.root.classList.remove('active'));
      s.root.classList.add('active');
    });
  });
}

function updateBetDisplay(i){
  seats[i].bet.textContent = `$${stagedBets[i]}`;
}

// Visual stacking
function addChipToStack(seatIndex, value){
  const stack = seats[seatIndex].stack;
  const token = document.createElement('div');
  token.className = `chip-token v${value}`;
  token.innerHTML = `<span>$${value}</span>`;

  // simple fan/elevation
  const count = stack.children.length;
  const x = (-4 + (count % 3) * 4);
  const y = count * 6;
  token.style.transform = `translate(${x}px, ${12 - y}px) scale(.8)`;
  token.style.zIndex = String(100 + count);

  stack.appendChild(token);
  requestAnimationFrame(()=>{
    token.classList.add('in');
    token.style.transform = `translate(${x}px, ${-y}px) scale(1)`;
  });
}

function removeLastChipToken(seatIndex){
  const stack = seats[seatIndex].stack;
  const last = stack.lastElementChild;
  if (!last) return 0;
  const val = parseInt(last.className.match(/v(\d+)/)?.[1] || '0', 10);
  last.classList.remove('in');
  last.style.transform += ' translateY(10px) scale(.9)';
  last.style.opacity = '0';
  setTimeout(()=> last.remove(), 180);
  return val;
}

// ---------- Actions ----------
function initActions(){
  $('#dealBtn').addEventListener('click', startRound);
  $('#hitBtn').addEventListener('click', ()=> playerAction('hit'));
  $('#standBtn').addEventListener('click', ()=> playerAction('stand'));
  $('#doubleBtn').addEventListener('click', ()=> playerAction('double'));
  $('#splitBtn').addEventListener('click', ()=> playerAction('split'));
}

function dimActionButtons(dim){
  $$('#actionButtons button').forEach(btn=>{
    if (dim) btn.classList.add('dimmed'); else btn.classList.remove('dimmed');
  });
}

// ---------- Simple dealing (placeholder rules) ----------
function startRound(){
  // basic guard: need at least one seat with chips
  const anyBet = stagedBets.slice(0, activeSeatsCount).some(b => b > 0);
  if (!anyBet) return;

  // lock bets -> subtract from bank
  for (let i=0;i<activeSeatsCount;i++){
    playerBank -= stagedBets[i];
  }
  renderBank();

  // build & shuffle one deck (expand later)
  buildDeck(); shuffle(deck);

  // clear hands
  currentHands = [[],[],[]];
  dealerHand = [];

  // initial deal P1..PN, D up, P1..PN, D down (visual only)
  for (let r=0; r<2; r++){
    for (let s=0; s<activeSeatsCount; s++){
      dealToPlayer(s, true);
    }
    // dealer: first up, second back
    const faceUp = r === 0 ? true : false;
    dealToDealer(faceUp);
  }

  // lock chip stacks visually during the hand
  lockStacks();
  updateTotals();
  dimActionButtons(false); // show actions (we’ll add full rules gating next)
}

function dealToPlayer(i, faceUp){
  const card = drawCard(faceUp);
  currentHands[i].push(card);
  renderHand(currentHands[i], seats[i].cards);
}

function dealToDealer(faceUp){
  const card = drawCard(faceUp);
  dealerHand.push(card);
  renderHand(dealerHand, $('#dealerCards'));
}

function playerAction(type){
  // placeholder to avoid JS errors while we layer rules later
  console.log('action:', type);
}

function renderHand(hand, container){
  container.innerHTML = '';
  hand.forEach(c=>{
    const el = document.createElement('div');
    el.className = 'card deal' + ((c.suit==='♥'||c.suit==='♦') ? ' red' : '');
    if (!c.faceUp) {
      el.classList.add('back');
      el.textContent = '🂠';
    } else {
      el.innerHTML = `
        <span class="small">${c.rank}</span>
        <span class="big">${c.rank}</span>
        <span class="suit">${c.suit}</span>`;
    }
    container.appendChild(el);
    // trigger animation
    requestAnimationFrame(()=> el.classList.add('show'));
  });
}

function updateTotals(){
  for (let i=0;i<activeSeatsCount;i++){
    seats[i].total.textContent = handValue(currentHands[i]);
  }
  $('#dealerTotal').textContent = handValue(dealerHand.filter(c=>c.faceUp));
}

function handValue(hand){
  let total=0, aces=0;
  for(const c of hand){
    if (!c.faceUp) continue;
    if (c.rank==='A'){ total+=11; aces++; }
    else if (['K','Q','J'].includes(c.rank)) total+=10;
    else total+=parseInt(c.rank,10);
  }
  while (total>21 && aces>0){ total-=10; aces--; }
  return total || '';
}

// ---------- Seat toggle ----------
function initSeatToggle(){
  $$('#seatToggle button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('#seatToggle button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');

      // IMPORTANT: read data-seats (not data-count)
      activeSeatsCount = parseInt(btn.dataset.seats, 10) || 1;

      // keep Seat 1 active highlight
      ensureSeat1Active();
      applySeatLayout();
    });
  });
}

// ---------- Profile panel ----------
function initProfilePanel(){
  const profileBtn = $('#profileBtn');
  const panel = $('#profilePanel');
  const closeBtn = $('#closeProfile');
  profileBtn?.addEventListener('click', ()=> panel.classList.add('open'));
  closeBtn?.addEventListener('click', ()=> panel.classList.remove('open'));

  // Reset Bank
  $('#resetBank')?.addEventListener('click', ()=>{
    playerBank = 1000;
    renderBank();
    // clear staged bets and visual stacks
    for (let i=0;i<3;i++){
      stagedBets[i]=0;
      seats[i].bet.textContent = '$0';
      seats[i].stack.innerHTML = '';
    }
  });

  // Reset Stats (basic: bank + local prefs if you add later)
  $('#resetStats')?.addEventListener('click', ()=>{
    playerBank = 1000;
    renderBank();
    location.href = location.pathname + '?fresh=1';
  });
}

function renderBank(){
  $('#playerBank').textContent = `$${playerBank}`;
}

// ---------- Helpers ----------
function lockStacks(){
  seats.slice(0,activeSeatsCount).forEach(s=>{
    [...s.stack.children].forEach(el => el.classList.add('locked'));
  });
}

function buildDeck(){
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  deck = [];
  for (const suit of suits){
    for (const rank of ranks){
      deck.push({ rank, suit, faceUp:true });
    }
  }
}

function shuffle(arr){
  for (let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function drawCard(faceUp=true){
  if (deck.length === 0) buildDeck(), shuffle(deck);
  const c = deck.pop();
  c.faceUp = faceUp;
  return c;
}