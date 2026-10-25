import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, startTrial, tick, interact, respond, finishTrial, interview, leaveReport,
  addHypothesis, sealEnvelope, readEnvelope, safeDuty, sleep, applyMemory, validateGame } from '../src/game.js';
import { SaveStore, SAVE_KEY } from '../src/storage.js';

function trial(threshold = 2.5) { const g=createGame();g.parameters.threshold=threshold;startTrial(g);return g; }
function advance(g, seconds, input = {}) {
  const n=Math.round(seconds*120);
  for(let i=0;i<n;i++) tick(g,input,1/120);
}
function roundTrip(g) { return validateGame(JSON.parse(JSON.stringify(g))); }
function memoryStorage(initial) {
  const values=new Map(initial===undefined?[]:[[SAVE_KEY,initial]]);
  return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
}

test('initial fixed seed chooses 2.5; a resumed seed and threshold are retained',()=>{
  const g=trial();assert.equal(g.parameters.threshold,2.5);g.parameters.threshold=1.5;
  const restored=roundTrip(g);assert.equal(restored.seed,g.seed);assert.equal(restored.parameters.threshold,1.5);
});

for(const threshold of [1.5,2.5]) {
  test(`slow outward and return with recovery succeeds at threshold ${threshold}`,()=>{
    const g=trial(threshold);advance(g,22,{x:1,slow:true});assert.equal(g.trial.mode,'following');
    interact(g);assert.equal(g.trial.hasBox,true);advance(g,22,{x:-1,slow:true});interact(g);
    assert.equal(g.phase,'debrief');assert.equal(g.trial.result,'success');assert.equal(g.reports.length,1);
  });
  test(`warning precedes death by at least 3 seconds at threshold ${threshold}`,()=>{
    const g=trial(threshold);tick(g,{x:1,run:true},1/120);assert.equal(g.trial.mode,'approaching');
    assert.ok(g.events.some(e=>e.type==='warning'));advance(g,2.99,{x:1,run:true});assert.equal(g.phase,'trial');
    advance(g,.02,{x:1,run:true});assert.equal(g.phase,'death');assert.equal(g.reports.length,1);
  });
  test(`stopping and slow motion both relieve danger at threshold ${threshold}`,()=>{
    for(const input of [{},{x:1,slow:true}]) {
      const g=trial(threshold);advance(g,2.9,{x:1,run:true});const danger=g.trial.danger;
      advance(g,input.slow?1:.5,input);assert.equal(g.trial.mode,'retreating');assert.equal(g.trial.danger,danger);
      advance(g,1);assert.equal(g.trial.mode,'following');assert.equal(g.trial.danger,0);
    }
  });
}

test('normal walking only triggers at 1.5, rotation never triggers',()=>{
  const low=trial(1.5),high=trial(2.5);advance(low,.1,{x:1});advance(high,.1,{x:1});
  assert.equal(low.trial.mode,'approaching');assert.equal(high.trial.mode,'following');
  const previousX=high.trial.x;advance(high,5,{facing:Math.PI});assert.equal(high.trial.mode,'following');assert.equal(high.trial.x,previousX);
});

test('returning to normal speed keeps an existing approach active',()=>{
  const g=trial();advance(g,1,{x:1,run:true});advance(g,1,{x:1});assert.equal(g.trial.mode,'approaching');
  advance(g,1.1,{x:1});assert.equal(g.phase,'death');
});

test('interrupted relief resumes its old danger clock; mixed relief needs a new continuous duration',()=>{
  const g=trial();advance(g,2,{x:1,run:true});const d=g.trial.danger;
  advance(g,.25);assert.equal(g.trial.danger,d);advance(g,.5,{x:1,slow:true});assert.equal(g.trial.mode,'approaching');
  advance(g,.1,{x:1,run:true});assert.ok(g.trial.danger>d);assert.equal(g.trial.relief,0);
  advance(g,.5);assert.equal(g.trial.mode,'retreating');
});

test('stopping at the lethal boundary is accepted before lethal judgment',()=>{
  const g=trial();g.trial.mode='approaching';g.trial.danger=3;g.trial.seenWarning=true;
  advance(g,.5);assert.equal(g.phase,'trial');assert.equal(g.trial.mode,'retreating');
});

test('running during retreat starts a fresh warning and fresh grace',()=>{
  const g=trial();advance(g,.5,{x:1,run:true});advance(g,.5);assert.equal(g.trial.mode,'retreating');
  advance(g,.01,{x:1,run:true});assert.equal(g.trial.mode,'approaching');assert.equal(g.trial.danger,0);
  assert.equal(g.events.filter(e=>e.type==='warning').length,2);
});

