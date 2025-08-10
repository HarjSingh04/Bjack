/* ==============================
   HS Blackjack — all-in-one build
   Safari-safe, Crown rules + Vegas option,
   arc seats, chip stacks, deal animations,
   auto-dim buttons, payouts, resets.
   ============================== */

var BUILD = 'HS-2025-08-10-all';

/* -------- Fresh loader (?fresh=1) -------- */
(function freshLoader(){
  try{
    var q = new URLSearchParams(location.search);
    if(q.has('fresh')){
      if('serviceWorker' in navigator){
        navigator.serviceWorker.getRegistrations().then(function(regs){
          regs.forEach(function(r){ r.unregister(); });
        });
      }
      if('caches' in window){
        caches.keys().then(function(keys){ keys.forEach(function(k){ caches.delete(k); }); });
      }
      q.delete('fresh');
      var url = location.pathname + (q.toString() ? ('?'+q) : '');
      setTimeout(function(){ location.replace(url); }, 60);
    }
  }catch(e){}
})();

/* -------- Shortcuts -------- */
function $(s){ return document.querySelector(s); }
function $$(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); }

/* -------- Sounds (tiny beeps) -------- */
var muted = false;
try{ var AC = window.AudioContext || window.webkitAudioContext; var ctx = AC ? new AC() : null; }catch(e){ ctx=null; }
function beep(f,d,t,v){ if(muted||!ctx) return; var o=ctx.createOscillator(), g=ctx.createGain(); o.type=t||'sine'; o.frequency.value=f||600; g.gain.value=v||0.03; o.connect(g); g.connect(ctx.destination); o.start(); setTimeout(function(){ try{o.stop()}catch(e){} }, (d||0.06)*1000); }
var sDeal=function(){beep(720,.05,'square',.03);};
var sClick=function(){beep(520,.04,'triangle',.025);};
var sBust=function(){beep(250,.25,'sawtooth',.05);};
var sWin=function(){beep(880,.08,'square'); setTimeout(function(){beep(980,.08,'square');},110);};
var sPush=function(){beep(660,.08,'sine');};
var sLose=function(){beep(340,.14,'triangle');};
var sShuffle=function(){beep(220,.08,'sine');};

/* -------- State -------- */
var playerBank = 1000;
var activeSeatsCount = 1;
var stagedBets = [0,0,0];

var dealer = [];
var hands  = [[],[],[]];   // per seat; split hands will be managed sequentially
var handBets = [0,0,0];
var doubled  = [false,false,false];
var splitCount=[0,0,0];    // per seat (0->1->2 splits = 3 hands)
var finished = [false,false,false];
var activeSeat = 0;        // which seat’s hand is currently playing
var inRound = false;
var hideHole = true;       // ENHC default
var ruleSet = 'crown';     // 'crown' or 'vegas'
var decks = 6;

var insuranceOffered=false, insuranceTaken=false, insuranceStake=0;

var seats = [];
var DEAL_GAP = 320; // ms between card animations

/* -------- Build badge -------- */
document.addEventListener('DOMContentLoaded', function(){
  var badge = document.getElementById('buildBadge');
  if (badge) badge.textContent = 'HS Blackjack • ' + BUILD;
});

/* -------- Boot -------- */
document.addEventListener('DOMContentLoaded', function(){
  cacheDom();
  ensureSeat1Active();
  applySeatLayout();
  applySavedPrefs();
  renderBank();
  initChips();
  initActions();
  initSeatToggle();
  initProfilePanel();
});

/* -------- DOM refs -------- */
function cacheDom(){
  seats = $$('.seat').map(function(seat){
    return {
      root: seat,
      cards: seat.querySelector('.cards'),
      total: seat.querySelector('.total'),
      bet:   seat.querySelector('.bet'),
      stack: seat.querySelector('.bet-stack')
    };
  });
}

