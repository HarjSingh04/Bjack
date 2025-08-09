/* ============================
   HS Blackjack — script.js
   ============================
   - Build badge + fresh loader (?fresh=1)
   - SW versioning tied to BUILD
   - Slow one-by-one deal
   - Multi-hand (1–3) with chip betting
   - Naturals 3:2, doubles 9/10/11, Crown splits to 3 hands
   - Insurance (Vegas/hole-card mode)
   - Stop actions at 21, correct payouts
================================ */

// ----- Build / Fresh loader / SW registration -----
const BUILD = '2025-08-09-03'; // bump this when you deploy

(async function freshLoader(){
  const params = new URLSearchParams(location.search);
  if (params.has('fresh')) {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    params.delete('fresh');
    const url = location.pathname + (params.toString() ? `?${params}` : '');
    location.replace(url);
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('buildBadge');
  if (badge) badge.textContent = `HS Blackjack • v${BUILD}`;
});

if ('serviceWorker' in navigator) {
  const swVersion = BUILD; // keep SW in sync with BUILD
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register(`./sw.js?v=${swVersion}`, { scope: './' }).catch(()=>{});
  });
  navigator.serviceWorker.addEventListener('controllerchange', ()=>window.location.reload());
}

// ----- Shortcuts -----
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// UI refs
const profileBtn = $('#profileBtn');
const profilePanel = $('#profilePanel');
const closeProfileBtn = $('#closeProfile');

const playerNameEl = $('#playerName');
const playerBankEl = $('#playerBank');
const playerAvatarBtn = $('#playerAvatar');
const profileAvatar = $('#profileAvatar');
const nameInput = $('#nameInput');

const themeSelect = $('#themeSelect');
const chipThemeSelect = $('#chipTheme');
const soundToggle = $('#soundToggle');

const ruleSetEl = $('#ruleSet');     // crown / vegas
const deckCountEl = $('#deckCount');

const dealerCardsEl = $('#dealerCards');
const dealerTotalEl = $('#dealerTotal');

const seatButtons = $$('#seatToggle button');
const seats = [1,2,3].map(i => ({
  root:  document.querySelector(`.seat[data-seat="${i}"]`),
  bet:   document.querySelector(`#bet${i}`),
  cards: document.querySelector(`#hand${i}`),
  total: document.querySelector(`#total${i}`)
}));

const chips = $$('#chipsArea .chip');
const dealBtn   = $('#dealBtn');
const hitBtn    = $('#hitBtn');
const standBtn  = $('#standBtn');
const doubleBtn = $('#doubleBtn');
const splitBtn  = $('#splitBtn');

// Insurance bar
const insuranceBar = $('#insuranceBar');
const insYes = $('#insYes');
const insNo = $('#insNo');

// ----- Persisted settings -----
let name   = localStorage.getItem('bj_name') || 'Player';
let ini    = localStorage.getItem('bj_ini')  || initialsFromName(name);
let bank   = parseInt(localStorage.getItem('bj_bank') || '1000', 10);
let theme  = localStorage.getItem('bj_theme') || 'midnight';
let chipTheme = localStorage.getItem('bj_chipTheme') || 'classic';
let muted  = localStorage.getItem('bj_muted') === 'true';
let ruleSet = localStorage.getItem('bj_rule') || 'crown';   // crown (ENHC S17) | vegas (hole card)
let deckCount = parseInt(localStorage.getItem('bj_decks') || '6', 10);

// ----- Runtime state -----
let activeSeatsCount = 1;      // 1..3
let stagedBets = [0,0,0];      // before deal
let inRound = false;

let dealer = [];
let playerHands = [[],[],[]];
let handBets = [0,0,0];
let doubled  = [false,false,false];
let splitCount=[0,0,0];        // per seat index; 0->1->2 means 3 hands max
let finished = [false,false,false];
let hideHole = true;
let vegasHole = false;
let activeHandIndex = 0;

let insuranceOffered = false;
let insuranceTaken = false;
let insuranceStake = 0;

