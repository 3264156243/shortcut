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

  var lookupId = doc.getElementById('fbLookupId');
  var lookupToken = doc.getElementById('fbLookupToken');
  var lookupBtn = doc.getElementById('fbLookupBtn');
  var lookupStatus = doc.getElementById('fbLookupStatus');
  var repliesBox = doc.getElementById('fbReplies');

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function showReplies(data) {
    if (!repliesBox) return;
    var replies = data.replies || [];
    if (!replies.length) {
      repliesBox.innerHTML = '<div class="reply" style="margin-top:12px"><small>当前状态</small>暂时还没有管理员回复，请稍后再查。</div>';
      return;
    }
    repliesBox.innerHTML = replies.map(function (r) {
      return '<div class="reply" style="margin-top:12px"><small>' + esc(r.time) + ' · ' + esc(r.status) + '</small>' + esc(r.body) + '</div>';
    }).join('');
  }

  if (lookupBtn) {
    lookupBtn.addEventListener('click', function () {
      var id = (lookupId && lookupId.value || '').trim();
      var token = (lookupToken && lookupToken.value || '').trim();
      if (!/^[a-f0-9]{12}$/.test(id) || !/^[a-f0-9]{32}$/.test(token)) {
        if (lookupStatus) { lookupStatus.textContent = '请填写提交成功后得到的 12 位编号与 32 位查询凭据。'; lookupStatus.className = 'fb-status is-err'; }
        return;
      }
      if (lookupStatus) { lookupStatus.textContent = '查询中…'; lookupStatus.className = 'fb-status'; }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup', id: id, token: token })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (!res.ok) throw new Error(res.message || '没有找到这条反馈');
        if (lookupStatus) { lookupStatus.textContent = '查询成功'; lookupStatus.className = 'fb-status is-ok'; }
        showReplies(res);
      }).catch(function (err) {
        if (lookupStatus) { lookupStatus.textContent = err.message || '查询失败'; lookupStatus.className = 'fb-status is-err'; }
        if (repliesBox) repliesBox.innerHTML = '';
      });
    });
  }


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
          var successText = '已收到，编号 ' + (res.id || '—') + '。请保存查询凭据：' + (res.token || '—');
          setStatus(successText, 'ok');
          if (lookupId && res.id) lookupId.value = res.id;
          if (lookupToken && res.token) lookupToken.value = res.token;
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