/* -------- Prefs -------- */
function applySavedPrefs(){
  try{
    var n = localStorage.getItem('bj_name'); if(n){ $('#playerName').textContent=n; $('#nameInput').value=n; }
    var b = localStorage.getItem('bj_bank'); if(b){ playerBank=parseInt(b,10)||playerBank; }
    var th= localStorage.getItem('bj_theme'); if(th){ setTheme(th); }
    var ct= localStorage.getItem('bj_chipTheme'); if(ct){ setChipTheme(ct); }
    var mu= localStorage.getItem('bj_muted'); if(mu){ muted = (mu==='true'); $('#soundToggle').checked = !muted; }
    var rs= localStorage.getItem('bj_rule'); if(rs){ ruleSet=rs; $('#ruleSet').value=rs; }
    var dk= localStorage.getItem('bj_decks'); if(dk){ decks=parseInt(dk,10)||6; $('#deckCount').value=decks; }
  }catch(e){}
}

/* -------- Theme helpers -------- */
function setTheme(t){
  document.body.classList.remove('theme-green','theme-midnight','theme-classic');
  document.body.classList.add(t==='green'?'theme-green':t==='classic'?'theme-classic':'theme-midnight');
  localStorage.setItem('bj_theme', t);
}
function setChipTheme(t){
  document.body.classList.remove('chip-classic','chip-neon','chip-mono');
  document.body.classList.add('chip-'+t);
  localStorage.setItem('bj_chipTheme', t);
}

/* -------- Seat layout -------- */
function ensureSeat1Active(){
  seats.forEach(function(s){ s.root.classList.remove('active'); });
  if(seats[0]) seats[0].root.classList.add('active');
}
function applySeatLayout(){
  var area = $('#seatsArea');
  area.classList.remove('solo','duo','trio');
  area.classList.add(activeSeatsCount===1?'solo':activeSeatsCount===2?'duo':'trio');
  seats.forEach(function(s,i){
    var on = i<activeSeatsCount;
    s.root.style.visibility = on?'visible':'hidden';
    if(!on){
      s.cards.innerHTML=''; s.total.textContent='';
      s.stack.innerHTML=''; stagedBets[i]=0; s.bet.textContent='$0';
    }
  });
}

/* -------- Chips (tray) + stacks (table) -------- */
function initChips(){
  $$('#chipsArea .chip-img').forEach(function(chip){
    chip.addEventListener('click', function(){
      if(inRound) return;
      var val = parseInt(chip.getAttribute('data-value'),10);
      var idx = seats.findIndex(function(s){ return s.root.classList.contains('active'); });
      if(idx<0) idx=0;
      if(idx>=activeSeatsCount) return;
      stagedBets[idx]+=val;
      seats[idx].bet.textContent='$'+stagedBets[idx];
      addChipToken(idx,val);
      sClick();
    });
  });

  // remove last chip by tapping the bet pill
  seats.forEach(function(s,idx){
    s.bet.addEventListener('click', function(){
      if(inRound || idx>=activeSeatsCount) return;
      var removed = removeLastChipToken(idx);
      if(removed>0){
        stagedBets[idx]=Math.max(0,stagedBets[idx]-removed);
        s.bet.textContent='$'+stagedBets[idx];
        sClick();
      }
    });

    // tap seat to select as active (when 2–3 seats)
    s.root.addEventListener('click', function(e){
      if(e.target.closest('.bet') || e.target.closest('button')) return;
      if(idx>=activeSeatsCount) return;
      seats.forEach(function(t){ t.root.classList.remove('active'); });
      s.root.classList.add('active');
    });
  });
}
function addChipToken(seatIndex, value){
  var stack = seats[seatIndex].stack;
  var t = document.createElement('div');
  t.className = 'chip-token v'+value;
  t.innerHTML = '<span>$'+value+'</span>';
  var count = stack.children.length;
  var x = (-4 + (count%3)*4), y=count*6;
  t.style.transform = 'translate('+x+'px,'+(12-y)+'px) scale(.8)';
  t.style.zIndex = String(100+count);
  stack.appendChild(t);
  requestAnimationFrame(function(){
    t.classList.add('in');
    t.style.transform = 'translate('+x+'px,'+(-y)+'px) scale(1)';
  });
}
function removeLastChipToken(seatIndex){
  var stack = seats[seatIndex].stack;
  var last = stack.lastElementChild;
  if(!last) return 0;
  var m = last.className.match(/v(\d+)/);
  var val = m ? parseInt(m[1],10) : 0;
  last.classList.remove('in');
  last.style.transform += ' translateY(10px) scale(.9)';
  last.style.opacity='0';
  setTimeout(function(){ last.remove(); }, 160);
  return val;
}
function lockStacks(){
  seats.slice(0,activeSeatsCount).forEach(function(s){
    Array.prototype.forEach.call(s.stack.children, function(el){ el.classList.add('locked'); });
  });
}
function clearStacksAndBets(){
  stagedBets=[0,0,0];
  seats.forEach(function(s){ s.bet.textContent='$0'; s.stack.innerHTML=''; });
}