// ----- Sounds -----
const ctx = new (window.AudioContext || window.webkitAudioContext)();
function beep(f=600,d=.05,t='sine',v=.03){
  if(muted) return;
  const o=ctx.createOscillator(), g=ctx.createGain();
  o.type=t; o.frequency.value=f; g.gain.value=v;
  o.connect(g); g.connect(ctx.destination);
  o.start();
  setTimeout(()=>{ try{o.stop()}catch{} }, d*1000);
}
const s_deal = () => beep(700,.04,'square');
const s_click= () => beep(500,.03,'triangle');
const s_bust = () => beep(250,.25,'sawtooth',.05);
const s_win  = () => { beep(880,.08,'square'); setTimeout(()=>beep(980,.08,'square'),100); };
const s_lose = () => beep(330,.12,'triangle');
const s_push = () => beep(660,.08,'sine');
const s_shuffle=()=> beep(220,.08,'sine');

// ----- Cards / shoe -----
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
let shoe = [], cutIndex = 0;

function newShoe(decks){
  const s=[];
  for(let d=0; d<decks; d++){
    for(const su of SUITS) for(const r of RANKS) s.push({rank:r,suit:su});
  }
  for(let i=s.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [s[i],s[j]]=[s[j],s[i]]; }
  cutIndex = Math.floor(s.length * 0.25);  // reshuffle when 75% used
  s_shuffle();
  return s;
}
function ensureShoe(){
  if (shoe.length===0) shoe = newShoe(deckCount);
  if (shoe.length <= cutIndex) shoe = newShoe(deckCount);
}
function draw(){
  ensureShoe();
  s_deal();
  return shoe.pop();
}

function cardValue(rank){
  if(rank==='A') return 11;
  if(rank==='K'||rank==='Q'||rank==='J') return 10;
  return parseInt(rank,10);
}
function handValue(cards){
  let total=0, aces=0;
  for(const c of cards){ total+=cardValue(c.rank); if(c.rank==='A') aces++; }
  while(total>21 && aces>0){ total-=10; aces--; }
  return total;
}
function isSoft(cards){
  let total=0, aces=0;
  for(const c of cards){ total+=cardValue(c.rank); if(c.rank==='A') aces++; }
  while(total>21 && aces>0){ total-=10; aces--; }
  return aces>0 && total<=21;
}
const isBlackjack = cards => cards.length===2 && handValue(cards)===21;

// ----- Helpers -----
function initialsFromName(n){
  const p = n.trim().split(/\s+/).slice(0,2).map(s=>s[0]||'').join('');
  return (p || 'PL').toUpperCase();
}
function setBank(v){ bank=v; playerBankEl.textContent = '$'+bank; localStorage.setItem('bj_bank', String(bank)); }
function setThemeClass(t){
  document.body.classList.remove('theme-green','theme-midnight','theme-classic');
  const cls = t==='green'?'theme-green':t==='classic'?'theme-classic':'theme-midnight';
  document.body.classList.add(cls);
}
function setChipThemeClass(t){
  document.body.classList.remove('chip-classic','chip-neon','chip-mono');
  document.body.classList.add('chip-'+t);
}
function seatActive(i){ return i < activeSeatsCount; }

function renderCard(el, card, faceDown=false){
  const d = document.createElement('div');
  if(faceDown){
    d.className = 'card back deal';
    d.textContent = '🂠';
    el.appendChild(d);
    requestAnimationFrame(()=> d.classList.add('show'));
    return;
  }
  const red = (card.suit==='♥' || card.suit==='♦') ? ' red':'';
  d.className = 'card deal' + red;
  d.innerHTML = `<span class="small">${card.rank}</span>
                 <span class="big">${card.rank}</span>
                 <span class="suit">${card.suit}</span>`;
  el.appendChild(d);
  requestAnimationFrame(()=> d.classList.add('show'));
}

