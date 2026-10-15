const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_RECORDS,
  attachFeedbackRail,
  createBattleSession,
  createFeedbackQueue,
  clearFeedbackQueues,
  detectAppliedGarbage,
  formatBattleFeedback,
  createRecordStore,
  resolveStorage,
  mapBoardStats,
  accumulateRoundTotals,
  diffBattleStats,
  buildBattleSummary,
} = require('../multiplayer-competition.js');

test('battle events produce concise transient feedback for the existing game HUD', () => {
  assert.deepEqual(formatBattleFeedback({ type: 'attack', player: 'P1', amount: 3 }), {
    text: '即將送出 +3',
    kind: 'attack',
  });
  assert.deepEqual(formatBattleFeedback({ type: 'received', player: 'P2', amount: 3 }), {
    text: '即將收到 +3',
    kind: 'received',
  });
  assert.deepEqual(formatBattleFeedback({ type: 'garbage', player: 'P2', amount: 3 }), {
    text: '收到垃圾行',
    kind: 'garbage',
  });
  assert.deepEqual(formatBattleFeedback({ type: 'combo', player: 'P1', amount: 2 }), {
    text: '2 COMBO!',
    kind: 'combo',
  });
  assert.deepEqual(formatBattleFeedback({ type: 'ko', player: 'P2', amount: 1 }), {
    text: 'KO!',
    kind: 'ko',
  });
});

