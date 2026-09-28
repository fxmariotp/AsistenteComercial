// ══════════════════════════════════════════════════════════════════════════════
// 📚 MÓDULO DE TARIFARIO & NORMATIVA UNIFICADA
// ══════════════════════════════════════════════════════════════════════════════

function switchTarifarioTab(tabName) {
  const tabs = ['pvp', 'proc', 'promo', 'enlaces'];
  tabs.forEach(t => {
    const btn = document.getElementById('btn-tab-tarifario-' + t);
    const pane = document.getElementById('tab-content-' + t);
    if (btn) {
      if (t === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    if (pane) {
      pane.style.display = (t === tabName) ? 'block' : 'none';
    }
  });

  // Re-run renderers if needed
  if (tabName === 'pvp') {
    if (typeof renderCondiciones === 'function') renderCondiciones();
    else if (typeof renderCond === 'function') renderCond();
  } else if (tabName === 'proc') {
    if (typeof renderProcedimientos === 'function') renderProcedimientos();
    else if (typeof renderProc === 'function') renderProc();
  } else if (tabName === 'promo') {
    if (typeof renderPromociones === 'function') renderPromociones();
  }
}

function filterTarifarioContent(query) {
  const q = (query || '').toLowerCase().trim();
  const activeTabContent = document.querySelector('.tarifario-tab-content[style*="display: block"]') || document.getElementById('tab-content-pvp');
  if (!activeTabContent) return;

  const searchableCards = activeTabContent.querySelectorAll('.cond-cia-block, .proc-cia-block, .promo-card, .enlace-card, .promo-rule-chip');
  searchableCards.forEach(card => {
    if (!q) {
      card.style.display = '';
      return;
    }
    const text = card.textContent.toLowerCase();
    if (text.includes(q)) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
}
