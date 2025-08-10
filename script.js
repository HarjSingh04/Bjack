/* ==============================
   HS Blackjack — rendering-stable build
   (direct hand containers, Safari-safe)
   ============================== */

var BUILD = 'fix-render-2025-08-10';
var DEBUG_FORCE = true;   // set to false after you confirm cards appear

(function freshLoader(){
  try{
    var q = new URLSearchParams(location.search);
    if(q.has('fresh')){
      if('serviceWorker' in navigator){
        navigator.serviceWorker.getRegistrations().then(function(regs){ regs.forEach(function(r){ r.unregister(); }); });
      }
      if('caches' in window){
        caches.keys().then(function(keys){ keys.forEach(function(k){ caches.delete(k); }); });
      }
      q.delete('fresh');
      var url = location.pathname + (q.toString()?('?'+q):'');
      setTimeout(function(){ location.replace(url); }, 60);
    }
  }catch(e){}
})();

function $(s){ return document.querySelector(s); }
function $$(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); }

/* ---------- State ---------- */
var playerBank = 1000;
var activeSeatsCount = 1;
var stagedBets = [0,0,0];

var dealer = [];
var hands  = [[],[],[]];
var handBets = [0,0,0];
var doubled  = [false,false,false];
var splitCount=[0,0,0];
var finished = [false,false,false];
var activeSeat = 0;
var inRound = false;
var ruleSet = 'crown';
var decks = 6;

/* Handy direct container getters (robust) */
function handContainer(i){ return document.getElementById('hand'+(i+1)); }
function totalContainer(i){ return document.getElementById('total'+(i+1)); }

var seats = [];

document.addEventListener('DOMContentLoaded', function(){
  var badge = document.getElementById('buildBadge');
  if (badge) badge.textContent = 'HS Blackjack • ' + BUILD;

  cacheDom();
  ensureSeat1Active();
  applySeatLayout();
  renderBank();
  initChips();
  initActions();
  initSeatToggle();
  initProfilePanel();

  // Optional: quick visual outline to prove where we render
  document.body.dataset.debug = '1'; // remove later
});

function cacheDom(){
  seats = $$('.seat').map(function(seat){
    return {
      root: seat,
      bet:   seat.querySelector('.bet'),
      stack: seat.querySelector('.bet-stack')
    };
  });
}

function ensureSeat1Active(){
  seats.forEach(function(s){ s.root.classList.remove('active'); });
  if(seats[0]) seats[0].root.classList.add('active');
}

function applySeatLayout(){
  var area = $('#seatsArea');
  area.classList.remove('solo','duo','trio');
  area.classList.add(activeSeatsCount===1?'solo':activeSeatsCount===2?'duo':'trio');

  for(var i=0;i<3;i++){
    var on = i < activeSeatsCount;
    if(seats[i]){
      seats[i].root.style.visibility = on ? 'visible' : 'hidden';
      if(!on){
        handContainer(i).innerHTML = '';
        totalContainer(i).textContent = '';
        if(seats[i].stack) seats[i].stack.innerHTML='';
        stagedBets[i]=0; if(seats[i].bet) seats[i].bet.textContent='$0';
      }
    }
  }
}

/* ---------- Chips + stacks ---------- */
function initChips(){
  $$('#chipsArea .chip-img').forEach(function(chip){
    chip.addEventListener('click', function(){
      if(inRound) return;
      var val = parseInt(chip.getAttribute('data-value'),10);
      var idx = seats.findIndex(function(s){ return s.root.classList.contains('active'); });
      if(idx<0) idx=0;
      if(idx>=activeSeatsCount) return;
      stagedBets[idx]+=val;
      if(seats[idx].bet) seats[idx].bet.textContent='$'+stagedBets[idx];
      addChipToken(idx,val);
    });
  });

  seats.forEach(function(s, idx){
    if(s.bet) s.bet.addEventListener('click', function(){
      if(inRound || idx>=activeSeatsCount) return;
      var removed = removeLastChipToken(idx);
      if(removed>0){
        stagedBets[idx]=Math.max(0,stagedBets[idx]-removed);
        s.bet.textContent='$'+stagedBets[idx];
      }
    });

    s.root.addEventListener('click', function(e){
      if(e.target.closest('.bet') || e.target.closest('button')) return;
      if(idx>=activeSeatsCount) return;
      seats.forEach(function(t){ t.root.classList.remove('active'); });
      s.root.classList.add('active');
    });
  });
}

function addChipToken(i, value){
  var stack = seats[i].stack;
  if(!stack) return;
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
function removeLastChipToken(i){
  var stack = seats[i].stack;
  var last = stack ? stack.lastElementChild : null;
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
    if(!s.stack) return;
    Array.prototype.forEach.call(s.stack.children, function(el){ el.classList.add('locked'); });
  });
}
function clearStacksAndBets(){
  stagedBets=[0,0,0];
  seats.forEach(function(s){ if(s.bet) s.bet.textContent='$0'; if(s.stack) s.stack.innerHTML=''; });
}

/* ---------- Actions ---------- */
function initActions(){
  $('#dealBtn').addEventListener('click', startRound);
  $('#hitBtn').addEventListener('click', function(){ doHit(); });
  $('#standBtn').addEventListener('click', function(){ doStand(); });
  $('#doubleBtn').addEventListener('click', function(){ doDouble(); });
  $('#splitBtn').addEventListener('click', function(){ doSplit(); });
}
function setBtn(sel, on){
  var b = $(sel);
  b.disabled = !on;
  if(!on) b.classList.add('dimmed'); else b.classList.remove('dimmed');
}
function setButtons(h,s,d,sp){ setBtn('#hitBtn',h); setBtn('#standBtn',s); setBtn('#doubleBtn',d); setBtn('#splitBtn',sp); }