/* -------- Actions -------- */
function initActions(){
  $('#dealBtn').addEventListener('click', startRound);
  $('#hitBtn').addEventListener('click', function(){ doHit(); });
  $('#standBtn').addEventListener('click', function(){ doStand(); });
  $('#doubleBtn').addEventListener('click', function(){ doDouble(); });
  $('#splitBtn').addEventListener('click', function(){ doSplit(); });
}
function setButtons(hit,stand,doubleB,splitB){
  setBtn('#hitBtn', hit); setBtn('#standBtn', stand); setBtn('#doubleBtn', doubleB); setBtn('#splitBtn', splitB);
}
function setBtn(sel, on){
  var b = $(sel);
  b.disabled = !on;
  if(!on) b.classList.add('dimmed'); else b.classList.remove('dimmed');
}

/* -------- Deck / shoe -------- */
var SUITS = ['♠','♥','♦','♣'];
var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
var shoe=[], cutIndex=0;

function newShoe(n){
  var s=[], d, su, r;
  for(d=0; d<n; d++) for(su=0; su<SUITS.length; su++) for(r=0; r<RANKS.length; r++) s.push({rank:RANKS[r], suit:SUITS[su]});
  for(var i=s.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var tmp=s[i]; s[i]=s[j]; s[j]=tmp; }
  cutIndex=Math.floor(s.length*0.25);
  sShuffle();
  return s;
}
function ensureShoe(){ if(shoe.length===0) shoe=newShoe(decks); if(shoe.length<=cutIndex) shoe=newShoe(decks); }
function draw(){ ensureShoe(); sDeal(); return shoe.pop(); }

/* -------- Rules helpers -------- */
function val(rank){ if(rank==='A') return 11; if(rank==='K'||rank==='Q'||rank==='J') return 10; return parseInt(rank,10); }
function total(cards){
  var t=0,a=0,i,c; for(i=0;i<cards.length;i++){ c=cards[i]; if(c.hidden) continue; t+=val(c.rank); if(c.rank==='A') a++; }
  while(t>21 && a>0){ t-=10; a--; } return t;
}
function isSoft(cards){
  var t=0,a=0,i,c; for(i=0;i<cards.length;i++){ c=cards[i]; if(c.hidden) continue; t+=val(c.rank); if(c.rank==='A') a++; }
  while(t>21 && a>0){ t-=10; a--; } return a>0 && t<=21;
}
function isBJ(cards){ return cards.length===2 && total(cards)===21; }
function canDouble(handIndex){
  var h = hands[handIndex]; if(h.length!==2) return false;
  var t = total(h); if(['9','10','11'].indexOf(String(t))===-1) return false;
  return playerBank >= handBets[handIndex];
}
function canSplit(handIndex){
  var h=hands[handIndex]; if(h.length!==2) return false;
  if(h[0].rank!==h[1].rank) return false;
  if(splitCount[handIndex] >= 2) return false; // up to 3 hands
  return playerBank >= handBets[handIndex];
}

