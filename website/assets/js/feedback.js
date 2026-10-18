/**
 * 问题反馈页
 * ---------------------------------------------------------------------------
 * 提交到 /sync/feedback.php（自建服务端，JSONL 追加存储）
 *   要点：
 *     - 前端只做"必填 + 长度"的即时校验，服务端才是权威
 *     - 带蜜罐字段 hp（人类不可见），被填即视为机器人
 *     - 自动带上当前站点版本与来源页面，便于定位
 *     - 提交中禁用按钮，避免重复提交；成功后清空内容并提示编号
 */
(function (global) {
  'use strict';

  var doc = document;
  var form = doc.getElementById('fbForm');
  if (!form) return;

  var elType = doc.getElementById('fbType');
  var elContent = doc.getElementById('fbContent');
  var elContact = doc.getElementById('fbContact');
  var elVersion = doc.getElementById('fbVersion');
  var elHp = doc.getElementById('fbHp');
  var elCount = doc.getElementById('fbCount');
  var elStatus = doc.getElementById('fbStatus');
  var elSubmit = doc.getElementById('fbSubmit');

  var ENDPOINT = '/sync/feedback.php';

  /* ── 字数统计 ── */
  function updateCount() {
    if (elCount && elContent) elCount.textContent = elContent.value.length;
  }
  elContent.addEventListener('input', updateCount);
  updateCount();

  /* ── 自动填入当前版本 ── */
  if (global.SC && global.SC.loadDesktopVersion) {
    global.SC.loadDesktopVersion().then(function (v) {
      if (elVersion && v && v.version && !elVersion.value) elVersion.value = v.version;
    });
  }

  /* ── 状态提示 ── */
  function setStatus(text, kind) {
    if (!elStatus) return;
    elStatus.textContent = text || '';
    elStatus.className = 'fb-status' + (kind ? ' is-' + kind : '');
  }

  function setBusy(busy) {
    if (!elSubmit) return;
    elSubmit.disabled = busy;
    elSubmit.textContent = busy ? '提交中…' : '提交反馈';
  }

  /* ── 提交 ── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var content = (elContent.value || '').trim();
    if (content.length < 5) {
      setStatus('内容太短了，请至少写 5 个字。', 'err');
      elContent.focus();
      return;
    }
    if (content.length > 4000) {
      setStatus('内容过长，请控制在 4000 字以内。', 'err');
      return;
    }

    var payload = {
      type: elType ? elType.value : 'other',
      content: content,
      contact: elContact ? elContact.value.trim() : '',
      version: elVersion ? elVersion.value.trim() : '',
      page: location.pathname,
      hp: elHp ? elHp.value : ''
    };

    setBusy(true);
    setStatus('正在提交…', null);

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, error: 'bad_response' }; });
      })
      .then(function (res) {
        if (res && res.ok) {
          setStatus('已收到，编号 ' + (res.id || '—') + '。感谢反馈！', 'ok');
          elContent.value = '';
          updateCount();
          if (elContact) elContact.value = '';
        } else {
          setStatus((res && res.message) || '提交失败，请稍后再试。', 'err');
        }
      })
      .catch(function () {
        setStatus('网络异常，提交失败。请检查网络后再试。', 'err');
      })
      .then(function () {
        setBusy(false);
      });
  });
})(window);
