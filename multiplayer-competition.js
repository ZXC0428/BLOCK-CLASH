(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (typeof document !== 'undefined') {
    api.install(document, root);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_RECORDS = Object.freeze({
    P1: Object.freeze({ wins: 0, losses: 0 }),
    P2: Object.freeze({ wins: 0, losses: 0 }),
  });
  const RECORDS_KEY = 'block-clash.multiplayer-records.v1';
  const PLAYER_BINDINGS = Object.freeze({
    P1: Object.freeze({ board: 'board2', card: '.player-card.p2', slot: 'slot2' }),
    P2: Object.freeze({ board: 'board1', card: '.player-card.p1', slot: 'slot1' }),
  });

  function cleanCount(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }

  function cleanRecords(value) {
    if (!value || typeof value !== 'object') return null;
    if (!value.P1 || !value.P2) return null;
    return {
      P1: { wins: cleanCount(value.P1.wins), losses: cleanCount(value.P1.losses) },
      P2: { wins: cleanCount(value.P2.wins), losses: cleanCount(value.P2.losses) },
    };
  }

  function freshRecords() {
    return {
      P1: { wins: 0, losses: 0 },
      P2: { wins: 0, losses: 0 },
    };
  }

  function createRecordStore(storage, key = RECORDS_KEY) {
    let memory = freshRecords();

    function load() {
      try {
        const raw = storage && storage.getItem(key);
        if (!raw) return cleanRecords(memory);
        const parsed = cleanRecords(JSON.parse(raw));
        if (!parsed) {
          memory = freshRecords();
          return cleanRecords(memory);
        }
        memory = parsed;
        return cleanRecords(memory);
      } catch (_) {
        return cleanRecords(memory);
      }
    }

    function save(records) {
      memory = cleanRecords(records) || freshRecords();
      try {
        if (storage) storage.setItem(key, JSON.stringify(memory));
      } catch (_) {
        // Storage can be unavailable for local files or privacy-restricted browsers.
      }
      return cleanRecords(memory);
    }

    function recordResult(winner) {
      const records = load();
      if (winner !== 'P1' && winner !== 'P2') return records;
      const loser = winner === 'P1' ? 'P2' : 'P1';
      records[winner].wins += 1;
      records[loser].losses += 1;
      return save(records);
    }

    function clear() {
      memory = freshRecords();
      try {
        if (storage) storage.removeItem(key);
      } catch (_) {
        // Keep the in-memory fallback usable when storage removal is blocked.
      }
      return freshRecords();
    }

    return { load, recordResult, clear };
  }

  function resolveStorage(browser) {
    try {
      return browser.localStorage;
    } catch (_) {
      return null;
    }
  }

  function normalizePlayerStats(stats) {
    return {
      sent: cleanCount(stats && stats.sent),
      received: cleanCount(stats && stats.received),
      ko: cleanCount(stats && stats.ko),
      combo: cleanCount(stats && stats.combo),
      pending: cleanCount(stats && stats.pending),
    };
  }

  function mapBoardStats(boardStats) {
    const slots = {
      slot1: normalizePlayerStats(boardStats && boardStats.slot1),
      slot2: normalizePlayerStats(boardStats && boardStats.slot2),
    };
    return Object.fromEntries(['P1', 'P2'].map((player) => {
      const opponent = player === 'P1' ? 'P2' : 'P1';
      const own = slots[PLAYER_BINDINGS[player].slot];
      const other = slots[PLAYER_BINDINGS[opponent].slot];
      return [player, {
        sent: own.sent,
        received: other.sent,
        ko: own.ko,
        combo: own.combo,
        pending: own.pending,
      }];
    }));
  }

  function accumulateRoundTotals(totals, before, after) {
    const next = {
      P1: {
        sent: cleanCount(totals && totals.P1 && totals.P1.sent),
        received: cleanCount(totals && totals.P1 && totals.P1.received),
      },
      P2: {
        sent: cleanCount(totals && totals.P2 && totals.P2.sent),
        received: cleanCount(totals && totals.P2 && totals.P2.received),
      },
    };
    const previous = {
      P1: normalizePlayerStats(before && before.P1),
      P2: normalizePlayerStats(before && before.P2),
    };
    const current = {
      P1: normalizePlayerStats(after && after.P1),
      P2: normalizePlayerStats(after && after.P2),
    };
    ['P1', 'P2'].forEach((player) => {
      const delta = current[player].sent - previous[player].sent;
      if (delta <= 0) return;
      const opponent = player === 'P1' ? 'P2' : 'P1';
      next[player].sent += delta;
      next[opponent].received += delta;
    });
    return next;
  }

  function diffBattleStats(before, after) {
    const previous = {
      P1: normalizePlayerStats(before && before.P1),
      P2: normalizePlayerStats(before && before.P2),
    };
    const current = {
      P1: normalizePlayerStats(after && after.P1),
      P2: normalizePlayerStats(after && after.P2),
    };
    const events = [];

    ['P1', 'P2'].forEach((player) => {
      const amount = current[player].sent - previous[player].sent;
      if (amount > 0) {
        const opponent = player === 'P1' ? 'P2' : 'P1';
        events.push({ type: 'attack', player, amount });
        events.push({ type: 'received', player: opponent, amount });
      }
    });
    ['P1', 'P2'].forEach((player) => {
      if (current[player].combo > previous[player].combo && current[player].combo > 0) {
        events.push({ type: 'combo', player, amount: current[player].combo });
      }
    });
    ['P1', 'P2'].forEach((player) => {
      const amount = current[player].ko - previous[player].ko;
      if (amount > 0) events.push({ type: 'ko', player, amount });
    });
    return events;
  }

  function formatBattleFeedback(event) {
    if (!event) return null;
    if (event.type === 'attack') return { text: `即將送出 +${cleanCount(event.amount)}`, kind: 'attack' };
    if (event.type === 'received') return { text: `即將收到 +${cleanCount(event.amount)}`, kind: 'received' };
    if (event.type === 'garbage') return { text: '收到垃圾行', kind: 'garbage' };
    if (event.type === 'combo') return { text: `${cleanCount(event.amount)} COMBO!`, kind: 'combo' };
    if (event.type === 'ko') return { text: 'KO!', kind: 'ko' };
    return null;
  }

  function createFeedbackQueue(options) {
    const pending = [];
    let active = null;
    let timer = null;

    function playNext() {
      if (active || !pending.length) return;
      active = pending.shift();
      options.show(active);
      const duration = active.kind === 'ko' ? 1500 : 900;
      timer = options.setTimer(() => {
        const finished = active;
        active = null;
        timer = null;
        options.hide(finished);
        playNext();
      }, duration);
    }

    function push(feedback) {
      if (!feedback) return;
      pending.push(feedback);
      playNext();
    }

    function clear() {
      pending.length = 0;
      if (timer !== null) options.clearTimer(timer);
      if (active) options.hide(active);
      active = null;
      timer = null;
    }

    return { push, clear };
  }

  function clearFeedbackQueues(queues) {
    ['P1', 'P2'].forEach((player) => {
      if (queues && queues[player]) queues[player].clear();
    });
  }

  function detectAppliedGarbage(before, after, beforeRows, afterRows) {
    const previous = {
      P1: normalizePlayerStats(before && before.P1),
      P2: normalizePlayerStats(before && before.P2),
    };
    const current = {
      P1: normalizePlayerStats(after && after.P1),
      P2: normalizePlayerStats(after && after.P2),
    };
    return ['P1', 'P2'].flatMap((player) => {
      if (current[player].pending >= previous[player].pending) return [];
      if (current[player].ko !== previous[player].ko) return [];
      const addedRows = cleanCount(afterRows && afterRows[player]) - cleanCount(beforeRows && beforeRows[player]);
      return addedRows > 0 ? [{ type: 'garbage', player }] : [];
    });
  }

  function countCanvasGarbageRows(canvas) {
    if (!canvas || !canvas.getContext) return 0;
    try {
      const context = canvas.getContext('2d');
      let rows = 0;
      for (let y = 0; y < 20; y += 1) {
        let garbageCells = 0;
        for (let x = 0; x < 10; x += 1) {
          const pixel = context.getImageData(x * 30 + 1, y * 30 + 1, 1, 1).data;
          if (pixel[0] === 38 && pixel[1] === 49 && pixel[2] === 66 && pixel[3] === 255) {
            garbageCells += 1;
          }
        }
        if (garbageCells >= 8) rows += 1;
      }
      return rows;
    } catch (_) {
      return 0;
    }
  }

  function attachFeedbackRail(doc, player) {
    const binding = PLAYER_BINDINGS[player];
    const card = binding && doc.querySelector(binding.card);
    const title = card && card.querySelector('.player-title');
    if (!title) return null;
    const rail = doc.createElement('div');
    rail.className = 'competition-feedback-rail';
    rail.dataset.competitionToast = player;
    rail.setAttribute('aria-live', 'polite');
    title.insertAdjacentElement('afterend', rail);
    return rail;
  }

  function buildBattleSummary(winner, stats) {
    const normalized = {
      P1: normalizePlayerStats(stats && stats.P1),
      P2: normalizePlayerStats(stats && stats.P2),
    };
    return {
      title: winner === 'P1' || winner === 'P2' ? `${winner} 獲勝` : '本局平手',
      lines: ['P1', 'P2'].map((player) => {
        const value = normalized[player];
        return `${player}｜KO ${value.ko}｜送出 ${value.sent}｜收到 ${value.received}｜最高顯示連擊 ${value.combo}`;
      }),
    };
  }

  function createBattleSession() {
    let active = false;
    let previous = null;
    let maxCombo = { P1: 0, P2: 0 };
    let totals = {
      P1: { sent: 0, received: 0 },
      P2: { sent: 0, received: 0 },
    };

    function normalizeMatchStats(stats) {
      return {
        P1: normalizePlayerStats(stats && stats.P1),
        P2: normalizePlayerStats(stats && stats.P2),
      };
    }

    function reset() {
      active = false;
      previous = null;
      maxCombo = { P1: 0, P2: 0 };
      totals = {
        P1: { sent: 0, received: 0 },
        P2: { sent: 0, received: 0 },
      };
    }

    function begin(stats) {
      reset();
      active = true;
      previous = normalizeMatchStats(stats);
    }

    function update(stats) {
      const current = normalizeMatchStats(stats);
      if (!active || !previous) {
        previous = current;
        return [];
      }
      totals = accumulateRoundTotals(totals, previous, current);
      const events = diffBattleStats(previous, current);
      ['P1', 'P2'].forEach((player) => {
        maxCombo[player] = Math.max(maxCombo[player], current[player].combo);
      });
      previous = current;
      return events;
    }

    function finish(winner, stats) {
      const current = normalizeMatchStats(stats);
      const finalStats = {
        P1: { ...current.P1, ...totals.P1, combo: maxCombo.P1 },
        P2: { ...current.P2, ...totals.P2, combo: maxCombo.P2 },
      };
      if (winner === 'P1' || winner === 'P2') {
        finalStats[winner].ko = Math.max(2, finalStats[winner].ko);
      }
      active = false;
      return {
        stats: finalStats,
        summary: buildBattleSummary(winner, finalStats),
      };
    }

    function snapshot() {
      return {
        active,
        maxCombo: { ...maxCombo },
        totals: {
          P1: { ...totals.P1 },
          P2: { ...totals.P2 },
        },
      };
    }

    return { begin, finish, reset, snapshot, update };
  }

  function install(doc, win) {
    const style = doc.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'multiplayer-competition.css';
    style.dataset.blockClashCompetition = 'styles';
    (doc.head || doc.documentElement).appendChild(style);

    const state = {
      ready: false,
      roundActive: false,
      roundRecorded: false,
      countdownToken: 0,
      countdownTimers: [],
      session: createBattleSession(),
      originalStart: null,
      startButton: null,
      syncQueued: false,
      feedbackQueues: {},
      feedbackSnapshot: null,
      garbageRows: { P1: 0, P2: 0 },
      globalAlertTimer: null,
      store: createRecordStore(resolveStorage(win), RECORDS_KEY),
    };
    const gameKeys = new Set([
      'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp',
      'KeyA', 'KeyD', 'KeyS', 'KeyW', 'ShiftLeft', 'Enter', 'KeyP', 'KeyR',
    ]);

    function isEditable(target) {
      return Boolean(target && target.closest && target.closest('input, select, textarea, [contenteditable="true"]'));
    }

    function multiplayerSelected() {
      const label = doc.getElementById('modeName');
      return Boolean(label && label.textContent.includes('雙人'));
    }

    function stopGameKeyScroll(event) {
      const code = event.code || event.key;
      if (gameKeys.has(code) && !isEditable(event.target)) event.preventDefault();
      if (state.ready && state.countdownTimers.length && gameKeys.has(code) && !isEditable(event.target)) {
        event.stopImmediatePropagation();
        if (code === 'KeyR') clearCountdown();
        return;
      }
      if (state.ready && code === 'KeyR' && multiplayerSelected()) {
        clearCountdown();
        state.roundActive = false;
        state.roundRecorded = false;
        state.session.reset();
        state.feedbackSnapshot = null;
        state.garbageRows = { P1: 0, P2: 0 };
        const summary = doc.getElementById('competitionSummary');
        if (summary) summary.classList.add('hidden');
        return;
      }
      if (!state.ready || code !== 'Enter' || isEditable(event.target)) return;
      if (state.countdownTimers.length || (multiplayerSelected() && !state.roundActive)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!state.countdownTimers.length) beginCountdown();
      }
    }

    win.addEventListener('keydown', stopGameKeyScroll, true);

    function gateTouchStart(event) {
      const control = event.target && event.target.closest && event.target.closest('[data-action]');
      if (!state.ready || !control || !multiplayerSelected()) return;
      if (state.countdownTimers.length || !state.roundActive) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!state.countdownTimers.length) beginCountdown();
      }
    }

    doc.addEventListener('click', gateTouchStart, true);

    function element(tag, className, html) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (html !== undefined) node.innerHTML = html;
      return node;
    }

    function createCompetitionUI() {
      const records = element('section', 'competition-records-bar', `
        <small>MULTIPLAYER RECORD</small>
        <div class="competition-records" aria-label="累積戰績">
          <span>P1 <b data-record="P1">0 勝 / 0 敗</b></span>
          <span>P2 <b data-record="P2">0 勝 / 0 敗</b></span>
          <button type="button" class="secondary competition-clear">清除戰績</button>
        </div>
      `);
      records.id = 'competitionRecords';
      records.setAttribute('aria-label', '雙人累積戰績');
      const summary = element('div', 'competition-summary hidden');
      summary.id = 'competitionSummary';
      summary.setAttribute('aria-live', 'polite');
      const hud = doc.querySelector('.hud');
      hud.insertAdjacentElement('afterend', records);
      const message = doc.getElementById('message');
      message.insertAdjacentElement('afterend', summary);

      const globalAlert = element('div', 'competition-global-alert');
      globalAlert.id = 'competitionGlobalAlert';
      globalAlert.setAttribute('aria-live', 'assertive');
      doc.body.appendChild(globalAlert);

      ['P1', 'P2'].forEach((player) => {
        attachFeedbackRail(doc, player);
      });

      records.querySelector('.competition-clear').addEventListener('click', () => {
        state.store.clear();
        renderRecords();
      });
    }

    function readNumber(id) {
      const node = doc.getElementById(id);
      return cleanCount(node && node.textContent);
    }

    function readStats() {
      return mapBoardStats({
        slot1: {
          sent: readNumber('p1Sent'),
          ko: readNumber('p1Ko'),
          combo: readNumber('p1Combo'),
          pending: readNumber('p1Pending'),
        },
        slot2: {
          sent: readNumber('p2Sent'),
          ko: readNumber('p2Ko'),
          combo: readNumber('p2Combo'),
          pending: readNumber('p2Pending'),
        },
      });
    }

    function renderRecords() {
      const records = state.store.load();
      ['P1', 'P2'].forEach((player) => {
        const node = doc.querySelector(`[data-record="${player}"]`);
        if (node) node.textContent = `${records[player].wins} 勝 / ${records[player].losses} 敗`;
      });
    }

    function playerCard(player) {
      const binding = PLAYER_BINDINGS[player];
      return binding ? doc.querySelector(binding.card) : null;
    }

    function readGarbageRows(player) {
      const binding = PLAYER_BINDINGS[player];
      return binding ? countCanvasGarbageRows(doc.getElementById(binding.board)) : 0;
    }

    function showFeedback(player, feedback) {
      const toast = doc.querySelector(`[data-competition-toast="${player}"]`);
      const card = playerCard(player);
      if (!toast || !card) return;
      toast.textContent = feedback.text;
      toast.className = `competition-feedback-rail show ${feedback.kind}`;
      card.classList.remove(`competition-${feedback.kind}`);
      void card.offsetWidth;
      card.classList.add(`competition-${feedback.kind}`);
    }

    function hideFeedback(player, feedback) {
      const toast = doc.querySelector(`[data-competition-toast="${player}"]`);
      const card = playerCard(player);
      if (toast) toast.classList.remove('show');
      if (card) card.classList.remove(`competition-${feedback.kind}`);
    }

    function announce(player, text, kind) {
      if (!state.feedbackQueues[player]) {
        state.feedbackQueues[player] = createFeedbackQueue({
          show: (feedback) => showFeedback(player, feedback),
          hide: (feedback) => hideFeedback(player, feedback),
          setTimer: (callback, duration) => win.setTimeout(callback, duration),
          clearTimer: (timer) => win.clearTimeout(timer),
        });
      }
      state.feedbackQueues[player].push({ text, kind });
    }

    function announceGlobal(text) {
      const alert = doc.getElementById('competitionGlobalAlert');
      if (!alert) return;
      clearGlobalAlert();
      alert.textContent = text;
      void alert.offsetWidth;
      alert.classList.add('show');
      state.globalAlertTimer = win.setTimeout(() => {
        alert.classList.remove('show');
        state.globalAlertTimer = null;
      }, 1500);
    }

    function clearGlobalAlert() {
      if (state.globalAlertTimer !== null) win.clearTimeout(state.globalAlertTimer);
      state.globalAlertTimer = null;
      const alert = doc.getElementById('competitionGlobalAlert');
      if (alert) alert.classList.remove('show');
    }

    function renderEvent(event) {
      const feedback = formatBattleFeedback(event);
      if (!feedback) return;
      announce(event.player, feedback.text, feedback.kind);
      if (event.type === 'ko') announceGlobal(`${event.player} 拿下 KO！`);
    }

    function detectWinner() {
      const title = doc.querySelector('#message h2');
      const match = title && title.textContent.match(/P([12])\s*獲勝/);
      return match ? `P${match[1]}` : null;
    }

    function finishRound(winner, stats) {
      if (state.roundRecorded) return;
      state.roundRecorded = true;
      state.roundActive = false;
      const result = state.session.finish(winner, stats);
      state.store.recordResult(winner);
      renderRecords();
      announce(winner, 'MATCH WIN!', 'ko');
      announceGlobal(`${winner} MATCH WIN`);
      const summary = result.summary;
      const box = doc.getElementById('competitionSummary');
      box.innerHTML = `<h3>${summary.title}</h3>${summary.lines.map((line) => `<p>${line}</p>`).join('')}<small>重新開局會保留累積勝敗，單局數據會歸零。</small>`;
      box.classList.remove('hidden');
    }

    function sync() {
      state.syncQueued = false;
      const stats = readStats();
      if (state.roundActive) {
        const garbageRows = { ...state.garbageRows };
        ['P1', 'P2'].forEach((player) => {
          const previous = state.feedbackSnapshot && state.feedbackSnapshot[player];
          if (!previous || previous.pending !== stats[player].pending) {
            garbageRows[player] = readGarbageRows(player);
          }
        });
        detectAppliedGarbage(state.feedbackSnapshot, stats, state.garbageRows, garbageRows).forEach(renderEvent);
        state.garbageRows = garbageRows;
        state.feedbackSnapshot = stats;
        state.session.update(stats).forEach(renderEvent);
      }
      const winner = state.roundActive && detectWinner();
      if (winner) finishRound(winner, stats);
    }

    function queueSync() {
      if (state.syncQueued) return;
      state.syncQueued = true;
      win.requestAnimationFrame(sync);
    }

    function clearCountdown() {
      state.countdownToken += 1;
      state.countdownTimers.forEach((timer) => win.clearTimeout(timer));
      state.countdownTimers = [];
      clearFeedbackQueues(state.feedbackQueues);
      clearGlobalAlert();
      const overlay = doc.getElementById('competitionCountdown');
      if (overlay) overlay.remove();
    }

    function beginRound() {
      clearCountdown();
      state.roundActive = true;
      state.roundRecorded = false;
      const summary = doc.getElementById('competitionSummary');
      if (summary) summary.classList.add('hidden');
      state.originalStart.call(state.startButton);
      const stats = readStats();
      state.session.begin(stats);
      state.feedbackSnapshot = stats;
      state.garbageRows = {
        P1: readGarbageRows('P1'),
        P2: readGarbageRows('P2'),
      };
    }

    function beginCountdown() {
      if (!state.ready || state.countdownTimers.length || !multiplayerSelected()) return;
      if (state.roundActive) {
        win.dispatchEvent(new win.KeyboardEvent('keydown', {
          key: 'r',
          code: 'KeyR',
          bubbles: true,
          cancelable: true,
        }));
      }
      clearFeedbackQueues(state.feedbackQueues);
      clearGlobalAlert();
      state.roundActive = false;
      state.roundRecorded = false;
      const token = ++state.countdownToken;
      const overlay = element('div', 'competition-countdown');
      overlay.id = 'competitionCountdown';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'assertive');
      overlay.innerHTML = '<small>雙人對戰準備</small><strong>3</strong>';
      doc.body.appendChild(overlay);
      const label = overlay.querySelector('strong');
      const steps = [
        [900, '2'],
        [1800, '1'],
        [2700, 'GO!'],
      ];
      steps.forEach(([delay, text]) => {
        state.countdownTimers.push(win.setTimeout(() => {
          if (token !== state.countdownToken) return;
          label.textContent = text;
          overlay.classList.remove('pulse');
          void overlay.offsetWidth;
          overlay.classList.add('pulse');
        }, delay));
      });
      state.countdownTimers.push(win.setTimeout(() => {
        if (token === state.countdownToken) beginRound();
      }, 3300));
    }

    function setup() {
      createCompetitionUI();
      renderRecords();
      state.startButton = doc.getElementById('newGame');
      state.originalStart = state.startButton.onclick;
      state.startButton.onclick = function (event) {
        if (!multiplayerSelected()) return state.originalStart.call(this, event);
        beginCountdown();
        return false;
      };

      const modeButton = doc.getElementById('modeButton');
      const originalModeSwitch = modeButton.onclick;
      modeButton.onclick = function (event) {
        clearCountdown();
        state.roundActive = false;
        const result = originalModeSwitch.call(this, event);
        queueSync();
        return result;
      };

      const observed = [
        'p1Sent', 'p2Sent', 'p1Ko', 'p2Ko', 'p1Combo', 'p2Combo',
        'p1Pending', 'p2Pending', 'message',
      ].map((id) => doc.getElementById(id));
      const observer = new MutationObserver(queueSync);
      observed.forEach((node) => observer.observe(node, { childList: true, characterData: true, subtree: true }));
      state.ready = true;
    }

    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', setup, { once: true });
    } else {
      setup();
    }
  }

  return {
    DEFAULT_RECORDS,
    PLAYER_BINDINGS,
    attachFeedbackRail,
    createBattleSession,
    createFeedbackQueue,
    clearFeedbackQueues,
    countCanvasGarbageRows,
    detectAppliedGarbage,
    formatBattleFeedback,
    createRecordStore,
    resolveStorage,
    mapBoardStats,
    accumulateRoundTotals,
    diffBattleStats,
    buildBattleSummary,
    install,
  };
}));