function renderDealer(){
  dealerCardsEl.innerHTML='';
  dealer.forEach((c,i)=>{
    const faceDown = (hideHole && vegasHole && i===1);
    renderCard(dealerCardsEl, c, faceDown);
  });
  const v = handValue(hideHole && vegasHole ? [dealer[0]] : dealer);
  dealerTotalEl.textContent = (dealer.length ? v : '');
}
function renderSeats(){
  seats.forEach((s,idx)=>{
    s.root.classList.toggle('active', idx===activeHandIndex && inRound);
    s.cards.innerHTML='';
    if(!seatActive(idx)) { s.bet.textContent = '$0'; s.total.textContent=''; return; }
    for(const c of playerHands[idx]) renderCard(s.cards, c, false);
    s.bet.textContent = '$'+handBets[idx];
    const v = handValue(playerHands[idx]);
    s.total.textContent = v ? v : '';
  });
}
function renderAll(){
  renderDealer();
  renderSeats();
  const h = playerHands[activeHandIndex] || [];
  const v = handValue(h);
  const canAct = inRound && v < 21;

  hitBtn.disabled    = !canAct;
  standBtn.disabled  = !inRound;

  // Double: 9/10/11 only on first two cards and enough bank
  const hv = handValue(h);
  doubleBtn.disabled = !inRound || h.length!==2 || ![9,10,11].includes(hv) || bank < handBets[activeHandIndex];

  // Split: up to 3 hands total (splitCount 0->1->2)
  const canSplit = inRound && h.length===2 && h[0]?.rank===h[1]?.rank && (splitCount[activeHandIndex] < 2);
  splitBtn.disabled = !canSplit;
}

// ----- Seat toggle + betting -----
seatButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(inRound) return;
    seatButtons.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    activeSeatsCount = parseInt(btn.dataset.seats,10);
    seats.forEach((s,i)=>{ if(i>=activeSeatsCount) { stagedBets[i]=0; s.bet.textContent='$0'; } });
    s_click();
  });
});

chips.forEach(ch=>{
  ch.addEventListener('click', ()=>{
    if(inRound) return;
    const val = parseInt(ch.dataset.value,10);
    // add to the lowest bet among active seats (balances your bets)
    let idx = 0, minBet = Infinity;
    for(let i=0;i<activeSeatsCount;i++){
      if(stagedBets[i] < minBet){ minBet=stagedBets[i]; idx=i; }
    }
    stagedBets[idx] += val;
    seats[idx].bet.textContent = '$'+stagedBets[idx];
    s_click();
  });
});
// Tap bet pill to remove chips greedily
seats.forEach((s,idx)=>{
  s.bet.parentElement.addEventListener('click', ()=>{
    if(inRound || idx>=activeSeatsCount) return;
    const order=[100,50,20,5];
    for(const c of order){
      if(stagedBets[idx]-c>=0){
        stagedBets[idx]-=c; seats[idx].bet.textContent='$'+stagedBets[idx]; s_click(); break;
      }
    }
  });
});

// ----- Profile panel -----
function openProfile(){ profilePanel.classList.add('open'); }
function closeProfile(){ profilePanel.classList.remove('open'); }
profileBtn.addEventListener('click', openProfile);
closeProfileBtn.addEventListener('click', closeProfile);

// Name & initials
nameInput.value = name;
playerNameEl.textContent = name;
playerAvatarBtn.textContent = ini;
profileAvatar.textContent = ini;
nameInput.addEventListener('input', ()=>{
  name = nameInput.value.trim() || 'Player';
  playerNameEl.textContent = name;
  const newIni = initialsFromName(name);
  if(ini.length<=2){ ini=newIni; playerAvatarBtn.textContent=ini; profileAvatar.textContent=ini; localStorage.setItem('bj_ini', ini); }
  localStorage.setItem('bj_name', name);
});

// Themes / chip themes / sound
themeSelect.value = theme; setThemeClass(theme);
chipThemeSelect.value = chipTheme; setChipThemeClass(chipTheme);
soundToggle.checked = !muted;

themeSelect.addEventListener('change', ()=>{ theme = themeSelect.value; localStorage.setItem('bj_theme', theme); setThemeClass(theme); });
chipThemeSelect.addEventListener('change', ()=>{ chipTheme = chipThemeSelect.value; localStorage.setItem('bj_chipTheme', chipTheme); setChipThemeClass(chipTheme); });
soundToggle.addEventListener('change', ()=>{ muted = !soundToggle.checked; localStorage.setItem('bj_muted', String(muted)); });

// Rules + decks
ruleSetEl.value = ruleSet;
deckCountEl.value = deckCount;
ruleSetEl.addEventListener('change', ()=>{ ruleSet = ruleSetEl.value; localStorage.setItem('bj_rule', ruleSet); });
deckCountEl.addEventListener('change', ()=>{
  deckCount = Math.max(1, Math.min(8, parseInt(deckCountEl.value||'6',10)));
  localStorage.setItem('bj_decks', String(deckCount));
  shoe = []; // force rebuild next draw
});

// ----- Round flow -----
const DEAL_GAP = 320;