/* -------- Rendering -------- */
function renderAll(){
  // dealer
  $('#dealerCards').innerHTML='';
  for(var i=0;i<dealer.length;i++){
    renderCard($('#dealerCards'), dealer[i]);
  }
  $('#dealerTotal').textContent = total(dealer);

  // players
  for(var s=0;s<activeSeatsCount;s++){
    var cont = seats[s].cards;
    cont.innerHTML='';
    for(var k=0;k<hands[s].length;k++) renderCard(cont, hands[s][k]);
    seats[s].total.textContent = total(hands[s]);
  }

  updateButtonsForState();
}
function renderCard(el, card){
  var c = document.createElement('div');
  if(card.hidden){
    c.className='card deal back';
    c.textContent='🂠';
  }else{
    var red = (card.suit==='♥'||card.suit==='♦')?' red':'';
    c.className='card deal'+red;
    c.innerHTML = '<span class="small">'+card.rank+'</span><span class="big">'+card.rank+'</span><span class="suit">'+card.suit+'</span>';
  }
  el.appendChild(c);
  requestAnimationFrame(function(){ c.classList.add('show'); });
}

/* -------- Deal sequence -------- */
function startRound(){
  console.log('startRound() called');
  // need some bet
  var any=false; for(var i=0;i<activeSeatsCount;i++) if(stagedBets[i]>0) any=true;
  if(!any){ console.log('no bet'); return; }

  inRound = true;
  dealer=[]; hands=[[],[],[]]; handBets=[0,0,0]; finished=[false,false,false];
  activeSeat=0; hideHole = (ruleSet==='crown');

  for(var i=0;i<activeSeatsCount;i++){ handBets[i]=stagedBets[i]; playerBank-=handBets[i]; }
  renderBank(); lockStacks();

  // Deterministic test cards (no shoe, no timers)
  // Player seat 1 gets A♠ + K♥ (21), dealer shows 8♣ + hole
  hands[0].push({rank:'A', suit:'♠', hidden:false});
  hands[0].push({rank:'K', suit:'♥', hidden:false});
  dealer.push({rank:'8', suit:'♣', hidden:false});
  dealer.push({rank:'Q', suit:'♦', hidden:true});

  // If you have 2–3 seats visible, give them simple hands too
  if(activeSeatsCount>=2){
    hands[1].push({rank:'9', suit:'♠', hidden:false});
    hands[1].push({rank:'7', suit:'♦', hidden:false});
  }
  if(activeSeatsCount>=3){
    hands[2].push({rank:'5', suit:'♣', hidden:false});
    hands[2].push({rank:'6', suit:'♥', hidden:false});
  }

  // render WITHOUT animation classes (to rule out CSS issues)
  function renderCardNoAnim(el, card){
    var c = document.createElement('div');
    if(card.hidden){
      c.className='card back';
      c.textContent='🂠';
    }else{
      var red = (card.suit==='♥'||card.suit==='♦')?' red':'';
      c.className='card'+red;
      c.innerHTML = '<span class="small">'+card.rank+
        '</span><span class="big">'+card.rank+
        '</span><span class="suit">'+card.suit+'</span>';
    }
    el.appendChild(c);
  }

  // dealer
  var dcon = document.getElementById('dealerCards');
  dcon.innerHTML='';
  for(var d=0; d<dealer.length; d++) renderCardNoAnim(dcon, dealer[d]);
  document.getElementById('dealerTotal').textContent = total(dealer);

  // players
  for(var s=0;s<activeSeatsCount;s++){
    var con = seats[s].cards;
    con.innerHTML='';
    for(var k=0;k<hands[s].length;k++) renderCardNoAnim(con, hands[s][k]);
    seats[s].total.textContent = total(hands[s]);
  }

  console.log('rendered. P1 len=', hands[0].length, 'Dealer len=', dealer.length);
}

function afterInitialDeal(){
  // Vegas: if dealer shows Ace, offer insurance
  if(ruleSet==='vegas' && dealer[0] && dealer[0].rank==='A'){
    showInsuranceBar();
  }else{
    updateButtonsForState();
    // auto-stand natural blackjack
    if(isBJ(hands[activeSeat])) { finished[activeSeat]=true; nextHandOrDealer(); }
  }
}

/* -------- Insurance bar -------- */
function showInsuranceBar(){
  var bar = $('#insuranceBar'); bar.classList.remove('hidden'); insuranceOffered=true;
  $('#insYes').onclick=function(){
    insuranceTaken=true; insuranceStake = Math.floor(handBets[activeSeat]/2);
    if(playerBank>=insuranceStake){ playerBank-=insuranceStake; renderBank(); }
    bar.classList.add('hidden'); updateButtonsForState();
  };
  $('#insNo').onclick=function(){ bar.classList.add('hidden'); updateButtonsForState(); };
}

