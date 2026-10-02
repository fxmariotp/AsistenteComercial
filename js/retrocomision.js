// ══════════════════════════════════════════════════════════════════════════════
// 🔍 MÓDULO DE COMPROBADOR DE RETROCOMISIONES POR COMPAÑÍA
// ══════════════════════════════════════════════════════════════════════════════

function calcRetrocomisionInfo(company, dateStr) {
  if (!dateStr) {
    return {
      hasDate: false,
      message: 'Selecciona la fecha del contrato anterior para comprobar el estado de retrocomisión.'
    };
  }

  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    return { error: 'Fecha no válida' };
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const contractDate = new Date(year, month, day);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffMs = today.getTime() - contractDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      isFuture: true,
      diffDays,
      message: '⚠️ La fecha introducida es futura. Por favor, selecciona la fecha de activación o contratación del cliente.'
    };
  }

  const formatDate = (d) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const addDays = (d, n) => {
    const res = new Date(d.getTime());
    res.setDate(res.getDate() + n);
    return res;
  };

  let retroPct = 0;
  let statusTier = ''; // 'danger' (100%), 'warning' (50%), 'success' (0% libre)
  let ruleTitle = '';
  let ruleDetails = '';
  let dateTo50 = null;
  let dateToFree = null;
  let daysTo50 = 0;
  let daysToFree = 0;
  let totalPeriodDays = 0;

  const comp = (company || 'iberdrola').toLowerCase();

  let companyNotice = '';

  if (comp === 'iberdrola' || comp === 'naturgy') {
    const compName = comp === 'iberdrola' ? 'Iberdrola' : 'Naturgy';
    totalPeriodDays = 121;
    ruleTitle = `Normativa ${compName}: 0-61 días (100% retro) · 62-121 días (50% retro) · Más de 121 días (Libre / 0%) · Mínimo 12 meses en compañía`;
    companyNotice = `⚠️ <strong>Aviso ${compName}:</strong> Deben de durar <strong>12 meses</strong> en la compañía aunque no tengan retrocomisión.`;
    
    dateTo50 = addDays(contractDate, 62);
    dateToFree = addDays(contractDate, 122);
    daysTo50 = 62 - diffDays;
    daysToFree = 122 - diffDays;

    if (diffDays <= 61) {
      retroPct = 100;
      statusTier = 'danger';
      ruleDetails = `El contrato tiene <strong>${diffDays} días</strong> de antigüedad (tramo 0-61 días). Si cambias el suministro ahora, aplica un <strong>100% de retrocomisión</strong>.`;
    } else if (diffDays <= 121) {
      retroPct = 50;
      statusTier = 'warning';
      ruleDetails = `El contrato tiene <strong>${diffDays} días</strong> de antigüedad (tramo 62-121 días). Si cambias el suministro ahora, aplica un <strong>50% de retrocomisión</strong>.`;
    } else {
      retroPct = 0;
      statusTier = 'success';
      ruleDetails = `El contrato tiene <strong>${diffDays} días</strong> de antigüedad (más de 121 días). ¡Está <strong>100% libre de retrocomisión</strong>! Puedes comisionar al 100% (recuerda que debe durar 12 meses en compañía).`;
    }
  } else if (comp === 'endesa') {
    const cut1 = new Date(2026, 4, 1); // 01/05/2026
    const cut2 = new Date(2026, 5, 1); // 01/06/2026

    if (contractDate < cut1) {
      totalPeriodDays = 61;
      ruleTitle = 'Normativa Endesa (Contratos anteriores al 01/05/2026): 61 días de retrocomisión (100%)';
      dateToFree = addDays(contractDate, 62);
      daysToFree = 62 - diffDays;

      if (diffDays <= 61) {
        retroPct = 100;
        statusTier = 'danger';
        ruleDetails = `Contrato firmado antes del 01/05/2026. Tiene <strong>${diffDays} días</strong> (de los 61 días requeridos). Aplica un <strong>100% de retrocomisión</strong>.`;
      } else {
        retroPct = 0;
        statusTier = 'success';
        ruleDetails = `Contrato firmado antes del 01/05/2026. Han transcurrido <strong>${diffDays} días</strong> (supera los 61 días). ¡Está <strong>100% libre de retrocomisión</strong>!`;
      }
    } else if (contractDate >= cut1 && contractDate <= cut2) {
      totalPeriodDays = 181;
      ruleTitle = 'Normativa Endesa (Contratos entre el 01/05/2026 y 01/06/2026): 181 días de retrocomisión (100%)';
      dateToFree = addDays(contractDate, 182);
      daysToFree = 182 - diffDays;

      if (diffDays <= 181) {
        retroPct = 100;
        statusTier = 'danger';
        ruleDetails = `Contrato firmado entre 01/05/2026 y 01/06/2026. Tiene <strong>${diffDays} días</strong> (de los 181 días requeridos). Aplica un <strong>100% de retrocomisión</strong>.`;
      } else {
        retroPct = 0;
        statusTier = 'success';
        ruleDetails = `Contrato firmado entre 01/05/2026 y 01/06/2026. Han transcurrido <strong>${diffDays} días</strong> (supera los 181 días). ¡Está <strong>100% libre de retrocomisión</strong>!`;
      }
    } else {
      totalPeriodDays = 365;
      ruleTitle = 'Normativa Endesa (Contratos a partir del 01/06/2026): 365 días de retrocomisión (100%)';
      dateToFree = addDays(contractDate, 366);
      daysToFree = 366 - diffDays;

      if (diffDays <= 365) {
        retroPct = 100;
        statusTier = 'danger';
        ruleDetails = `Contrato firmado a partir del 01/06/2026. Tiene <strong>${diffDays} días</strong> (de los 365 días requeridos). Aplica un <strong>100% de retrocomisión</strong>.`;
      } else {
        retroPct = 0;
        statusTier = 'success';
        ruleDetails = `Contrato firmado a partir del 01/06/2026. Han transcurrido <strong>${diffDays} días</strong> (supera los 365 días). ¡Está <strong>100% libre de retrocomisión</strong>!`;
      }
    }
  } else if (comp === 'gana') {
    const cutGana = new Date(2026, 2, 1); // 01/03/2026

    if (contractDate < cutGana) {
      totalPeriodDays = 181;
      ruleTitle = 'Normativa Gana Energía (Contratos anteriores al 01/03/2026): 181 días de retrocomisión (100%)';
      dateToFree = addDays(contractDate, 182);
      daysToFree = 182 - diffDays;

      if (diffDays <= 181) {
        retroPct = 100;
        statusTier = 'danger';
        ruleDetails = `Contrato firmado antes del 01/03/2026. Tiene <strong>${diffDays} días</strong> (de los 181 días requeridos). Aplica un <strong>100% de retrocomisión</strong>.`;
      } else {
        retroPct = 0;
        statusTier = 'success';
        ruleDetails = `Contrato firmado antes del 01/03/2026. Han transcurrido <strong>${diffDays} días</strong> (supera los 181 días). ¡Está <strong>100% libre de retrocomisión</strong>!`;
      }
    } else {
      totalPeriodDays = 365;
      ruleTitle = 'Normativa Gana Energía (Contratos a partir del 01/03/2026): 365 días de retrocomisión (100%)';
      dateToFree = addDays(contractDate, 366);
      daysToFree = 366 - diffDays;

      if (diffDays <= 365) {
        retroPct = 100;
        statusTier = 'danger';
        ruleDetails = `Contrato firmado a partir del 01/03/2026. Tiene <strong>${diffDays} días</strong> (de los 365 días requeridos). Aplica un <strong>100% de retrocomisión</strong>.`;
      } else {
        retroPct = 0;
        statusTier = 'success';
        ruleDetails = `Contrato firmado a partir del 01/03/2026. Han transcurrido <strong>${diffDays} días</strong> (supera los 365 días). ¡Está <strong>100% libre de retrocomisión</strong>!`;
      }
    }
  }

  return {
    hasDate: true,
    company: comp,
    diffDays,
    retroPct,
    statusTier,
    ruleTitle,
    ruleDetails,
    formattedContractDate: formatDate(contractDate),
    dateTo50: dateTo50 ? formatDate(dateTo50) : null,
    daysTo50: Math.max(0, daysTo50),
    dateToFree: dateToFree ? formatDate(dateToFree) : null,
    daysToFree: Math.max(0, daysToFree),
    totalPeriodDays,
    percentElapsed: totalPeriodDays > 0 ? Math.min(100, Math.round((diffDays / totalPeriodDays) * 100)) : 100,
    companyNotice
  };
}

