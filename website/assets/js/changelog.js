/**
 * Release archive: live latest release, searchable history and category filters.
 */
(function (global) {
  'use strict';

  var doc = document;
  var ALL = Array.isArray(global.SC_CHANGELOG) ? global.SC_CHANGELOG : [];
  var isEN = (doc.documentElement.getAttribute('lang') || 'zh-CN').toLowerCase().indexOf('en') === 0;
  var L = isEN ? {
    current: 'Latest',
    changes: 'changes',
    versions: 'versions',
    all: 'All',
    new: 'Added',
    improve: 'Improved',
    fix: 'Fixed',
    noNotes: 'No detailed notes yet.',
    result: function (versions, items) { return versions + ' versions · ' + items + ' changes'; },
    queryResult: function (versions, items) { return versions + ' matching versions · ' + items + ' changes'; },
    collapse: 'Collapse all',
    expand: 'Expand all',
    genericNote: 'Detailed release notes are currently maintained in Chinese. Open the full history below.'
  } : {
    current: '最新',
    changes: '条变化',
    versions: '个版本',
    all: '全部',
    new: '新增',
    improve: '优化',
    fix: '修复',
    noNotes: '暂无详细说明。',
    result: function (versions, items) { return versions + ' 个版本 · ' + items + ' 条变化'; },
    queryResult: function (versions, items) { return '匹配到 ' + versions + ' 个版本 · ' + items + ' 条变化'; },
    collapse: '收起全部',
    expand: '展开全部',
    genericNote: '详细更新记录保留中文。'
  };

  var state = { query: '', filter: 'all' };
  var latestVersion = '';

  function $(id) { return doc.getElementById(id); }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function setText(id, text) { var node = $(id); if (node) node.textContent = text; }

  function publicText(value) {
    return String(value || '')
      .replace(/Tauri\s*2?/gi, '桌面端')
      .replace(/Electron/gi, '旧版桌面端')
      .replace(/API/gi, '服务')
      .replace(/JSONL/gi, '反馈记录')
      .replace(/SHA-256/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function categoryOf(item, groupTitle) {
    var text = String(item || '');
    var group = String(groupTitle || '');
    if (/^修复|^修正|^解决/.test(text) || /修复|问题|稳定性/.test(group)) return 'fix';
    if (/^新增|^全新|^加入/.test(text) || /新增|新板块|首个|全新/.test(group)) return 'new';
    return 'improve';
  }

  function categoryLabel(category) {
    if (category === 'new') return L.new;
    if (category === 'fix') return L.fix;
    return L.improve;
  }

  var RELEASES = ALL.map(function (release) {
    var groups = (release.groups || []).map(function (group) {
      return {
        title: group.title || '',
        items: (group.items || []).map(function (text) {
          var clean = publicText(text);
          return { text: clean, category: categoryOf(clean, group.title), search: clean.toLowerCase() };
        })
      };
    }).filter(function (group) { return group.items.length; });
    var items = groups.reduce(function (acc, group) { return acc.concat(group.items); }, []);
    return {
      version: String(release.version || ''),
      date: String(release.date || ''),
      groups: groups,
      items: items,
      search: ('v' + release.version + ' ' + release.date + ' ' + items.map(function (item) { return item.text; }).join(' ')).toLowerCase()
    };
  }).filter(function (release) { return release.version && release.items.length; });

  function normalizedQuery() {
    return state.query.trim().toLowerCase().replace(/^v/, '');
  }

  function matchesQuery(release, item) {
    var query = normalizedQuery();
    if (!query) return true;
    if (release.version.toLowerCase().indexOf(query) !== -1 || release.date.indexOf(query) !== -1) return true;
    return item.search.indexOf(query) !== -1;
  }

  function filteredRelease(release) {
    var query = normalizedQuery();
    var versionMatches = !query || release.version.toLowerCase().indexOf(query) !== -1 || release.date.indexOf(query) !== -1;
    var groups = release.groups.map(function (group) {
      return {
        title: group.title,
        items: group.items.filter(function (item) {
          return (state.filter === 'all' || item.category === state.filter) && (versionMatches || matchesQuery(release, item));
        })
      };
    }).filter(function (group) { return group.items.length; });
    return {
      index: RELEASES.indexOf(release) + 1,
      version: release.version,
      date: release.date,
      groups: groups,
      count: groups.reduce(function (count, group) { return count + group.items.length; }, 0)
    };
  }

  function visibleReleases() {
    return RELEASES.map(filteredRelease).filter(function (release) { return release.count > 0; });
  }

  function setLatestNotes(notes) {
    var list = $('latestNotes');
    if (!list) return;
    list.innerHTML = notes.slice(0, 5).map(function (note) { return '<li>' + esc(note) + '</li>'; }).join('');
  }

  global.SC.loadDesktopVersion().then(function (release) {
    latestVersion = String(release.version || '');
    setText('latestVersion', latestVersion ? 'v' + latestVersion : '—');
    setText('latestDate', release.pubDate || '—');
    setText('latestSize', release.size ? global.SC.formatSize(release.size) : '—');
    var notes = String(release.notes || '').split(/\r?\n/).map(function (line) {
      return publicText(line.replace(/^[#*\-\s]+/, ''));
    }).filter(function (line) { return line.length > 2; });
    if (!notes.length) {
      var first = RELEASES[0];
      notes = first ? first.items.slice(0, 4).map(function (item) { return item.text; }) : [L.noNotes];
    }
    setLatestNotes(isEN ? [L.genericNote].concat(notes.slice(0, 4)) : notes);
    var download = $('latestDownload');
    if (download && release.url) download.href = release.url;
  }).catch(function () {
    setText('latestVersion', RELEASES[0] ? 'v' + RELEASES[0].version : '—');
    if (RELEASES[0]) setLatestNotes(RELEASES[0].items.slice(0, 4).map(function (item) { return item.text; }));
  });

  var totals = { all: 0, new: 0, improve: 0, fix: 0 };
  RELEASES.forEach(function (release) {
    release.items.forEach(function (item) { totals.all++; totals[item.category]++; });
  });
  setText('releaseVersionCount', RELEASES.length);
  setText('releaseChangeCount', totals.all);
  Object.keys(totals).forEach(function (key) {
    var node = doc.querySelector('[data-filter-count="' + key + '"]');
    if (node) node.textContent = totals[key];
  });

  var index = $('versionIndex');
  if (index) {
    var lastIndexYear = '';
    index.innerHTML = RELEASES.map(function (release, i) {
      var year = String(release.date || '').slice(0, 4) || '—';
      var yearHeading = year === lastIndexYear ? '' : '<div class="release-jump__year">' + esc(year) + '</div>';
      lastIndexYear = year;
      return yearHeading + '<a href="#v' + release.version.replace(/\./g, '-') + '"' + (i === 0 ? ' class="is-current"' : '') + '>' +
        '<span>v' + esc(release.version) + '</span><small>' + esc(release.date) + '</small></a>';
    }).join('');
  }

  var timeline = $('timeline');
  var empty = $('releaseEmpty');
  var resultCount = $('releaseResultCount');
  var searchInput = $('releaseSearch');
  var filterBar = $('releaseFilters');
  var expandButton = $('expandAll');

  function itemsSummary(release) {
    return release.groups.reduce(function (all, group) { return all.concat(group.items); }, [])
      .slice(0, 2)
      .map(function (item) { return item.text; })
      .join(isEN ? ' · ' : '；');
  }

  function renderFeed() {
    if (!timeline) return;
    var releases = visibleReleases();
    var itemCount = releases.reduce(function (sum, release) { return sum + release.count; }, 0);
    var filtered = Boolean(normalizedQuery() || state.filter !== 'all');
    var yearTotals = releases.reduce(function (totals, release) {
      var year = String(release.date || '').slice(0, 4) || '—';
      totals[year] = (totals[year] || 0) + 1;
      return totals;
    }, {});
    var lastYear = '';

    timeline.innerHTML = releases.map(function (release) {
      var isLatest = latestVersion ? release.version === latestVersion : release.index === 1;
      var year = String(release.date || '').slice(0, 4) || '—';
      var yearBand = year === lastYear ? '' :
        '<div class="release-year-band"><span>' + esc(year) + '</span><small>' + yearTotals[year] + ' ' + L.versions + '</small></div>';
      lastYear = year;
      var groups = release.groups.map(function (group) {
        return '<section class="release-group">' +
          (group.title ? '<h4>' + esc(publicText(group.title)) + '</h4>' : '') +
          '<ul>' + group.items.map(function (item) {
            return '<li class="release-change" data-kind="' + item.category + '">' +
              '<span class="release-change__kind">' + esc(categoryLabel(item.category)) + '</span>' +
              '<p>' + esc(item.text) + '</p>' +
            '</li>';
          }).join('') + '</ul>' +
        '</section>';
      }).join('');

      return yearBand + '<details class="release-record' + (isLatest ? ' is-latest' : '') + '" id="v' + esc(release.version.replace(/\./g, '-')) + '"' +
        ((isLatest || filtered) ? ' open' : '') + '>' +
        '<summary class="release-record__summary">' +
          '<span class="release-record__serial">' + String(release.index).padStart(2, '0') + '</span>' +
          '<span class="release-record__identity">' +
            '<span class="release-record__heading"><b>v' + esc(release.version) + '</b>' +
              (isLatest ? '<em>' + L.current + '</em>' : '') +
              '<time>' + esc(release.date) + '</time>' +
            '</span>' +
            '<span class="release-record__lead">' + esc(itemsSummary(release)) + '</span>' +
          '</span>' +
          '<span class="release-record__count"><b>' + release.count + '</b> ' + L.changes + '</span>' +
          '<span class="release-record__chevron" aria-hidden="true"></span>' +
        '</summary>' +
        '<div class="release-record__body">' + groups + '</div>' +
      '</details>';
    }).join('');

    if (resultCount) resultCount.textContent = filtered ? L.queryResult(releases.length, itemCount) : L.result(releases.length, itemCount);
    if (empty) empty.hidden = releases.length > 0;
    syncExpand();
  }

  function syncExpand() {
    if (!timeline || !expandButton) return;
    var details = timeline.querySelectorAll('details');
    var allOpen = details.length > 0 && Array.prototype.every.call(details, function (node) { return node.open; });
    expandButton.textContent = allOpen ? L.collapse : L.expand;
    expandButton.setAttribute('data-all-open', allOpen ? '1' : '0');
  }

  if (filterBar) {
    filterBar.addEventListener('click', function (event) {
      var button = event.target.closest('[data-release-filter]');
      if (!button) return;
      state.filter = button.getAttribute('data-release-filter') || 'all';
      Array.prototype.forEach.call(filterBar.querySelectorAll('[data-release-filter]'), function (item) {
        var active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderFeed();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.query = searchInput.value || '';
      renderFeed();
    });
  }

  var reset = $('releaseReset');
  if (reset) {
    reset.addEventListener('click', function () {
      state.query = '';
      state.filter = 'all';
      if (searchInput) searchInput.value = '';
      if (filterBar) {
        Array.prototype.forEach.call(filterBar.querySelectorAll('[data-release-filter]'), function (button) {
          var active = button.getAttribute('data-release-filter') === 'all';
          button.classList.toggle('is-active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }
      renderFeed();
      if (searchInput) searchInput.focus();
    });
  }

  if (expandButton) {
    expandButton.addEventListener('click', function () {
      var open = expandButton.getAttribute('data-all-open') === '1';
      Array.prototype.forEach.call(timeline.querySelectorAll('details'), function (node) { node.open = !open; });
      syncExpand();
    });
  }

  if (timeline) timeline.addEventListener('toggle', syncExpand, true);

  function scrollToRelease(version) {
    var target = doc.getElementById('v' + String(version).replace(/\./g, '-'));
    if (!target) return;
    target.open = true;
    var navHeight = parseInt(getComputedStyle(doc.documentElement).getPropertyValue('--nav-h'), 10) || 74;
    var y = target.getBoundingClientRect().top + global.pageYOffset - navHeight - 22;
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    global.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }

  if (index) {
    index.addEventListener('click', function (event) {
      var link = event.target.closest('a[href^="#"]');
      if (!link) return;
      event.preventDefault();
      var version = link.hash.slice(2).replace(/-/g, '.');
      if (!doc.getElementById('v' + link.hash.slice(2))) {
        state.query = '';
        state.filter = 'all';
        if (searchInput) searchInput.value = '';
        renderFeed();
      }
      scrollToRelease(version);
      if (global.history && history.replaceState) history.replaceState(null, '', '#' + version);
    });
  }

  doc.addEventListener('keydown', function (event) {
    var tag = (event.target.tagName || '').toLowerCase();
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && ['input', 'textarea', 'select'].indexOf(tag) === -1 && !event.target.isContentEditable) {
      event.preventDefault();
      if (searchInput) searchInput.focus();
    }
  });

  renderFeed();
  if (location.hash && /^#v\d+-\d+-\d+$/.test(location.hash)) {
    setTimeout(function () { scrollToRelease(location.hash.slice(2).replace(/-/g, '.')); }, 80);
  }
})(window);