/* -------- Buttons state -------- */
function updateButtonsForState(){
  if(!inRound){ setButtons(false,false,false,false); return; }
  var h = hands[activeSeat], t = total(h);

  var canH = t<21;
  var canS = true;
  var canD = canDouble(activeSeat);
  var canSp= canSplit(activeSeat);

  // if blackjack, no actions
  if(isBJ(h)) { canH=canD=canSp=false; }

  setButtons(canH, canS, canD, canSp);
}

/* -------- Player actions -------- */
function doHit(){
  if(!inRound) return;
  var h = hands[activeSeat];
  var t = total(h);
  if(t>=21) return;
  var c = draw(); c.hidden=false; h.push(c);
  renderAll();
  t = total(h);
  if(t>=21){ if(t>21) sBust(); finished[activeSeat]=true; nextHandOrDealer(); }
  else updateButtonsForState();
}

function doStand(){
  if(!inRound) return;
  finished[activeSeat]=true;
  nextHandOrDealer();
}

function doDouble(){
  if(!inRound) return;
  if(!canDouble(activeSeat)) return;
  // take equal bet
  if(playerBank<handBets[activeSeat]) return;
  playerBank-=handBets[activeSeat]; renderBank();
  doubled[activeSeat]=true;
  // one card only then stand
  var c=draw(); c.hidden=false; hands[activeSeat].push(c);
  renderAll();
  finished[activeSeat]=true;
  nextHandOrDealer();
}

function doSplit(){
  if(!inRound) return;
  if(!canSplit(activeSeat)) return;

  // take equal bet
  if(playerBank<handBets[activeSeat]) return;
  playerBank-=handBets[activeSeat]; renderBank();

  // split pair into two hands (we manage only up to 3 total per seat index)
  var h = hands[activeSeat];
  var right = h.pop(); var left = [h.pop()];
  hands[activeSeat] = left;
  // insert new hand after current seat (we only show 1 seat per seat index—this keeps logic simple)
  hands.splice(activeSeat+1,0,[right]);
  handBets.splice(activeSeat+1,0,handBets[activeSeat]);
  doubled.splice(activeSeat+1,0,false);
  finished.splice(activeSeat+1,0,false);
  splitCount[activeSeat] = (splitCount[activeSeat]||0)+1;

  // deal one to each split hand
  hands[activeSeat].push(draw());
  hands[activeSeat+1].push(draw());

  renderAll();
  updateButtonsForState();
}

function nextHandOrDealer(){
  // move to next unfinished player hand within active seat block
  while(activeSeat<activeSeatsCount && finished[activeSeat]) activeSeat++;
  if(activeSeat<activeSeatsCount){ updateButtonsForState(); return; }
  // players done -> dealer play + settle
  dealerPlayAndSettle();
}

/* -------- Dealer play + settle -------- */
function dealerPlayAndSettle(){
  hideHole=false;
  // flip hole if any
  for(var i=0;i<dealer.length;i++) dealer[i].hidden=false;
  renderAll();

  // If Vegas with insurance: check for dealer BJ before drawing
  if(ruleSet==='vegas'){
    if(isBJ(dealer)){
      // pay insurance 2:1
      if(insuranceTaken){ playerBank += insuranceStake*3; insuranceStake=0; renderBank(); sWin(); }
      settleAll(); return;
    }
  }

  // draw to 17 (S17 default; Vegas H17 set below if wanted)
  var hitSoft17 = (ruleSet==='vegas'); // you said Crown S17; Vegas commonly H17
  function dStep(){
    var t = total(dealer), soft = isSoft(dealer);
    if(t<17 || (t===17 && soft && hitSoft17)){
      var c = draw(); c.hidden=false; dealer.push(c); renderAll(); setTimeout(dStep, DEAL_GAP);
    }else{
      settleAll();
    }
  }
  setTimeout(dStep, DEAL_GAP);
}