function resetRoundState(){
  dealer = [];
  playerHands = [[],[],[]];
  handBets = [0,0,0];
  doubled  = [false,false,false];
  splitCount=[0,0,0];
  finished = [false,false,false];
  hideHole = true;
  vegasHole = (ruleSet==='vegas');
  activeHandIndex = 0;

  insuranceOffered = false;
  insuranceTaken = false;
  insuranceStake = 0;
  insuranceBar.classList.add('hidden');
}

function validateBets(){
  let total=0;
  for(let i=0;i<activeSeatsCount;i++){ handBets[i] = stagedBets[i]||0; total += handBets[i]; }
  if(total<=0){ toast("Add chips to your seats first."); return false; }
  if(total>bank){ toast("Total bet exceeds bank."); return false; }
  return true;
}

function toast(msg){ dealerTotalEl.textContent = msg; setTimeout(()=>{ dealerTotalEl.textContent=''; }, 1500); }

async function startRound(){
  if(inRound) return;
  if(!validateBets()) return;

  // Lock in bets and deduct from bank
  let total=0; for(let i=0;i<activeSeatsCount;i++) total+=handBets[i];
  setBank(bank - total);

  inRound = true;
  resetRoundState();

  // first pass (players)
  for(let i=0;i<activeSeatsCount;i++){
    playerHands[i].push(draw()); renderAll(); await sleep(DEAL_GAP);
  }
  // dealer upcard
  dealer.push(draw()); renderAll(); await sleep(DEAL_GAP);

  // second pass (players)
  for(let i=0;i<activeSeatsCount;i++){
    playerHands[i].push(draw()); renderAll(); await sleep(DEAL_GAP);
  }

  // dealer hole card (Vegas only)
  if(vegasHole){ dealer.push(draw()); renderAll(); await sleep(DEAL_GAP); }

  // Insurance?
  if(vegasHole && dealer[0] && dealer[0].rank==='A'){
    await offerInsurance();
    if(isBlackjack(dealer)){
      settleDealerBlackjackAfterInsurance();
      return;
    }
  }

  // Instant naturals
  if(resolveNaturals()) return;

  activeHandIndex = 0;
  renderAll();
}
dealBtn.addEventListener('click', startRound);

async function offerInsurance(){
  insuranceOffered = true;
  insuranceTaken = false;
  const maxIns = Math.floor(totalPlayerBet()/2);
  insuranceBar.classList.remove('hidden');

  const choice = await new Promise(res=>{
    const yes = ()=>{ insYes.removeEventListener('click', yes); insNo.removeEventListener('click', no); res(true); };
    const no  = ()=>{ insYes.removeEventListener('click', yes); insNo.removeEventListener('click', no); res(false); };
    insYes.addEventListener('click', yes);
    insNo.addEventListener('click', no);
  });

  insuranceBar.classList.add('hidden');

  if(choice && maxIns>0){
    insuranceTaken = true;
    insuranceStake = Math.min(maxIns, bank);
    setBank(bank - insuranceStake);
    toast(`Insurance: $${insuranceStake}`);
  }
}

function totalPlayerBet(){ let t=0; for(let i=0;i<activeSeatsCount;i++) t+=handBets[i]; return t; }

function settleDealerBlackjackAfterInsurance(){
  hideHole = false; renderAll();
  if(insuranceTaken){ setBank(bank + insuranceStake * 3); } // 2:1 pays + return stake
  for(let i=0;i<activeSeatsCount;i++){
    if(isBlackjack(playerHands[i])){ setBank(bank + handBets[i]); s_push(); }
    else { s_lose(); }
  }
  inRound=false; toast('Dealer Blackjack.');
}

function resolveNaturals(){
  let any=false;
  for(let i=0;i<activeSeatsCount;i++){
    if(isBlackjack(playerHands[i]) && !finished[i]){
      setBank(bank + Math.floor(handBets[i] * 2.5)); // bet back + 1.5x win
      finished[i]=true; any=true; s_win();
    }
  }
  renderAll();
  if(any && finished.slice(0,activeSeatsCount).every(Boolean)){
    inRound=false; toast('Blackjack! Paid 3:2.');
    return true;
  }
  return false;
}

// actions
hitBtn.addEventListener('click', ()=>{
  if(!inRound) return;
  const h = playerHands[activeHandIndex];
  h.push(draw()); renderAll();
  const v = handValue(h);
  if(v > 21){ s_bust(); finished[activeHandIndex]=true; nextOrDealer(); }
  else if (v === 21){ finished[activeHandIndex]=true; nextOrDealer(); }
});

