(function () {
  'use strict';
  var groups = SC.getData().FAQ || [];
  var en = document.documentElement.lang === 'en';
  var toc = document.getElementById('faqToc'), host = document.getElementById('faqGroups');
  var input = document.getElementById('faqSearch'), result = document.getElementById('faqResult');
  if (!host) return;
  function esc(s) { return String(s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function render() {
    var q = input ? input.value.trim().toLocaleLowerCase() : '';
    var count = 0, links = [];
    host.innerHTML = groups.map(function (g, i) {
      var items = g.items.filter(function (it) { return (it.q + ' ' + it.a).toLocaleLowerCase().includes(q); });
      count += items.length;
      if (!items.length) return '';
      links.push('<a href="#faq-' + i + '">' + esc(g.group) + '</a>');
      return '<section class="faq-group" id="faq-' + i + '"><h3>' + esc(g.group) + '</h3>' + items.map(function (it) {
        return '<details class="faq"' + (q ? ' open' : '') + '><summary>' + esc(it.q) + '</summary><div class="faq__body"><p>' + esc(it.a) + '</p></div></details>';
      }).join('') + '</section>';
    }).join('');
    if (toc) toc.innerHTML = links.join('');
    if (!count) host.innerHTML = '<div class="faq-empty">' + (en ? 'No matching answers. Try another word or leave feedback.' : '没有找到匹配的问题。换一个关键词，或到反馈页告诉我们。') + '</div>';
    if (result) result.textContent = q ? (en ? count + ' matching questions' : '找到 ' + count + ' 个相关问题') : '';
  }
  if (input) input.addEventListener('input', render);
  render();
})();
