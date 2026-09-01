const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

const h = 3600000;
const d = 24*h;
const now = new Date('2026-09-01T13:00:00.000Z');
function dose(at, mg=1, id=at){ return {id, type:'dose', drug:'lorazepam', amountMg:mg, at}; }

test('current abstinence starts at latest lorazepam dose', () => {
  const logs=[dose('2026-08-30T20:00:00.000Z',10), dose('2026-08-25T10:00:00.000Z',1)];
  assert.equal(core.currentAbstinenceMs(logs, now), 41*h);
});

test('record keeps the longest completed interval after a new rescue dose', () => {
  const logs=[dose('2026-08-20T08:00:00.000Z',1,'a'),dose('2026-08-23T08:00:00.000Z',1,'b'),dose('2026-08-30T20:00:00.000Z',1,'c')];
  assert.equal(core.recordAbstinenceMs(logs, now), 7.5*d);
  assert.equal(core.currentAbstinenceMs(logs, now), 41*h);
});

test('editing or deleting a dose recalculates intervals from history', () => {
  const logs=[dose('2026-08-20T08:00:00.000Z',1,'a'),dose('2026-08-23T08:00:00.000Z',1,'b'),dose('2026-08-30T20:00:00.000Z',1,'c')];
  assert.equal(core.recordAbstinenceMs(core.deleteEntry(logs,'b'), now), 10.5*d);
  assert.equal(core.recordAbstinenceMs(core.updateEntry(logs,'c',{at:'2026-08-29T20:00:00.000Z'}), now), 6.5*d);
});

test('7 and 30 day totals use rolling absolute-time windows', () => {
  const logs=[dose('2026-09-01T12:00:00.000Z',1),dose('2026-08-25T13:00:00.000Z',2),dose('2026-08-25T12:59:59.000Z',4),dose('2026-08-02T13:00:01.000Z',8)];
  assert.equal(core.totalMgWithin(logs,7,now),3);
  assert.equal(core.totalMgWithin(logs,30,now),15);
});

test('craving records never count as doses', () => {
  const logs=[dose('2026-08-30T20:00:00.000Z',1), {id:'x',type:'craving',level:4,at:'2026-09-01T12:30:00.000Z'}];
  assert.equal(core.currentAbstinenceMs(logs,now),41*h);
  assert.equal(core.recentDoseCount(logs,7,now),1);
});

test('trend compares latest 7-day consumption with previous 7 days', () => {
  const trend=core.consumptionTrend([dose('2026-08-31T13:00:00.000Z',2),dose('2026-08-24T13:00:00.000Z',6)],7,now);
  assert.equal(trend.current,2);assert.equal(trend.previous,6);assert.equal(trend.direction,'down');
});

test('qualitative exposure returns bands and never a clinical percentage', () => {
  const exposure=core.estimateExposure([dose('2026-09-01T12:00:00.000Z',5),dose('2026-08-31T12:00:00.000Z',5)],now);
  assert.ok(['Muy baja','Baja','Media','Alta','Muy alta'].includes(exposure.label));
  assert.equal('percentage' in exposure,false);assert.equal('score' in exposure,false);
});

test('legacy state migration preserves medication logs and adds v3 collections', () => {
  const raw={version:'2.1.0',logs:[{id:'l1',drug:'lorazepam',amountMg:1,at:'2026-08-30T20:00:00.000Z',note:'legacy'},{id:'p1',drug:'pregabalin',amountMg:100,at:'2026-08-30T21:00:00.000Z'}],updatedAt:1};
  const migrated=core.normalizeState(raw,{timeZone:'Europe/Madrid'});
  assert.equal(migrated.schemaVersion,3);assert.equal(migrated.logs.length,2);assert.equal(migrated.logs[0].note,'legacy');assert.deepEqual(migrated.cravings,[]);assert.equal(migrated.tabletMg,null);
});

test('new records preserve absolute instant and timezone context', () => {
  const rec=core.createDoseRecord({amountMg:1,at:new Date('2026-10-25T01:30:00.000Z'),timeZone:'Europe/Madrid',offsetMinutes:60,note:'DST'});
  assert.equal(rec.at,'2026-10-25T01:30:00.000Z');assert.equal(rec.timeZone,'Europe/Madrid');assert.equal(rec.offsetMinutes,60);assert.match(rec.localDate,/^2026-10-25$/);
});
