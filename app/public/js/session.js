(function () {
  const IDLE_MS = 60 * 60 * 1000; // 1 hora sem interação
  const KEY = 'gp_last_activity';

  function touch() {
    localStorage.setItem(KEY, Date.now().toString());
  }

  function isIdle() {
    const last = parseInt(localStorage.getItem(KEY) || '0', 10);
    return last > 0 && (Date.now() - last) > IDLE_MS;
  }

  let _initialized = false;

  window._sessionInit = function (onExpire) {
    if (_initialized) return;
    _initialized = true;

    touch();

    if (isIdle()) { onExpire(); return; }

    let lastWrite = 0;
    ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(function (ev) {
      document.addEventListener(ev, function () {
        const now = Date.now();
        if (now - lastWrite > 30000) { lastWrite = now; touch(); }
      }, { passive: true });
    });

    setInterval(function () { if (isIdle()) onExpire(); }, 60000);
  };

  window._sessionTouch = touch;
  window._sessionClear = function () { localStorage.removeItem(KEY); };
})();
