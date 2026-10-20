import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RaceRooms } from './room.ts';
import { MemoryBus, MemoryStore } from './memory-store.ts';
import { COUNTDOWN_MS, STALE_MS, type Pose, type ServerMsg } from '../src/net/protocol.ts';

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const store = new MemoryStore();
  const bus = new MemoryBus();
  const rooms = new RaceRooms(store, bus, clock.now);
  const log: ServerMsg[] = [];
  void bus.subscribe('ROOM', (m) => log.push(m));
  return { rooms, clock, log, store };
}

const pose = (dist: number, score = dist): Pose =>
  ({ x: 0, y: dist * 8, z: 0, heading: 0, spin: 0, flip: false, crash: false, dist, score });

type Snap = Extract<ServerMsg, { t: 'snapshot' }>;
const lastSnap = (log: ServerMsg[]) => log.filter((m): m is Snap => m.t === 'snapshot').at(-1)!;
const statusOf = (log: ServerMsg[], id: string) => lastSnap(log).players.find((p) => p.id === id)?.status;

/** Join a, b, c and run the clock past the countdown so the race is on. */
async function startRace(s: ReturnType<typeof setup>, ids = ['a', 'b', 'c']) {
  for (const id of ids) await s.rooms.join('ROOM', id, id.toUpperCase().repeat(3));
  s.clock.advance(COUNTDOWN_MS + 1);
  for (const id of ids) await s.rooms.onState('ROOM', id, pose(1));
}

test('one player waits; the second join starts a 10 s countdown', async () => {
  const s = setup();
  const one = await s.rooms.join('ROOM', 'a', 'AAA') as Snap;
  assert.equal(one.startAt, null);
  const two = await s.rooms.join('ROOM', 'b', 'BBB') as Snap;
  assert.equal(two.startAt, s.clock.now() + COUNTDOWN_MS);
});

test('each new join resets the countdown; a reconnect does not', async () => {
  const s = setup();
  await s.rooms.join('ROOM', 'a', 'AAA');
  await s.rooms.join('ROOM', 'b', 'BBB');
  s.clock.advance(7000);
  const three = await s.rooms.join('ROOM', 'c', 'CCC') as Snap;
  assert.equal(three.startAt, s.clock.now() + COUNTDOWN_MS);
  s.clock.advance(3000);
  const again = await s.rooms.join('ROOM', 'a', 'AAA') as Snap;
  assert.equal(again.startAt, three.startAt, 'reconnect keeps the countdown');
});

test('dropping below two players cancels the countdown', async () => {
  const s = setup();
  await s.rooms.join('ROOM', 'a', 'AAA');
  await s.rooms.join('ROOM', 'b', 'BBB');
  await s.rooms.leave('ROOM', 'b');
  assert.equal(lastSnap(s.log).startAt, null);
});

test('the race starts at the deadline and lobby players become racers', async () => {
  const s = setup();
  await startRace(s);
  for (const id of ['a', 'b', 'c']) assert.equal(statusOf(s.log, id), 'racing');
});

test('a mid-race join waits for the next race', async () => {
  const s = setup();
  await startRace(s);
  const snap = await s.rooms.join('ROOM', 'd', 'DDD') as Snap;
  assert.equal(snap.players.find((p) => p.id === 'd')?.status, 'waiting');
});

test('when the leader passes 1000 m the player furthest behind is eaten, one per mark', async () => {
  const s = setup();
  await startRace(s);
  await s.rooms.onState('ROOM', 'c', pose(400, 5000));   // lots of tricks, but last in distance
  await s.rooms.onState('ROOM', 'b', pose(800));
  await s.rooms.onState('ROOM', 'a', pose(999));
  assert.equal(s.log.filter((m) => m.t === 'eaten').length, 0);
  await s.rooms.onState('ROOM', 'a', pose(1001));
  const eaten = s.log.filter((m) => m.t === 'eaten');
  assert.deepEqual(eaten.map((e) => [e.id, e.mark, e.finalScore]), [['c', 1, 5000]]);
  // Concurrent updates past the same mark must not eat twice.
  await Promise.all([s.rooms.onState('ROOM', 'a', pose(1010)), s.rooms.onState('ROOM', 'b', pose(1005))]);
  assert.equal(s.log.filter((m) => m.t === 'eaten').length, 1);
});

test('the last survivor is eaten at the next mark and results rank by score', async () => {
  const s = setup();
  await startRace(s);
  await s.rooms.onState('ROOM', 'c', pose(500, 3000));
  await s.rooms.onState('ROOM', 'b', pose(900, 900));
  await s.rooms.onState('ROOM', 'a', pose(1000, 1000));     // c eaten (3000)
  await s.rooms.onState('ROOM', 'b', pose(1500, 1600));
  await s.rooms.onState('ROOM', 'a', pose(2000, 2100));     // b eaten (1600)
  await s.rooms.onState('ROOM', 'a', pose(3000, 3100));     // a eaten (3100), race over
  const eaten = s.log.filter((m) => m.t === 'eaten').map((e) => e.id);
  assert.deepEqual(eaten, ['c', 'b', 'a']);
  const results = s.log.find((m) => m.t === 'results');
  assert.ok(results && results.t === 'results');
  assert.deepEqual(results.ranking.map((r) => [r.name, r.finalScore]), [['AAA', 3100], ['CCC', 3000], ['BBB', 1600]]);
  // Room is reset and empty, ready for the next race.
  const snap = lastSnap(s.log);
  assert.equal(snap.players.length, 0);
  assert.equal(snap.raceId, 2);
  assert.equal(snap.nextMark, 1);
});

test('waiting players form the next lobby, and a fresh countdown starts if there are two', async () => {
  const s = setup();
  await startRace(s, ['a', 'b']);
  await s.rooms.join('ROOM', 'd', 'DDD');
  await s.rooms.join('ROOM', 'e', 'EEE');
  await s.rooms.onState('ROOM', 'a', pose(1000));   // b eaten
  await s.rooms.onState('ROOM', 'a', pose(2000));   // a eaten -> results + reset
  const snap = lastSnap(s.log);
  assert.deepEqual(snap.players.map((p) => [p.id, p.status]).sort(), [['d', 'lobby'], ['e', 'lobby']]);
  assert.equal(snap.startAt, s.clock.now() + COUNTDOWN_MS);
});

test('a racer who disappears is eaten after the stale timeout; a reconnect in time keeps their place', async () => {
  const s = setup();
  await startRace(s);
  await s.rooms.leave('ROOM', 'b');                  // socket dropped
  await s.rooms.join('ROOM', 'b', 'BBB');            // reconnected quickly
  assert.equal(statusOf(s.log, 'b'), 'racing');
  // b goes silent; a and c keep reporting every second.
  for (let i = 0; i <= STALE_MS / 1000; i++) {
    s.clock.advance(1000);
    await s.rooms.onState('ROOM', 'a', pose(50 + i));
    await s.rooms.onState('ROOM', 'c', pose(40 + i));
  }
  await s.rooms.resolve('ROOM');
  assert.equal(statusOf(s.log, 'a'), 'racing');
  const eaten = s.log.filter((m) => m.t === 'eaten').map((e) => [e.id, e.mark]);
  assert.deepEqual(eaten, [['b', 0]]);
});