test('pause freezes the entire serialized trial, including warning and order state',()=>{
  const g=trial();advance(g,1,{x:1,run:true});const before=JSON.stringify(g);
  advance(g,20,{x:1,run:true,paused:true});assert.equal(JSON.stringify(g),before);
});

test('an unresolved warning prevents exit; death precedes exit and timeout',()=>{
  const g=trial();g.trial.x=1;g.trial.mode='approaching';interact(g);assert.equal(g.phase,'trial');
  g.trial.danger=3;g.trial.elapsed=120;tick(g,{x:1,interact:true});assert.equal(g.phase,'death');
  assert.equal(g.trial.result,'death');assert.equal(g.reports.length,1);
});

test('timeout warns 10 seconds ahead, causes a nonfatal failure, and is idempotent',()=>{
  const g=trial();advance(g,110.01);assert.ok(g.trial.timeoutWarning);assert.equal(g.phase,'trial');
  advance(g,10);assert.equal(g.phase,'debrief');assert.equal(g.trial.result,'timeout');
  const before=JSON.stringify(g);finishTrial(g,'success');advance(g,1);assert.equal(JSON.stringify(g),before);
});

test('box issues an order; question once; replies neither move player nor extend deadline',()=>{
  const g=trial();g.trial.x=22;interact(g);const t=JSON.stringify(g.trial);
  assert.ok(g.trial.instruction.issued);assert.equal(respond(g,'question'),true);assert.equal(respond(g,'question'),false);
  const x=g.trial.x,time=g.trial.elapsed;respond(g,'obey');assert.equal(g.trial.x,x);assert.equal(g.trial.elapsed,time);
  assert.equal(respond(g,'refuse'),false);assert.notEqual(JSON.stringify(g.trial),t);
});

test('running the complete marked return interval can fulfill the order and survive',()=>{
  const g=trial();g.trial.x=22.8;interact(g);respond(g,'obey');
  advance(g,5.8,{x:-1,slow:true});assert.ok(Math.abs(g.trial.x-17)<1e-7);
  advance(g,2,{x:-1,run:true});assert.equal(g.trial.instruction.fulfilled,true);assert.equal(g.phase,'trial');
  advance(g,.5);advance(g,4.1,{x:-1});interact(g);assert.equal(g.trial.result,'success');assert.equal(g.subject.credit,1);
});

test('partial running does not fulfill order; refusal penalty is capped once',()=>{
  const g=trial();g.subject.credit=2;g.trial.x=22.8;interact(g);respond(g,'refuse');respond(g,'refuse');
  finishTrial(g,'success');assert.equal(g.subject.credit,2);assert.equal(g.subject.suspicion,0);
});

test('relief and arbitrary hypothesis text never add suspicion',()=>{
  const g=trial();addHypothesis(g,'走ると危険？ 止まると離れる。全部知っている。');
  advance(g,1,{x:1,run:true});advance(g,.5);assert.equal(g.subject.suspicion,0);
  finishTrial(g,'success');interview(g,'observed');assert.equal(g.subject.suspicion,0);
});

test('interview only offers factual reply with current subject evidence; unsupported claim is scoped',()=>{
  const g=trial();finishTrial(g,'withdrawal');assert.equal(interview(g,'observed'),false);
  interview(g,'claim');assert.equal(g.subject.suspicion,1);interview(g,'claim');assert.equal(g.subject.suspicion,1);
});

test('death advances once, resets subject, keeps rules/envelope/archive and cancels effects',()=>{
  const g=trial();const seed=g.seed;g.envelope=[{id:'memo',text:'床の跡',kind:'hypothesis',day:1}];
  g.subject.credit=3;g.subject.suspicion=2;g.subject.evaluation=1;g.subject.effects.push({type:'deferred'});
  addHypothesis(g,'携帯記録');advance(g,3.1,{x:1,run:true});assert.equal(g.phase,'death');
  assert.equal(g.subject.number,1);leaveReport(g);assert.equal(g.phase,'morning');assert.equal(g.day,2);
  assert.equal(g.subject.number,2);assert.equal(g.subject.credit,0);assert.equal(g.subject.suspicion,0);assert.equal(g.subject.evaluation,0);
  assert.equal(g.subject.cards.length,0);assert.equal(g.subject.hypotheses.length,0);assert.equal(g.subject.effects.length,0);
  assert.equal(g.envelope.length,1);assert.equal(g.reports.length,1);assert.equal(g.seed,seed);assert.equal(g.parameters.threshold,2.5);
  leaveReport(g);assert.equal(g.day,2);assert.equal(g.subject.cards.length,0);
  readEnvelope(g);assert.equal(g.subject.cards.length,1);assert.equal(g.subject.cards[0].kind,'envelope');assert.equal(readEnvelope(g),false);
});