function settleAll(){
  // settle each seat hand vs dealer
  var dTot = total(dealer);
  var results=[];
  for(var i=0;i<activeSeatsCount;i++){
    var p = hands[i];
    var bet = handBets[i]||0;
    var dbl = !!doubled[i];
    var pTot = total(p);

    if(isBJ(p)){ playerBank += Math.floor(bet*2.5); results.push('bj'); sWin(); continue; }
    if(pTot>21){ results.push('lose'); sLose(); continue; }
    if(dTot>21){ playerBank += bet*(dbl?4:2); results.push('win'); sWin(); continue; }

    if(pTot>dTot){ playerBank += bet*(dbl?4:2); results.push('win'); sWin(); }
    else if(pTot===dTot){ playerBank += bet*(dbl?2:1); results.push('push'); sPush(); }
    else { results.push('lose'); sLose(); }
  }
  renderBank();
  inRound=false;
  // clear stacks for next round
  setTimeout(function(){
    clearStacksAndBets();
    updateButtonsForState();
  }, 300);
}

/* -------- UI helpers -------- */
function renderBank(){ $('#playerBank').textContent='$'+playerBank; }
function sClick(){ beep(500,.03,'triangle',.02); }

/* -------- Seat toggle -------- */
function initSeatToggle(){
  $$('#seatToggle button').forEach(function(btn){
    btn.addEventListener('click', function(){
      $$('#seatToggle button').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      activeSeatsCount = parseInt(btn.getAttribute('data-seats'),10)||1;
      ensureSeat1Active();
      applySeatLayout();
    });
  });
}

/* -------- Profile / Settings -------- */
function initProfilePanel(){
  var profileBtn = $('#profileBtn');
  var panel = $('#profilePanel');
  var closeBtn = $('#closeProfile');

  if(profileBtn) profileBtn.addEventListener('click', function(){ panel.classList.add('open'); });
  if(closeBtn)   closeBtn.addEventListener('click', function(){ panel.classList.remove('open'); });

  var nameInput = $('#nameInput');
  if(nameInput) nameInput.addEventListener('change', function(){
    var n = nameInput.value.trim()||'Player';
    $('#playerName').textContent=n; localStorage.setItem('bj_name', n);
  });

  var themeSelect = $('#themeSelect');
  if(themeSelect) themeSelect.addEventListener('change', function(){ setTheme(themeSelect.value); });

  var chipTheme = $('#chipTheme');
  if(chipTheme) chipTheme.addEventListener('change', function(){ setChipTheme(chipTheme.value); });

  var soundToggle = $('#soundToggle');
  if(soundToggle){ soundToggle.checked=!muted; soundToggle.addEventListener('change', function(){ muted = !soundToggle.checked; localStorage.setItem('bj_muted', String(muted)); }); }

  var ruleSel = $('#ruleSet');
  if(ruleSel) ruleSel.addEventListener('change', function(){ ruleSet = ruleSel.value; localStorage.setItem('bj_rule', ruleSet); });

  var deckInput = $('#deckCount');
  if(deckInput) deckInput.addEventListener('change', function(){ decks = Math.max(1, Math.min(8, parseInt(deckInput.value,10)||6)); localStorage.setItem('bj_decks', String(decks)); shoe=[]; });

  var resetBank = $('#resetBank');
  if(resetBank) resetBank.addEventListener('click', function(){
    playerBank = 1000; renderBank(); clearStacksAndBets();
    inRound=false; dealer=[]; hands=[[],[],[]]; handBets=[0,0,0]; doubled=[false,false,false]; splitCount=[0,0,0]; finished=[false,false,false];
    $('#dealerCards').innerHTML=''; $('#dealerTotal').textContent='';
    seats.forEach(function(s){ s.cards.innerHTML=''; s.total.textContent=''; });
  });

  var resetStats = $('#resetStats');
  if(resetStats) resetStats.addEventListener('click', function(){
    try{
      ['bj_name','bj_bank','bj_theme','bj_chipTheme','bj_muted','bj_rule','bj_decks'].forEach(function(k){ localStorage.removeItem(k); });
    }catch(e){}
    location.href = location.pathname + '?fresh=1';
  });
}

/* ===== End ===== */
