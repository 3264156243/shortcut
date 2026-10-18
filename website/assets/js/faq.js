/**
 * FAQ 页逻辑
 * ---------------------------------------------------------------------------
 * 数据来自 data.js 的 FAQ（按分组），单一真源：
 *   - 左侧目录按分组生成锚点
 *   - 右侧用原生 <details>，无 JS 也能展开
 */
(function (global) {
  'use strict';

  var D = global.SC_DATA || {};
  var doc = document;

  var groups = D.FAQ || [];
  if (!groups.length) return;

  var toc = doc.getElementById('faqToc');
  var host = doc.getElementById('faqGroups');

  function slug(s, i) { return 'faq-' + i; }

  if (toc) {
    toc.innerHTML = groups.map(function (g, i) {
      return '<a href="#' + slug(g.group, i) + '">' + g.group + '</a>';
    }).join('');
  }

  if (host) {
    host.innerHTML = groups.map(function (g, i) {
      var items = (g.items || []).map(function (it) {
        return '<details class="faq">' +
          '<summary>' + it.q + '</summary>' +
          '<div class="faq__body"><p>' + it.a + '</p></div>' +
        '</details>';
      }).join('');
      return '<div class="faq-group reveal" id="' + slug(g.group, i) + '">' +
        '<h3>' + g.group + '</h3>' + items +
      '</div>';
    }).join('');

    if ('IntersectionObserver' in global) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.03 });
      Array.prototype.forEach.call(host.querySelectorAll('.reveal'), function (n) { io.observe(n); });
    } else {
      Array.prototype.forEach.call(host.querySelectorAll('.reveal'), function (n) { n.classList.add('is-in'); });
    }
  }
})(window);