function renderRetrocomisionCheck() {
  const elCia = document.getElementById('retro-cia');
  const elFecha = document.getElementById('retro-fecha');
  const elResult = document.getElementById('retro-resultado');

  if (!elResult) return;

  const cia = elCia ? elCia.value : 'iberdrola';
  const fecha = elFecha ? elFecha.value : '';

  if (!fecha) {
    elResult.innerHTML = `
      <div class="db-tool-result-card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <span class="db-tool-badge" style="background: rgba(53, 127, 191, 0.1); color: var(--blue); border: 1px solid rgba(53, 127, 191, 0.25);">
            <span>🔍</span>
            <span>ESTADO RETROCOMISIÓN</span>
          </span>
          <div style="font-size: 12px; color: var(--t3); font-weight: 600;">
            Sin fecha indicada
          </div>
        </div>
        <div class="db-tool-empty-box" style="margin-top: 6px;">
          <div class="db-tool-empty-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          </div>
          <div style="line-height:1.4;">
            <div style="font-weight:700;color:var(--text);font-size:12px;margin-bottom:2px;">Comprobador de penalización</div>
            <div style="color:var(--t3);font-size:11.5px;">Selecciona la fecha del contrato anterior o pulsa <strong>Pegar</strong> para comprobar los tramos y días libres.</div>
          </div>
        </div>
      </div>
    `;
    if (!permMesesManuallyEdited) {
      const elPermMeses = document.getElementById('perm-meses');
      if (elPermMeses && elPermMeses.value) {
        elPermMeses.value = '';
        calcPermanenciaBoe();
      }
    }
    return;
  }

  const info = calcRetrocomisionInfo(cia, fecha);

  if (info.isFuture) {
    elResult.innerHTML = `
      <div class="db-tool-result-card" style="border-color: rgba(220, 38, 38, 0.35);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <span class="db-tool-badge" style="background: #fee2e2; color: #dc2626; border: 1px solid rgba(220, 38, 38, 0.3);">
            <span>⚠️</span>
            <span>FECHA NO VÁLIDA</span>
          </span>
        </div>
        <div class="db-tool-empty-box" style="margin-top: 6px; background: rgba(254, 242, 242, 0.7); border-color: rgba(252, 165, 165, 0.8);">
          <div class="db-tool-empty-icon" style="background: rgba(220, 38, 38, 0.1); color: #dc2626;">⚠️</div>
          <div style="line-height:1.4; color: #991b1b; font-size: 12px;">
            ${info.message}
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Pre-rellenar meses restantes en calculadora de permanencia si no ha sido editado manualmente
  if (!permMesesManuallyEdited) {
    const elapsedMonths = Math.min(12, Math.floor(info.diffDays / 30.416));
    const remainingMonths = Math.max(0, 12 - elapsedMonths);
    const elPermMeses = document.getElementById('perm-meses');
    if (elPermMeses) {
      elPermMeses.value = remainingMonths;
      calcPermanenciaBoe();
    }
  }

  let badgeBg = '';
  let badgeColor = '';
  let badgeIcon = '';
  let badgeTitle = '';

  if (info.retroPct === 100) {
    badgeBg = '#fee2e2';
    badgeColor = '#dc2626';
    badgeIcon = '⛔';
    badgeTitle = '100% DE RETROCOMISIÓN';
  } else if (info.retroPct === 50) {
    badgeBg = '#fef3c7';
    badgeColor = '#d97706';
    badgeIcon = '⚠️';
    badgeTitle = '50% DE RETROCOMISIÓN';
  } else {
    badgeBg = '#d1fae5';
    badgeColor = '#059669';
    badgeIcon = '✅';
    badgeTitle = '¡LIBRE DE RETROCOMISIÓN! (0%)';
  }

  let nextStepHtml = '';
  if (info.retroPct === 100) {
    if (info.dateTo50 && info.daysTo50 > 0) {
      nextStepHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 12px;background:rgba(217,119,6,0.08);border:1px solid rgba(217,119,6,0.25);border-radius:8px;font-size:12px;color:#92400e;margin-top:6px;">
          <span>⏳ Baja al <strong>50% de retro</strong>:</span>
          <strong>${info.dateTo50} (en ${info.daysTo50} días)</strong>
        </div>
      `;
    }
    if (info.dateToFree && info.daysToFree > 0) {
      nextStepHtml += `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 12px;background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.25);border-radius:8px;font-size:12px;color:#065f46;margin-top:6px;">
          <span>🎉 Queda <strong>100% Libre (0% retro)</strong>:</span>
          <strong>${info.dateToFree} (en ${info.daysToFree} días)</strong>
        </div>
      `;
    }
  } else if (info.retroPct === 50) {
    if (info.dateToFree && info.daysToFree > 0) {
      nextStepHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 12px;background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.25);border-radius:8px;font-size:12px;color:#065f46;margin-top:6px;">
          <span>🎉 Queda <strong>100% Libre (0% retro)</strong>:</span>
          <strong>${info.dateToFree} (en ${info.daysToFree} días)</strong>
        </div>
      `;
    }
  } else {
    nextStepHtml = `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:8px;font-size:12px;color:#065f46;margin-top:6px;">
        <span>🚀 <strong>Puedes tramitar este contrato con tranquilidad:</strong> se comisionará íntegramente al no aplicar retrocomisión.</span>
      </div>
    `;
  }

  let noticeHtml = '';
  if (info.companyNotice) {
    noticeHtml = `
      <div style="display:flex;align-items:center;gap:9px;padding:8px 12px;background:rgba(217,119,6,0.1);border:1.5px solid rgba(217,119,6,0.35);border-radius:8px;font-size:12px;color:#92400e;margin-top:8px;">
        <span style="font-size:16px;flex-shrink:0;">⚠️</span>
        <div style="line-height:1.4;">${info.companyNotice}</div>
      </div>
    `;
  }

  elResult.innerHTML = `
    <div class="db-tool-result-card" style="border-color: ${badgeColor}44;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        <span class="db-tool-badge" style="background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}44;">
          <span>${badgeIcon}</span>
          <span>${badgeTitle}</span>
        </span>
        <div style="font-size: 12px; color: var(--t2); font-weight: 600;">
          Antigüedad: <strong style="color: var(--text); font-size: 13px;">${info.diffDays} días</strong> transcurridos
        </div>
      </div>

      <!-- Barra de progreso visual -->
      <div style="margin: 8px 0;">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:3px;">
          <span>Fecha Contrato: <strong>${info.formattedContractDate}</strong></span>
          <span>Periodo Normativo: <strong>${info.totalPeriodDays} días</strong></span>
        </div>
        <div style="width: 100%; height: 7px; background: rgba(0,0,0,0.06); border-radius: 5px; overflow: hidden; position: relative;">
          <div style="width: ${info.percentElapsed}%; height: 100%; background: ${badgeColor}; border-radius: 5px; transition: width 0.4s ease-out;"></div>
        </div>
      </div>

      <div style="font-size: 12px; color: var(--t2); line-height: 1.4; margin-top: 6px;">
        ${info.ruleDetails}
      </div>

      ${nextStepHtml}
      ${noticeHtml}

      <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(0,0,0,0.06); font-size: 11px; color: var(--t3);">
        📋 <em>${info.ruleTitle}</em>
      </div>
    </div>
  `;
}

function parsePastedDate(text) {
  if (!text) return null;
  const str = String(text).trim();

  // 1. DD/MM/YYYY o DD-MM-YYYY o DD.MM.YYYY
  const matchDMY = str.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/);
  if (matchDMY) {
    let day = parseInt(matchDMY[1], 10);
    let month = parseInt(matchDMY[2], 10);
    let year = parseInt(matchDMY[3], 10);
    if (year < 100) year += 2000;

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dd = String(day).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }

  // 2. YYYY-MM-DD o YYYY/MM/DD o YYYY.MM.DD
  const matchYMD = str.match(/\b(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})\b/);
  if (matchYMD) {
    let year = parseInt(matchYMD[1], 10);
    let month = parseInt(matchYMD[2], 10);
    let day = parseInt(matchYMD[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dd = String(day).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }

  return null;
}

function handlePastedRetroDate(text) {
  const parsed = parsePastedDate(text);
  const elFecha = document.getElementById('retro-fecha');
  if (parsed && elFecha) {
    elFecha.value = parsed;
    renderRetrocomisionCheck();
  } else {
    alert("No se ha detectado una fecha válida en el portapapeles.\nTexto recibido: " + (text ? `"${text.substring(0, 35)}"` : "(vacío)") + "\n\nFormato admitido: DD/MM/AAAA (ej. 01/05/2026)");
  }
}

function pasteDateToRetroInput() {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(text => {
      handlePastedRetroDate(text);
    }).catch(() => {
      const manual = prompt("Pega aquí la fecha (ej. 01/05/2026):");
      if (manual) handlePastedRetroDate(manual);
    });
  } else {
    const manual = prompt("Pega aquí la fecha (ej. 01/05/2026):");
    if (manual) handlePastedRetroDate(manual);
  }
}

function pasteCupsToRetroInput() {
  pasteDateToRetroInput();
}

// Vincular evento de pegado directo en el input retro-fecha si está en el DOM
document.addEventListener('DOMContentLoaded', () => {
  const elFecha = document.getElementById('retro-fecha');
  if (elFecha) {
    elFecha.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (text) handlePastedRetroDate(text);
    });
  }
  if (typeof renderRetrocomisionCheck === 'function') {
    renderRetrocomisionCheck();
  }
  if (typeof calcPermanenciaBoe === 'function') {
    calcPermanenciaBoe();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ⚖️ CALCULADORA DE PENALIZACIÓN POR PERMANENCIA (BOE - MÁX. 5%)
// ══════════════════════════════════════════════════════════════════════════════

let permMesesManuallyEdited = false;

function calcPermanenciaBoe() {
  const elMeses = document.getElementById('perm-meses');
  const elPrecio = document.getElementById('perm-precio');
  const elConsumo = document.getElementById('perm-consumo');
  const elDisplay = document.getElementById('perm-total-display');
  const elDetail = document.getElementById('perm-formula-detail');
  const elBadge = document.getElementById('perm-badge-status');
  const elCard = document.getElementById('perm-result-card');

  if (!elDisplay) return;

  const rawMeses = elMeses ? String(elMeses.value).replace(',', '.').trim() : '';
  const rawPrecio = elPrecio ? String(elPrecio.value).replace(',', '.').trim() : '';
  const rawConsumo = elConsumo ? String(elConsumo.value).replace(',', '.').trim() : '';

  const meses = rawMeses !== '' ? parseFloat(rawMeses) : 0;
  const precio = rawPrecio !== '' ? parseFloat(rawPrecio) : 0;
  const consumo = rawConsumo !== '' ? parseFloat(rawConsumo) : 0;

  const validMeses = (!isNaN(meses) && meses > 0) ? meses : 0;
  const validPrecio = (!isNaN(precio) && precio > 0) ? precio : 0;
  const validConsumo = (!isNaN(consumo) && consumo > 0) ? consumo : 0;

  // Fórmula oficial BOE: 5% (0.05) × meses restantes × precio del kW base × consumo medio mensual
  const penalizacion = 0.05 * validMeses * validPrecio * validConsumo;
  const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);

  if (validMeses > 0 && validPrecio > 0 && validConsumo > 0) {
    elDisplay.textContent = `${f2(penalizacion)} €`;
    elDisplay.style.color = '#dc2626';
    if (elBadge) {
      elBadge.style.background = '#fee2e2';
      elBadge.style.color = '#dc2626';
      elBadge.style.borderColor = 'rgba(220, 38, 38, 0.3)';
      elBadge.innerHTML = '<span>⚠️</span><span>PENALIZACIÓN MÁX. (5%)</span>';
    }
    if (elCard) {
      elCard.style.borderColor = 'rgba(220, 38, 38, 0.35)';
    }
    if (elDetail) {
      elDetail.style.display = 'block';
      elDetail.innerHTML = `
        <!-- Barra comparativa BOE -->
        <div style="margin: 8px 0;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t3);margin-bottom:3px;">
            <span>Límite Legal Sector Eléctrico</span>
            <span>Tope: <strong>5% del valor pendiente</strong></span>
          </div>
          <div style="width: 100%; height: 7px; background: rgba(0,0,0,0.06); border-radius: 5px; overflow: hidden; position: relative;">
            <div style="width: 100%; height: 100%; background: linear-gradient(90deg, #f59e0b, #dc2626); border-radius: 5px;"></div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:8px;padding:7px 11px;background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.22);border-radius:8px;font-size:12px;color:#991b1b;margin-top:6px;">
          <span>⚖️ <strong>Fórmula BOE:</strong> 0,05 × <strong>${validMeses} meses</strong> × <strong>${validPrecio.toFixed(4)} €/kWh</strong> × <strong>${validConsumo} kWh</strong> = <strong style="color:#b91c1c;font-size:13px;">${f2(penalizacion)} €</strong></span>
        </div>

        <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(0,0,0,0.06); font-size: 11px; color: var(--t3); line-height: 1.35;">
          📜 <em>*Según la Ley del Sector Eléctrico (BOE), la penalización máxima legal por rescisión anticipada en contratos domésticos es únicamente del 5% del valor estimado de la energía pendiente por consumir.</em>
        </div>
      `;
    }
  } else if (validMeses > 0 || validPrecio > 0 || validConsumo > 0) {
    elDisplay.textContent = '0,00 €';
    elDisplay.style.color = '#d97706';
    if (elBadge) {
      elBadge.style.background = 'rgba(217, 119, 6, 0.1)';
      elBadge.style.color = '#d97706';
      elBadge.style.borderColor = 'rgba(217, 119, 6, 0.25)';
      elBadge.innerHTML = '<span>⏳</span><span>PENDIENTE DE DATOS</span>';
    }
    if (elCard) {
      elCard.style.borderColor = 'rgba(217, 119, 6, 0.3)';
    }
    const missing = [];
    if (!validMeses) missing.push('meses restantes');
    if (!validPrecio) missing.push('precio kW base');
    if (!validConsumo) missing.push('consumo medio mensual');

    if (elDetail) {
      elDetail.style.display = 'block';
      elDetail.innerHTML = `
        <div class="db-tool-empty-box" style="margin-top: 6px;">
          <div class="db-tool-empty-icon" style="color: #d97706; background: rgba(217, 119, 6, 0.1);">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          </div>
          <div style="line-height:1.4;">
            <div style="font-weight:700;color:var(--text);font-size:12px;margin-bottom:2px;">Faltan datos para el cálculo</div>
            <div style="color:var(--t2);font-size:11.5px;">Completa <strong>${missing.join(', ')}</strong> para calcular la penalización máxima fijada por el BOE.</div>
          </div>
        </div>
      `;
    }
  } else {
    elDisplay.textContent = '0,00 €';
    elDisplay.style.color = 'var(--blue)';
    if (elBadge) {
      elBadge.style.background = 'rgba(53, 127, 191, 0.1)';
      elBadge.style.color = 'var(--blue)';
      elBadge.style.borderColor = 'rgba(53, 127, 191, 0.25)';
      elBadge.innerHTML = '<span>⚖️</span><span>PENALIZACIÓN MÁX. (5%)</span>';
    }
    if (elCard) {
      elCard.style.borderColor = 'rgba(226, 232, 240, 0.9)';
    }
    if (elDetail) {
      elDetail.style.display = 'block';
      elDetail.innerHTML = `
        <div class="db-tool-empty-box" style="margin-top: 6px;">
          <div class="db-tool-empty-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div style="line-height:1.4;">
            <div style="font-weight:700;color:var(--text);font-size:12px;margin-bottom:2px;">Calculadora de rescisión anticipada</div>
            <div style="color:var(--t3);font-size:11.5px;">Introduce meses restantes, precio kW y consumo medio para calcular el tope del 5% fijado por el BOE.</div>
          </div>
        </div>
      `;
    }
  }
}

function clearPermanenciaBoe() {
  const elMeses = document.getElementById('perm-meses');
  const elPrecio = document.getElementById('perm-precio');
  const elConsumo = document.getElementById('perm-consumo');
  if (elMeses) elMeses.value = '';
  if (elPrecio) elPrecio.value = '';
  if (elConsumo) elConsumo.value = '';
  permMesesManuallyEdited = false;
  calcPermanenciaBoe();
}

function clearRetrocomision() {
  const elFecha = document.getElementById('retro-fecha');
  if (elFecha) elFecha.value = '';
  renderRetrocomisionCheck();
}

// Exportar globalmente para eventos en HTML
window.renderRetrocomisionCheck = renderRetrocomisionCheck;
window.clearRetrocomision = clearRetrocomision;
window.calcPermanenciaBoe = calcPermanenciaBoe;
window.clearPermanenciaBoe = clearPermanenciaBoe;
window.pasteDateToRetroInput = pasteDateToRetroInput;


