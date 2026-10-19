'use strict';
(function () {
  const screen = document.querySelector('#model-setup'), shell = document.querySelector('#app-shell');
  const title = document.querySelector('#setup-title'), phase = document.querySelector('#setup-phase');
  const progress = document.querySelector('#setup-progress'), percent = document.querySelector('#setup-percent');
  const amount = document.querySelector('#setup-amount'), detail = document.querySelector('#setup-detail'), retry = document.querySelector('#setup-retry');
  let worker;
  const state = window.ModelSetup = { complete: false, phase: 'checking', percent: null };
  const notify = () => window.dispatchEvent(new CustomEvent('model-setup-state', { detail: { ...state } }));
  function fail(message) {
    state.phase = 'error'; screen.setAttribute('aria-busy', 'false');
    title.textContent = '準備を完了できません'; phase.textContent = '接続・保存状態を確認してください';
    detail.textContent = message; detail.setAttribute('role', 'alert'); retry.hidden = false; retry.focus();
    worker?.terminate(); worker = null; notify();
  }
  function prepare() {
    worker?.terminate(); state.complete = false; state.phase = 'checking'; state.percent = null;
    shell.hidden = true; shell.inert = true; screen.hidden = false; screen.setAttribute('aria-busy', 'true');
    document.querySelector('#start').disabled = true;
    title.textContent = '音を迎える準備'; phase.textContent = '保存済みデータを確認しています';
    progress.removeAttribute('value'); percent.textContent = '確認中'; amount.textContent = '';
    detail.textContent = '初回は約23MBを取得して端末に保存します。準備が完了すると操作できます。';
    detail.removeAttribute('role'); retry.hidden = true; notify();
    if (!window.Worker) { fail('このブラウザはモデルの準備に対応していません。'); return; }
    const current = worker = new Worker(new URL('./model-setup-worker.js?v=2026.10.19.44', document.baseURI));
    worker.onerror = () => { if (worker === current) fail('準備を開始できませんでした。接続を確認して再試行してください。'); };
    worker.onmessage = ({ data }) => {
      if (worker !== current) return;
      if (data.type === 'error') { fail(data.message); return; }
      if (data.type === 'ready') {
        state.complete = true; state.phase = 'ready'; state.percent = 100;
        progress.value = 100; percent.textContent = '100%'; screen.setAttribute('aria-busy', 'false');
        worker.terminate(); worker = null; screen.hidden = true; shell.hidden = false; shell.inert = false;
        document.querySelector('#start').disabled = false; notify();
        window.dispatchEvent(new Event('resize')); return;
      }
      if (data.type !== 'progress') return;
      state.phase = data.phase; state.percent = data.percent;
      const labels = { checking: '保存済みデータを確認しています', downloading: 'ダウンロードしています', verifying: 'データの内容を確認しています', saving: '端末に保存しています' };
      phase.textContent = labels[data.phase] || '準備しています';
      if (data.percent === null) { progress.removeAttribute('value'); percent.textContent = '確認中'; }
      else { progress.value = data.percent; percent.textContent = `${data.percent.toFixed(1)}%`; }
      amount.textContent = data.total ? `${(data.loaded / 1000000).toFixed(1)} / ${(data.total / 1000000).toFixed(1)} MB` : '';
      if (data.label) detail.textContent = `${data.label} · 完了するまでお待ちください`;
      notify();
    };
    worker.postMessage({ type: 'prepare' });
  }
  retry.addEventListener('click', prepare);
  window.addEventListener('pagehide', () => { worker?.terminate(); worker = null; });
  window.addEventListener('pageshow', event => { if (event.persisted && !state.complete) prepare(); });
  prepare();
})();