/* ---------- Deal (stable version) ---------- */
function startRound(){
  // need a bet
  var any=false; for(var i=0;i<activeSeatsCount;i++) if(stagedBets[i]>0) any=true;
  if(!any){ console.log('no bet'); return; }

  inRound = true;
  dealer=[]; hands=[[],[],[]]; handBets=[0,0,0]; doubled=[false,false,false]; splitCount=[0,0,0]; finished=[false,false,false];
  activeSeat=0;

  for (var s=0;s<activeSeatsCount;s++){ handBets[s]=stagedBets[s]; playerBank -= handBets[s]; }
  renderBank(); lockStacks();

  // clear containers
  $('#dealerCards').innerHTML=''; $('#dealerTotal').textContent='';
  for (var i=0;i<activeSeatsCount;i++){ handContainer(i).innerHTML=''; totalContainer(i).textContent=''; }

  if (DEBUG_FORCE){
    // Deterministic: Seat1 = A K, Dealer = 3 + hole
    hands[0].push({rank:'A',suit:'♠',hidden:false});
    hands[0].push({rank:'K',suit:'♥',hidden:false});
    dealer.push({rank:'3',suit:'♣',hidden:false});
    dealer.push({rank:'Q',suit:'♦',hidden:true});
    // If more seats are visible, show simple pairs so you SEE them:
    if(activeSeatsCount>=2){ hands[1].push({rank:'9',suit:'♠',hidden:false}); hands[1].push({rank:'7',suit:'♦',hidden:false}); }
    if(activeSeatsCount>=3){ hands[2].push({rank:'5',suit:'♣',hidden:false}); hands[2].push({rank:'6',suit:'♥',hidden:false}); }
    renderAll_noAnim();
    updateButtonsForState();
    console.log('rendered. P1 len=',hands[0].length,'Dealer len=',dealer.length);
    return;
  }

  // (When DEBUG_FORCE=false we’ll use full shoe + animation again)
}

/* ---------- Render (direct containers, no animation) ---------- */
function renderAll_noAnim(){
  var dcon = document.getElementById('dealerCards');
  dcon.innerHTML='';
  for (var i=0;i<dealer.length;i++) putCard(dcon, dealer[i]);

  document.getElementById('dealerTotal').textContent = total(dealer);

  for (var s=0;s<activeSeatsCount;s++){
    var con = handContainer(s);
    con.innerHTML='';
    for (var k=0;k<hands[s].length;k++) putCard(con, hands[s][k]);
    totalContainer(s).textContent = total(hands[s]);
  }
}

function putCard(container, card){
  var c = document.createElement('div');
  if(card.hidden){
    c.className='card back';
    c.textContent='🂠';
  }else{
    var red = (card.suit==='♥'||card.suit==='♦')?' red':'';
    c.className='card'+red;
    c.innerHTML = '<span class="small">'+card.rank+'</span>'+
                  '<span class="big">'+card.rank+'</span>'+
                  '<span class="suit">'+card.suit+'</span>';
  }
  container.appendChild(c);
}

/* ---------- Rules helpers (minimal for totals) ---------- */
function val(rank){ if(rank==='A') return 11; if(rank==='K'||rank==='Q'||rank==='J') return 10; return parseInt(rank,10); }
function total(cards){
  var t=0,a=0,i,c; for(i=0;i<cards.length;i++){ c=cards[i]; if(c.hidden) continue; t+=val(c.rank); if(c.rank==='A') a++; }
  while(t>21 && a>0){ t-=10; a--; } return t||'';
}
function isBJ(cards){ return cards.length===2 && total(cards)===21; }
function canDouble(i){ var h=hands[i]; if(h.length!==2) return false; var t=total(h); return ['9','10','11'].indexOf(String(t))>-1 && playerBank>=handBets[i]; }
function canSplit(i){ var h=hands[i]; return h.length===2 && h[0].rank===h[1].rank && splitCount[i]<2 && playerBank>=handBets[i]; }

function updateButtonsForState(){
  if(!inRound){ setButtons(false,false,false,false); return; }
  var h = hands[activeSeat], t = total(h);
  var canH = t<21, canS = true, canD = canDouble(activeSeat), canSp = canSplit(activeSeat);
  if(isBJ(h)){ canH=canD=canSp=false; }
  setButtons(canH,canS,canD,canSp);
}

/* ---------- Player actions (stubs while DEBUG_FORCE=true) ---------- */
function doHit(){}
function doStand(){}
function doDouble(){}
function doSplit(){}

/* ---------- Seat toggle ---------- */
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

/* ---------- Profile / Settings ---------- */
function initProfilePanel(){
  var profileBtn = $('#profileBtn');
  var panel = $('#profilePanel');
  var closeBtn = $('#closeProfile');

  if(profileBtn) profileBtn.addEventListener('click', function(){ panel.classList.add('open'); });
  if(closeBtn)   closeBtn.addEventListener('click', function(){ panel.classList.remove('open'); });

  var resetBank = $('#resetBank');
  if(resetBank) resetBank.addEventListener('click', function(){
    playerBank=1000; renderBank(); clearStacksAndBets();
    inRound=false; dealer=[]; hands=[[],[],[]];
    $('#dealerCards').innerHTML=''; $('#dealerTotal').textContent='';
    for(var i=0;i<3;i++){ handContainer(i).innerHTML=''; totalContainer(i).textContent=''; }
  });
  var resetStats = $('#resetStats');
  if(resetStats) resetStats.addEventListener('click', function(){
    try{ localStorage.clear(); }catch(e){}
    location.href = location.pathname + '?fresh=1';
  });
}

function renderBank(){ $('#playerBank').textContent = '$'+playerBank; }