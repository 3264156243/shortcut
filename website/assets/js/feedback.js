/**
 * Public feedback board: structured submission, archive filters and replies.
 */
(function (global) {
  'use strict';

  var doc = document;
  var form = doc.getElementById('fbForm');
  if (!form) return;

  var isEN = (doc.documentElement.getAttribute('lang') || 'zh-CN').toLowerCase().indexOf('en') === 0;
  var ENDPOINT = '/sync/feedback.php';
  var requestSequence = 0;
  var searchTimer = 0;

  var TYPES = isEN ? {
    bug: 'Bug', feature: 'Feature', ui: 'Interface', update: 'Updates', other: 'Other'
  } : {
    bug: '问题故障', feature: '功能建议', ui: '界面体验', update: '安装更新', other: '其他'
  };

  var STATUSES = isEN ? {
    pending: 'Pending', confirmed: 'Confirmed', processing: 'In progress',
    needs_info: 'Needs info', resolved: 'Resolved', closed: 'Closed'
  } : {
    pending: '待处理', confirmed: '已确认', processing: '处理中',
    needs_info: '需要补充', resolved: '已解决', closed: '已关闭'
  };

  var L = isEN ? {
    titleShort: 'Write a title of at least 4 characters.',
    detailsShort: 'Add a little more detail so the message can be investigated.',
    submitting: 'Publishing...', submit: 'Publish message',
    success: 'Published. The message is now in the public archive.',
    failure: 'Could not publish the message. Please try again later.',
    network: 'Network error. Check your connection and try again.',
    loading: 'Loading messages...',
    count: function (count) { return count + ' public messages'; },
    noMatches: 'No messages match these filters.', noMessages: 'No public messages yet.',
    loadFailure: 'The archive could not be loaded. Please try again later.',
    reply: 'Administrator reply', noReply: 'Waiting for an administrator reply.',
    version: 'Version', unknownArea: 'Not specified', message: 'Message', timeUnknown: 'Date unavailable'
  } : {
    titleShort: '请写一个至少 4 个字的清楚标题。',
    detailsShort: '请再补充一些信息，方便定位问题。',
    submitting: '正在发布…', submit: '发布留言',
    success: '已发布，留言现在可以在下方公开记录中查看。',
    failure: '发布失败，请稍后再试。',
    network: '网络异常，请检查网络后再试。',
    loading: '正在读取留言…',
    count: function (count) { return '共 ' + count + ' 条公开留言'; },
    noMatches: '没有符合当前筛选条件的留言。', noMessages: '暂时还没有公开留言。',
    loadFailure: '留言档案读取失败，请稍后再试。',
    reply: '管理员回复', noReply: '等待管理员处理。',
    version: '版本', unknownArea: '未指定', message: '留言', timeUnknown: '时间未知'
  };

  function $(id) { return doc.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function setStatus(text, kind) {
    var node = $('fbStatus');
    if (!node) return;
    node.textContent = text || '';
    node.className = 'feedback-inline-status' + (kind ? ' is-' + kind : '');
  }
  function selectedType() {
    var checked = form.querySelector('input[name="fbType"]:checked');
    return checked ? checked.value : 'bug';
  }
  function formatTime(value) {
    if (!value) return L.timeUnknown;
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16);
    try {
      return new Intl.DateTimeFormat(isEN ? 'en-US' : 'zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      }).format(date);
    } catch (error) {
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0') + ' ' + String(date.getHours()).padStart(2, '0') + ':' +
        String(date.getMinutes()).padStart(2, '0');
    }
  }
  function statusLabel(value) { return STATUSES[value] || value || STATUSES.pending; }
  function typeLabel(value) { return TYPES[value] || value || TYPES.other; }

  var list = $('fbList');
  var listStatus = $('feedbackListStatus');
  var search = $('fbSearch');
  var statusFilter = $('fbStatusFilter');
  var typeFilter = $('fbTypeFilter');
  var sort = $('fbSort');

  function renderMessage(item, index, total) {
    var status = item.status || 'pending';
    var reply = item.reply && item.reply.body ? item.reply : null;
    var details = String(item.details || '').trim();
    var area = String(item.area || '').trim() || L.unknownArea;
    var version = String(item.version || '').trim();
    return '<article class="feedback-message" data-status="' + esc(status) + '">' +
      '<div class="feedback-message__rail" aria-hidden="true"><span>' + String(total - index).padStart(2, '0') + '</span></div>' +
      '<div class="feedback-message__content">' +
        '<header class="feedback-message__head">' +
          '<div class="feedback-message__identity">' +
            '<div class="feedback-message__meta">' +
              '<span class="feedback-type">' + esc(typeLabel(item.type)) + '</span>' +
              '<span>' + esc(area) + '</span>' +
              (version ? '<span>' + L.version + ' ' + esc(version) + '</span>' : '') +
              '<time datetime="' + esc(item.time || '') + '">' + esc(formatTime(item.time)) + '</time>' +
            '</div>' +
            '<h3>' + esc(item.title || L.message) + '</h3>' +
          '</div>' +
          '<span class="feedback-status feedback-status--' + esc(status) + '"><i></i>' + esc(statusLabel(status)) + '</span>' +
        '</header>' +
        '<p class="feedback-message__details">' + esc(details) + '</p>' +
        (reply
          ? '<section class="feedback-reply"><span class="feedback-reply__label">' + L.reply + '<time>' + esc(formatTime(reply.time)) + '</time></span><p>' + esc(reply.body) + '</p></section>'
          : '<p class="feedback-message__waiting"><i></i>' + L.noReply + '</p>') +
      '</div>' +
    '</article>';
  }

  function decorateIcons(root) {
    if (!global.SC || !global.SC.icon || !root) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-icon]'), function (node) {
      node.innerHTML = global.SC.icon(node.getAttribute('data-icon'), 20);
    });
  }

  function renderItems(items) {
    if (!list) return;
    if (!Array.isArray(items) || !items.length) {
      var query = search ? search.value.trim() : '';
      var filtered = query || (statusFilter && statusFilter.value !== 'all') || (typeFilter && typeFilter.value !== 'all');
      list.innerHTML = '<div class="feedback-message-empty"><span data-icon="inbox" aria-hidden="true"></span><h3>' +
        (filtered ? L.noMatches : L.noMessages) + '</h3></div>';
      decorateIcons(list);
      if (listStatus) listStatus.textContent = L.count(0);
      return;
    }
    list.innerHTML = items.map(function (item, index) { return renderMessage(item, index, items.length); }).join('');
    if (listStatus) listStatus.textContent = L.count(items.length);
  }

  function loadMessages() {
    if (!list) return;
    var sequence = ++requestSequence;
    if (listStatus) listStatus.textContent = L.loading;
    list.setAttribute('aria-busy', 'true');
    global.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        action: 'publicList',
        query: search ? search.value.trim() : '',
        status: statusFilter ? statusFilter.value : 'all',
        type: typeFilter ? typeFilter.value : 'all',
        sort: sort ? sort.value : 'latest'
      })
    }).then(function (response) {
      return response.json().catch(function () { return { ok: false, error: 'bad_response' }; });
    }).then(function (result) {
      if (sequence !== requestSequence) return;
      if (!result || !result.ok) throw new Error((result && result.error) || 'load_failed');
      renderItems(result.items || []);
    }).catch(function () {
      if (sequence !== requestSequence) return;
      if (listStatus) listStatus.textContent = L.loadFailure;
      list.innerHTML = '<div class="feedback-message-empty"><span data-icon="inbox" aria-hidden="true"></span><h3>' + L.loadFailure + '</h3></div>';
      decorateIcons(list);
    }).then(function () {
      if (sequence === requestSequence) list.removeAttribute('aria-busy');
    });
  }

  function scheduleLoad() {
    global.clearTimeout(searchTimer);
    searchTimer = global.setTimeout(loadMessages, 220);
  }

  if (search) search.addEventListener('input', scheduleLoad);
  [statusFilter, typeFilter, sort].forEach(function (node) {
    if (node) node.addEventListener('change', loadMessages);
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var titleField = $('fbTitle');
    var detailsField = $('fbDetails');
    var title = (titleField && titleField.value || '').trim();
    var details = (detailsField && detailsField.value || '').trim();
    var button = $('fbSubmit');

    if (title.length < 4) {
      setStatus(L.titleShort, 'error');
      if (titleField) titleField.focus();
      return;
    }
    if (details.length < 5) {
      setStatus(L.detailsShort, 'error');
      if (detailsField) detailsField.focus();
      return;
    }

    var payload = {
      type: selectedType(),
      title: title,
      area: ($('fbArea') && $('fbArea').value || '').trim(),
      details: details,
      contact: ($('fbContact') && $('fbContact').value || '').trim(),
      version: ($('fbVersion') && $('fbVersion').value || '').trim(),
      page: global.location.pathname,
      hp: ($('fbHp') && $('fbHp').value || '')
    };

    if (button) {
      button.disabled = true;
      button.textContent = L.submitting;
    }
    setStatus(L.submitting, 'loading');

    global.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().catch(function () { return { ok: false, error: 'bad_response' }; });
    }).then(function (result) {
      if (!result || !result.ok) throw new Error((result && (result.message || result.error)) || 'submit_failed');
      form.reset();
      var versionField = $('fbVersion');
      if (versionField && global._scFeedbackVersion) versionField.value = global._scFeedbackVersion;
      setStatus(L.success, 'success');
      if (search) search.value = '';
      if (statusFilter) statusFilter.value = 'all';
      if (typeFilter) typeFilter.value = 'all';
      if (sort) sort.value = 'latest';
      loadMessages();
      if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (error) {
      var network = error && /fetch|network/i.test(error.message || '');
      var technical = !error || !error.message || /bad_response|submit_failed/i.test(error.message);
      setStatus(network ? L.network : (technical ? L.failure : error.message), 'error');
    }).then(function () {
      if (button) {
        button.disabled = false;
        button.textContent = L.submit;
      }
    });
  });

  if (global.SC && global.SC.loadDesktopVersion) {
    global.SC.loadDesktopVersion().then(function (release) {
      var version = String(release && release.version || '').trim();
      global._scFeedbackVersion = version;
      var field = $('fbVersion');
      if (field && version && !field.value) field.value = version;
    }).catch(function () {});
  }

  loadMessages();
})(window);