test('serialized resumption preserves a partially relieved warning and does not replay report/death',()=>{
  const g=trial();advance(g,1,{x:1,run:true});advance(g,.2);
  const restored=roundTrip(g);assert.deepEqual(restored,g);advance(restored,.3);assert.equal(restored.trial.mode,'retreating');
  advance(g,.3);assert.deepEqual(restored,g);
  finishTrial(g,'death');const after=roundTrip(g);leaveReport(after);const again=roundTrip(after);leaveReport(again);
  assert.equal(again.day,2);assert.equal(again.reports.length,1);
});

test('envelope is capped at 3, does not auto-restore, costs one action; safe duty once',()=>{
  const g=trial();for(let i=0;i<4;i++)addHypothesis(g,`記録${i}`);finishTrial(g,'success');interview(g,'silent');leaveReport(g);
  assert.equal(g.phase,'night');assert.equal(sealEnvelope(g,g.subject.hypotheses.map(h=>h.id)),true);
  assert.equal(g.envelope.length,3);assert.equal(g.nightActions,1);assert.equal(sealEnvelope(g,[]),false);
  assert.equal(safeDuty(g),true);assert.equal(safeDuty(g),false);assert.equal(g.nightActions,0);sleep(g);assert.equal(g.phase,'complete');
});

test('memory treatment erases current portable copies after JSON round trip, preserves envelope/reports',()=>{
  let g=trial();addHypothesis(g,'危険な仮説');finishTrial(g,'success');interview(g,'silent');leaveReport(g);
  sealEnvelope(g,g.subject.hypotheses.map(h=>h.id));g.subject.suspicion=3;g=roundTrip(g);
  assert.equal(applyMemory(g),true);assert.equal(g.subject.cards.length,0);assert.equal(g.subject.hypotheses.length,0);
  assert.equal(g.subject.evidence.length,0);assert.equal(g.envelope.length,1);assert.equal(g.reports.length,1);
  assert.equal(g.subject.suspicion,1);assert.equal(applyMemory(g),false);roundTrip(g);
});

test('reports contain encountered facts without revealing variants; both outcomes give fragments',()=>{
  const safe=trial(),fatal=trial();finishTrial(safe,'success');advance(fatal,3.1,{x:1,run:true});
  for(const g of [safe,fatal]) {assert.ok(g.reports[0].text);assert.doesNotMatch(g.reports[0].text,/1\.5|2\.5|許容速度|走ると死ぬ/);}
});

test('seventh-day death terminates with one report and no day eight',()=>{
  const g=trial();g.day=7;advance(g,3.1,{x:1,run:true});leaveReport(g);assert.equal(g.phase,'complete');assert.equal(g.day,7);assert.equal(g.reports.length,1);
});

test('corrupt JSON and structurally invalid saves are preserved byte-for-byte',()=>{
  const nullEvent=trial();nullEvent.events.push(null);
  const badOrder=trial();badOrder.trial.instruction.asked='yes';
  for(const raw of ['{broken',JSON.stringify({...createGame(),day:-1}),JSON.stringify({...createGame(),subject:null}),JSON.stringify({...trial(),trial:{}}),JSON.stringify(nullEvent),JSON.stringify(badOrder)]) {
    const storage=memoryStorage(raw),store=new SaveStore(storage);assert.ok(store.load().error);
    assert.equal(store.save(createGame()).ok,false);assert.equal(storage.values.get(SAVE_KEY),raw);
    const r=store.recoverAfterExport();assert.equal(r.ok,true);assert.equal(storage.values.get(r.backupKey),raw);
    assert.equal(store.save(createGame()).ok,true);
  }
});

test('storage read/write failures stop saving and never silently replace a slot',()=>{
  const store=new SaveStore({getItem(){throw Error('denied');},setItem(){throw Error('denied');}});
  assert.ok(store.load().error);assert.equal(store.save(createGame()).ok,false);assert.equal(store.recoverAfterExport().ok,true);
  assert.equal(store.save(createGame()).ok,false);assert.equal(store.blocked,true);
  const s=memoryStorage(JSON.stringify(trial()));const normal=new SaveStore(s);assert.ok(normal.load().game);
  assert.equal(normal.save(normal.load().game).ok,true);
});
