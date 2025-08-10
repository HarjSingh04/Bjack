/* ==============================
   HS Blackjack — script.js
   ============================== */

let playerBank = 500;
let activeSeatsCount = 1;
let stagedBets = [0,0,0]; // seat 1..3
let currentHands = [];
let dealerHand = [];
let deck = [];
let seats = []; // seat DOM refs
let BUILD = 1.02; // increment when deploying

// ===== BOOT =====
document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  applySeatLayout();
  renderBank();
  initChips();
  initActions();
  initSeatToggle();
  initProfilePanel();
  registerSW();
});

function cacheDom(){
  seats = Array.from(document.querySelectorAll('.seat')).map(seat => ({
    root: seat,
    cards: seat.querySelector('.cards'),
    total: seat.querySelector('.total'),
    bet: seat.querySelector('.bet'),
    stack: seat.querySelector('.bet-stack')
  }));
}

// ===== LAYOUT CONTROL =====
function applySeatLayout(){
  const area = document.getElementById('seatsArea');
  area.classList.remove('solo','duo','trio');
  area.classList.add(activeSeatsCount === 1 ? 'solo' : activeSeatsCount === 2 ? 'duo' : 'trio');
  seats.forEach((s,i) => {
    const on = i < activeSeatsCount;
    s.root.style.visibility = on ? 'visible' : 'hidden';
    if(!on){
      s.cards.innerHTML = '';
      s.total.textContent = '';
      stagedBets[i] = 0;
      s.bet.textContent = '$0';
      s.stack.innerHTML = '';
    }
  });
}

// ===== CHIPS =====
function initChips(){
  document.querySelectorAll('.chip-img').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = parseInt(chip.dataset.value, 10);
      // Find active seat (first visible)
      const seatIndex = seats.findIndex(s => s.root.classList.contains('active'));
      if(seatIndex >= 0){
        stagedBets[seatIndex] += val;
        updateBetDisplay(seatIndex);
        addChipToStack(seatIndex, val);
      }
    });
  });
}
function updateBetDisplay(i){
  seats[i].bet.textContent = `$${stagedBets[i]}`;
}
function addChipToStack(seatIndex, val){
  const chip = document.createElement('div');
  chip.className = `chip-token v${val}`;
  chip.innerHTML = `<span>${val}</span>`;
  seats[seatIndex].stack.appendChild(chip);
  setTimeout(()=> chip.classList.add('in'), 10);
}

// ===== ACTIONS =====
function initActions(){
  document.getElementById('dealBtn').addEventListener('click', startRound);
  document.getElementById('hitBtn').addEventListener('click', ()=>playerAction('hit'));
  document.getElementById('standBtn').addEventListener('click', ()=>playerAction('stand'));
  document.getElementById('doubleBtn').addEventListener('click', ()=>playerAction('double'));
  document.getElementById('splitBtn').addEventListener('click', ()=>playerAction('split'));
}

function dimActionButtons(state){
  document.querySelectorAll('#actionButtons button').forEach(btn=>{
    if(state && !btn.classList.contains('always')) btn.classList.add('dimmed');
    else btn.classList.remove('dimmed');
  });
}

// ===== DEALER =====
function dealCard(to, faceUp=true){
  const card = deck.pop();
  to.push(card);
  return card;
}

function renderHand(hand, container){
  container.innerHTML = '';
  hand.forEach(card=>{
    const el = document.createElement('div');
    el.className = 'card';
    if(!card.faceUp) el.classList.add('back');
    else{
      el.innerHTML = `<div class="small">${card.rank}</div>
                      <div class="big">${card.rank}</div>
                      <div class="suit">${card.suit}</div>`;
      if(card.suit === '♥' || card.suit === '♦') el.classList.add('red');
    }
    container.appendChild(el);
  });
}

function startRound(){
  if(!stagedBets.some(b=>b>0)) return;
  buildDeck();
  currentHands = [];
  dealerHand = [];
  deck = shuffle(deck);
  // Lock in bets
  stagedBets.forEach((b,i)=>{
    if(b>0) playerBank -= b;
  });
  renderBank();
  // Deal initial cards
  for(let r=0; r<2; r++){
    for(let s=0; s<activeSeatsCount; s++){
      const c = dealCard(currentHands[s] = currentHands[s] || [], true);
      renderHand(currentHands[s], seats[s].cards);
    }
    const dealerFaceUp = !(r===0 && false); // first card face up
    dealCard(dealerHand, dealerFaceUp);
  }
  renderHand(dealerHand, document.querySelector('#dealerArea .cards'));
  updateTotals();
}

function playerAction(type){
  console.log(`Player chooses ${type}`);
  // Implement logic rules
}

// ===== RULES & CALC =====
function handValue(hand){
  let total = 0, aces=0;
  hand.forEach(c=>{
    if(['J','Q','K'].includes(c.rank)) total += 10;
    else if(c.rank === 'A'){ total += 11; aces++; }
    else total += parseInt(c.rank, 10);
  });
  while(total>21 && aces>0){
    total -= 10; aces--;
  }
  return total;
}

function updateTotals(){
  currentHands.forEach((h,i)=>{
    seats[i].total.textContent = handValue(h);
  });
  document.querySelector('#dealerArea .total').textContent = handValue(dealerHand);
}

function renderBank(){
  document.getElementById('playerBank').textContent = `$${playerBank}`;
}

// ===== SEAT TOGGLE =====
function initSeatToggle(){
  document.querySelectorAll('#seatToggle button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#seatToggle button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      activeSeatsCount = parseInt(btn.dataset.count, 10);
      applySeatLayout();
    });
  });
}

// ===== PROFILE =====
function initProfilePanel(){
  const profileBtn = document.querySelector('.profile-btn');
  const panel = document.getElementById('profilePanel');
  const closeBtn = panel.querySelector('.close-btn');
  profileBtn.addEventListener('click', ()=> panel.classList.add('open'));
  closeBtn.addEventListener('click', ()=> panel.classList.remove('open'));
}

// ===== SW =====
function registerSW(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').then(()=>{
      console.log('SW registered');
    });
  }
}

// ===== DECK =====
function buildDeck(){
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  deck = [];
  suits.forEach(suit=>{
    ranks.forEach(rank=>{
      deck.push({rank, suit, faceUp:true});
    });
  });
}
function shuffle(array){
  let m = array.length, i;
  while(m){
    i = Math.floor(Math.random()*m--);
    [array[m], array[i]] = [array[i], array[m]];
  }
  return array;
}