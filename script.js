// Blackjack — HS Edition (multi-hand + profile + chips)
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

// -------- Persisted settings --------
let name   = localStorage.getItem('bj_name') || 'Player';
let ini    = localStorage.getItem('bj_ini')  || initialsFromName(name);
let bank   = parseInt(localStorage.getItem('bj_bank') || '1000', 10);
let theme  = localStorage.getItem('bj_theme') || 'midnight';
let chipTheme = localStorage.getItem('bj_chipTheme') || 'classic';
let muted  = localStorage.getItem('bj_muted') === 'true';
let ruleSet = localStorage.getItem('bj_rule') || 'crown';   // crown (S17 ENHC) | vegas (hole card)
let deckCount = parseInt(localStorage.getItem('bj_decks') || '6', 10);

// -------- Runtime state --------
let activeSeatsCount = 1;      // 1..3
let bets = [0,0,0];            // staged bets (before deal)
let inRound = false;

let dealer = [];
let playerHands = [[],[],[]];
let handBets = [0,0,0];
let doubled  = [false,false,false];
let splitCount=[0,0,0];
let finished = [false,false,false];
let hideHole = true;
let vegasHole = false;
let activeHandIndex = 0;

// -------- Sound --------
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

// -------- Cards / shoe --------
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

// -------- Helpers --------
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

// -------- Render --------
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
  // trigger transition next frame
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
  const canAct = inRound;
  hitBtn.disabled = !canAct;
  standBtn.disabled = !canAct;
  doubleBtn.disabled = !canAct || playerHands[activeHandIndex].length!==2 || bank < handBets[activeHandIndex];
  const h = playerHands[activeHandIndex] || [];
  const canSplit = canAct && h.length===2 && h[0]?.rank===h[1]?.rank && (h[0].rank!=='A' || splitCount[activeHandIndex]<2);
  splitBtn.disabled = !canSplit;
}

// -------- Seat toggle + betting --------
seatButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(inRound) return;
    seatButtons.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    activeSeatsCount = parseInt(btn.dataset.seats,10);
    seats.forEach((s,i)=>{ if(i>=activeSeatsCount) s.bet.textContent='$0'; });
    s_click();
  });
});

chips.forEach(ch=>{
  ch.addEventListener('click', ()=>{
    if(inRound) return;
    const val = parseInt(ch.dataset.value,10);
    // Add to the lowest bet among the enabled seats (nice for 4x $20 style)
    let idx = 0, minBet = Infinity;
    for(let i=0;i<activeSeatsCount;i++){
      if(bets[i] < minBet){ minBet=bets[i]; idx=i; }
    }
    bets[idx] += val;
    seats[idx].bet.textContent = '$'+bets[idx];
    s_click();
  });
});

// Tap the bet pill area to remove chips greedily (100→50→20→5)
seats.forEach((s,idx)=>{
  s.bet.parentElement.addEventListener('click', ()=>{
    if(inRound || idx>=activeSeatsCount) return;
    const order=[100,50,20,5];
    for(const c of order){
      if(bets[idx]-c>=0){
        bets[idx]-=c; seats[idx].bet.textContent='$'+bets[idx]; s_click(); break;
      }
    }
  });
});

// -------- Profile panel --------
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

// -------- Round flow --------
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
}

function validateBets(){
  let total=0;
  for(let i=0;i<activeSeatsCount;i++){ handBets[i] = bets[i]||0; total += handBets[i]; }
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
    playerHands[i].push(draw()); renderAll(); await sleep(160);
  }
  // dealer upcard
  dealer.push(draw()); renderAll(); await sleep(160);

  // second pass (players)
  for(let i=0;i<activeSeatsCount;i++){
    playerHands[i].push(draw()); renderAll(); await sleep(160);
  }
  // dealer hole card if Vegas
  if(vegasHole){ dealer.push(draw()); renderAll(); await sleep(100); }

  // instant pay naturals
  if(resolveNaturals()) return;

  // seat 1 acts first
  activeHandIndex = 0;
  renderAll();
}
dealBtn.addEventListener('click', startRound);

function resolveNaturals(){
  let any=false;
  for(let i=0;i<activeSeatsCount;i++){
    if(isBlackjack(playerHands[i]) && !finished[i]){
      setBank(bank + Math.floor(handBets[i]*2.5)); // bet returned + 1.5x win
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
  if(handValue(h)>21){ s_bust(); finished[activeHandIndex]=true; nextOrDealer(); }
});

standBtn.addEventListener('click', ()=>{
  if(!inRound) return;
  finished[activeHandIndex]=true; nextOrDealer();
});

doubleBtn.addEventListener('click', ()=>{
  if(!inRound) return;
  const i=activeHandIndex, h=playerHands[i];
  if(h.length!==2){ toast('Double only on first move.'); return; }
  if(bank < handBets[i]){ toast('Not enough bank to double.'); return; }
  setBank(bank - handBets[i]);
  doubled[i]=true;
  h.push(draw()); renderAll();
  finished[i]=true; nextOrDealer();
});

splitBtn.addEventListener('click', ()=>{
  if(!inRound) return;
  const i=activeHandIndex, h=playerHands[i];
  if(!(h.length===2 && h[0].rank===h[1].rank)){ toast('Split only on identical ranks.'); return; }
  if(h[0].rank==='A' && splitCount[i]>=2){ toast('Reached Aces resplit limit.'); return; }
  if(bank < handBets[i]){ toast('Not enough bank to split.'); return; }

  // charge a second bet
  setBank(bank - handBets[i]);

  // split into two hands, current slot gets first card, new slot after it gets second
  const right = h.pop(), left = [h.pop()];
  playerHands[i] = left;
  playerHands.splice(i+1,0,[right]);
  handBets.splice(i+1,0,handBets[i]);
  doubled.splice(i+1,0,false);
  splitCount[i] = (splitCount[i]||0)+1;
  splitCount.splice(i+1,0,splitCount[i]);
  finished.splice(i+1,0,false);

  // deal one card to each split hand
  playerHands[i].push(draw());
  playerHands[i+1].push(draw());
  renderAll();
});

function nextOrDealer(){
  // move to next unfinished seat
  for(let i=activeHandIndex+1;i<activeSeatsCount;i++){
    if(!finished[i]){ activeHandIndex=i; renderAll(); return; }
  }
  dealerPlayAndSettle();
}

function dealerPlayAndSettle(){
  hideHole = false; renderAll();

  // Dealer plays: S17 (stand on soft 17) unless ruleSet is vegas (hit soft 17)
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
    if(d>21){ setBank(bank + (doubled[i]? handBets[i]*4 : handBets[i]*2)); s_win(); continue; }
    if(p>d){ setBank(bank + (doubled[i]? handBets[i]*4 : handBets[i]*2)); s_win(); }
    else if(p===d){ setBank(bank + (doubled[i]? handBets[i]*2 : handBets[i])); s_push(); }
    else { s_lose(); }
  }

  inRound=false;
  toast('Round over.');
}

// -------- Utils --------
function sleep(ms){ return new Promise(res=>setTimeout(res, ms)); }

// -------- Boot --------
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

  // service worker (works once you add sw.js)
  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{}));
  }

  renderAll();
}
boot();