standBtn.addEventListener('click', ()=>{
  if(!inRound) return;
  finished[activeHandIndex]=true; nextOrDealer();
});

doubleBtn.addEventListener('click', ()=>{
  if(!inRound) return;
  const i=activeHandIndex, h=playerHands[i];
  if(h.length!==2) { toast('Double only on first two cards.'); return; }
  const hv = handValue(h);
  if(![9,10,11].includes(hv)){ toast('Double allowed on 9/10/11 only.'); return; }
  if(bank < handBets[i]) { toast('Not enough bank to double.'); return; }
  setBank(bank - handBets[i]); // place second bet
  doubled[i]=true;
  h.push(draw()); renderAll();
  finished[i]=true; nextOrDealer();
});

splitBtn.addEventListener('click', ()=>{
  if(!inRound) return;
  const i=activeHandIndex, h=playerHands[i];
  if(!(h.length===2 && h[0].rank===h[1].rank)){ toast('Split only on identical ranks.'); return; }
  if(splitCount[i] >= 2){ toast('Reached split limit (3 hands total).'); return; }
  if(bank < handBets[i]) { toast('Not enough bank to split.'); return; }

  setBank(bank - handBets[i]); // second bet

  const right=h.pop(), left=[h.pop()];
  playerHands[i]=left;
  playerHands.splice(i+1,0,[right]);
  handBets.splice(i+1,0,handBets[i]);
  doubled.splice(i+1,0,false);
  splitCount[i]=(splitCount[i]||0)+1;
  splitCount.splice(i+1,0, splitCount[i]);
  finished.splice(i+1,0,false);

  // Crown-style: you CAN hit/double split Aces
  playerHands[i].push(draw());
  playerHands[i+1].push(draw());
  renderAll();
});

function nextOrDealer(){
  for(let i=activeHandIndex+1;i<activeSeatsCount;i++){
    if(!finished[i]){ activeHandIndex=i; renderAll(); return; }
  }
  dealerPlayAndSettle();
}

function dealerPlayAndSettle(){
  hideHole = false; renderAll();

  // Dealer plays: S17 in Crown; H17 in Vegas (variation toggle)
  const hitSoft17 = (ruleSet==='vegas');
  for(;;){
    const v = handValue(dealer);
    const soft = isSoft(dealer);
    if(v<17){ dealer.push(draw()); renderAll(); continue; }
    if(v===17 && soft && hitSoft17){ dealer.push(draw()); renderAll(); continue; }
    break;
  }

  const d = handValue(dealer);
  for(let i=0;i<activeSeatsCount;i++){
    const p = handValue(playerHands[i]);
    if(p>21){ s_lose(); continue; }
    if(isBlackjack(playerHands[i])) continue; // already paid

    if(d>21){
      const payout = doubled[i] ? handBets[i]*4 : handBets[i]*2; // return principal + win
      setBank(bank + payout); s_win();
    } else if (p>d){
      const payout = doubled[i] ? handBets[i]*4 : handBets[i]*2;
      setBank(bank + payout); s_win();
    } else if (p===d){
      const refund = doubled[i] ? handBets[i]*2 : handBets[i];
      setBank(bank + refund); s_push();
    } else {
      s_lose();
    }
  }

  inRound=false;
  toast('Round over.');
}

// ----- Utils -----
function sleep(ms){ return new Promise(res=>setTimeout(res, ms)); }

// duplicate guard for name initials (used earlier before DOMContentLoaded too)
function initialsFromName(n){
  const p = n.trim().split(/\s+/).slice(0,2).map(s=>s[0]||'').join('');
  return (p || 'PL').toUpperCase();
}

// ----- Boot -----
function boot(){
  playerNameEl.textContent = name;
  playerAvatarBtn.textContent = ini;
  profileAvatar.textContent = ini;
  playerBankEl.textContent = '$'+bank;

  setThemeClass(theme); themeSelect.value=theme;
  setChipThemeClass(chipTheme); chipThemeSelect.value=chipTheme;
  soundToggle.checked = !muted;
  ruleSetEl.value = ruleSet;
  deckCountEl.value = deckCount;

  renderAll();
}
boot();