test('feedback queue shows simultaneous attack and combo messages in order', () => {
  const visible = [];
  const timers = [];
  const queue = createFeedbackQueue({
    show(feedback) { visible.push(feedback.text); },
    hide() { visible.shift(); },
    setTimer(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimer() {},
  });

  queue.push({ text: '即將送出 +2', kind: 'attack' });
  queue.push({ text: '2 COMBO!', kind: 'combo' });

  assert.deepEqual(visible, ['即將送出 +2']);
  timers.shift()();
  assert.deepEqual(visible, ['2 COMBO!']);
  timers.shift()();
  assert.deepEqual(visible, []);
});

test('feedback rail is inserted beside the player title instead of inside the board', () => {
  const insertions = [];
  const title = {
    insertAdjacentElement(position, node) { insertions.push({ position, node }); },
  };
  const card = {
    querySelector(selector) {
      assert.equal(selector, '.player-title');
      return title;
    },
  };
  const doc = {
    createElement(tag) {
      return {
        tag,
        className: '',
        dataset: {},
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
      };
    },
    querySelector(selector) {
      assert.equal(selector, '.player-card.p2');
      return card;
    },
  };

  const rail = attachFeedbackRail(doc, 'P1');

  assert.equal(rail.className, 'competition-feedback-rail');
  assert.equal(rail.dataset.competitionToast, 'P1');
  assert.deepEqual(insertions, [{ position: 'afterend', node: rail }]);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('mapBoardStats keeps the on-screen P1 and P2 labels aligned with their boards', () => {
  const result = mapBoardStats({
    slot1: { sent: 7, ko: 1, combo: 2, pending: 3 },
    slot2: { sent: 4, ko: 0, combo: 1, pending: 5 },
  });

  assert.deepEqual(result, {
    P1: { sent: 4, received: 7, ko: 0, combo: 1, pending: 5 },
    P2: { sent: 7, received: 4, ko: 1, combo: 2, pending: 3 },
  });
});

test('recordResult preserves earlier results and records one win and one loss', () => {
  const storage = memoryStorage();
  const records = createRecordStore(storage, 'records');

  records.recordResult('P1');
  records.recordResult('P2');
  records.recordResult('P1');

  assert.deepEqual(records.load(), {
    P1: { wins: 2, losses: 1 },
    P2: { wins: 1, losses: 2 },
  });
});

test('clear removes persisted records and returns clean totals', () => {
  const storage = memoryStorage({
    records: JSON.stringify({
      P1: { wins: 8, losses: 2 },
      P2: { wins: 2, losses: 8 },
    }),
  });
  const records = createRecordStore(storage, 'records');

  records.clear();

  assert.deepEqual(records.load(), DEFAULT_RECORDS);
});

test('malformed stored records fall back to clean totals', () => {
  const records = createRecordStore(memoryStorage({ records: '{broken' }), 'records');

  assert.deepEqual(records.load(), DEFAULT_RECORDS);
});

test('records remain available in memory when browser storage is blocked', () => {
  const blockedStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  const records = createRecordStore(blockedStorage, 'records');

  records.recordResult('P2');

  assert.deepEqual(records.load(), {
    P1: { wins: 0, losses: 1 },
    P2: { wins: 1, losses: 0 },
  });
});

test('resolveStorage returns null when the browser blocks the localStorage getter', () => {
  const browser = {};
  Object.defineProperty(browser, 'localStorage', {
    get() { throw new Error('blocked getter'); },
  });

  assert.equal(resolveStorage(browser), null);
});

test('round totals keep earlier attacks when a board counter resets after a KO', () => {
  const totals = {
    P1: { sent: 6, received: 3 },
    P2: { sent: 3, received: 6 },
  };
  const beforeReset = {
    P1: { sent: 6, received: 3 },
    P2: { sent: 3, received: 6 },
  };
  const afterReset = {
    P1: { sent: 0, received: 3 },
    P2: { sent: 3, received: 0 },
  };
  const afterNewAttack = {
    P1: { sent: 2, received: 3 },
    P2: { sent: 3, received: 2 },
  };

  const unchanged = accumulateRoundTotals(totals, beforeReset, afterReset);
  const accumulated = accumulateRoundTotals(unchanged, afterReset, afterNewAttack);

  assert.deepEqual(accumulated, {
    P1: { sent: 8, received: 3 },
    P2: { sent: 3, received: 8 },
  });
});

test('diffBattleStats reports outgoing attacks, incoming attacks, combos, and KOs', () => {
  const before = {
    P1: { sent: 2, received: 1, ko: 0, combo: 0, pending: 0 },
    P2: { sent: 1, received: 2, ko: 0, combo: 0, pending: 0 },
  };
  const after = {
    P1: { sent: 5, received: 1, ko: 1, combo: 2, pending: 0 },
    P2: { sent: 1, received: 5, ko: 0, combo: 0, pending: 3 },
  };

  assert.deepEqual(diffBattleStats(before, after), [
    { type: 'attack', player: 'P1', amount: 3 },
    { type: 'received', player: 'P2', amount: 3 },
    { type: 'combo', player: 'P1', amount: 2 },
    { type: 'ko', player: 'P1', amount: 1 },
  ]);
});

test('diffBattleStats does not misreport cancelled pending rows as applied garbage', () => {
  const before = {
    P1: { sent: 0, received: 0, ko: 0, combo: 0, pending: 0 },
    P2: { sent: 0, received: 0, ko: 0, combo: 0, pending: 3 },
  };
  const after = {
    P1: { sent: 0, received: 0, ko: 0, combo: 0, pending: 0 },
    P2: { sent: 0, received: 0, ko: 0, combo: 0, pending: 0 },
  };

  assert.deepEqual(diffBattleStats(before, after), []);
});

test('applied garbage requires both pending reduction and new garbage rows on the canvas', () => {
  const before = {
    P1: { pending: 0, ko: 0 },
    P2: { pending: 4, ko: 0 },
  };
  const after = {
    P1: { pending: 0, ko: 0 },
    P2: { pending: 0, ko: 0 },
  };

  assert.deepEqual(detectAppliedGarbage(before, after, { P1: 0, P2: 0 }, { P1: 0, P2: 4 }), [
    { type: 'garbage', player: 'P2' },
  ]);
  assert.deepEqual(detectAppliedGarbage(before, after, { P1: 0, P2: 0 }, { P1: 0, P2: 0 }), []);
});

test('clearFeedbackQueues clears every player queue before a new round', () => {
  const cleared = [];

  clearFeedbackQueues({
    P1: { clear() { cleared.push('P1'); } },
    P2: { clear() { cleared.push('P2'); } },
  });

  assert.deepEqual(cleared, ['P1', 'P2']);
});

test('battle session keeps round totals through KO and resets only single-round data on restart', () => {
  const empty = {
    P1: { sent: 0, received: 0, ko: 0, combo: 0, pending: 0 },
    P2: { sent: 0, received: 0, ko: 0, combo: 0, pending: 0 },
  };
  const session = createBattleSession();
  session.begin(empty);

  const firstEvents = session.update({
    P1: { sent: 2, received: 0, ko: 1, combo: 2, pending: 0 },
    P2: { sent: 0, received: 2, ko: 0, combo: 0, pending: 2 },
  });
  session.update({
    P1: { sent: 0, received: 0, ko: 1, combo: 0, pending: 0 },
    P2: { sent: 0, received: 0, ko: 0, combo: 0, pending: 0 },
  });
  session.update({
    P1: { sent: 3, received: 0, ko: 2, combo: 1, pending: 0 },
    P2: { sent: 0, received: 3, ko: 0, combo: 0, pending: 3 },
  });
  const result = session.finish('P1', {
    P1: { sent: 3, received: 0, ko: 2, combo: 1, pending: 0 },
    P2: { sent: 0, received: 3, ko: 0, combo: 0, pending: 3 },
  });

  assert.deepEqual(firstEvents.map((event) => event.type), ['attack', 'received', 'combo', 'ko']);
  assert.equal(result.summary.title, 'P1 獲勝');
  assert.deepEqual(result.stats.P1, { sent: 5, received: 0, ko: 2, combo: 2, pending: 0 });
  assert.deepEqual(result.stats.P2, { sent: 0, received: 5, ko: 0, combo: 0, pending: 3 });

  session.begin(empty);
  assert.deepEqual(session.snapshot(), {
    active: true,
    maxCombo: { P1: 0, P2: 0 },
    totals: {
      P1: { sent: 0, received: 0 },
      P2: { sent: 0, received: 0 },
    },
  });
});

test('buildBattleSummary uses the winner and both players current round totals', () => {
  const summary = buildBattleSummary('P2', {
    P1: { sent: 6, received: 9, ko: 1, combo: 2, pending: 0 },
    P2: { sent: 9, received: 6, ko: 2, combo: 3, pending: 0 },
  });

  assert.deepEqual(summary, {
    title: 'P2 獲勝',
    lines: [
      'P1｜KO 1｜送出 6｜收到 9｜最高顯示連擊 2',
      'P2｜KO 2｜送出 9｜收到 6｜最高顯示連擊 3',
    ],
  });
});
