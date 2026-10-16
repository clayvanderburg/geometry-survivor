import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStepClock } from '../js/clock.js';
import { drawCrabShip, drawPlayerShield } from '../js/ship-renderer.js';

test('identical movement, damage and timers at 30, 60 and 144 rendered FPS', () => {
  const runs = [30,60,144].map(fps => {
    const clock = new FixedStepClock(0);
    const state = { x:0, hp:1000, time:0, ticks:0 };
    for (let frame=1;frame<=fps*10;frame++) clock.advance(frame*1000/fps, dt => {
      state.x += 2; state.hp -= 0.1; state.time += dt; state.ticks++;
    });
    return state;
  });
  assert.deepEqual(runs[0], runs[1]); assert.deepEqual(runs[1], runs[2]);
  assert.equal(runs[0].ticks,600);
});

test('clock bounds stalls and reset discards hidden time', () => {
  const clock = new FixedStepClock(0);
  assert.equal(clock.advance(60000,()=>{}),15);
  clock.reset(120000);
  assert.equal(clock.advance(120001,()=>{}),0);
});

test('shared renderers balance canvas save/restore and accept zero heading', () => {
  let depth=0;
  const rotations=[];
  const ctx = new Proxy({}, { get(_,key) {
    if(key==='save') return ()=>depth++;
    if(key==='restore') return ()=>{ assert.ok(depth>0); depth--; };
    if(key==='rotate') return angle=>rotations.push(angle);
    if(key==='createRadialGradient') return ()=>({addColorStop(){}});
    return ()=>{};
  },set(){return true;}});
  const p={x:0,y:0,radius:15,hp:100,maxHp:100,invuln:0,angle:1,drillAngle:0,stats:{drillScale:1}};
  drawCrabShip(ctx,p,{},false,0); drawPlayerShield(ctx,p,0,{},0,0);
  assert.equal(depth,0); assert.equal(rotations[0],0);
});
