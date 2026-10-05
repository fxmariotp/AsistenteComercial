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
  const elBadge = document.getElementById('retro-badge-status');

  if (!elResult) return;

  const cia = elCia ? elCia.value : 'iberdrola';
  const fecha = elFecha ? elFecha.value : '';

  if (!fecha) {
    elResult.innerHTML = '';
    elResult.style.display = 'none';
    if (elBadge) {
      elBadge.style.display = 'none';
      elBadge.innerHTML = '';
    }
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
    if (elBadge) {
      elBadge.style.display = 'inline-flex';
      elBadge.style.background = '#fee2e2';
      elBadge.style.color = '#dc2626';
      elBadge.style.borderColor = 'rgba(220, 38, 38, 0.3)';
      elBadge.innerHTML = '<span>⚠️</span><span>FECHA FUTURA</span>';
    }
    elResult.style.display = 'block';
    elResult.innerHTML = `
      <div style="background: rgba(254, 242, 242, 0.85); border: 1px solid rgba(252, 165, 165, 0.8); border-radius: 8px; padding: 6px 12px; color: #b91c1c; font-size: 11.5px; display: flex; align-items: center; gap: 8px; margin-top: 6px;">
        <span style="font-size: 14px;">⚠️</span>
        <div>${info.message}</div>
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
    badgeTitle = '100% RETRO';
  } else if (info.retroPct === 50) {
    badgeBg = '#fef3c7';
    badgeColor = '#d97706';
    badgeIcon = '⚠️';
    badgeTitle = '50% RETRO';
  } else {
    badgeBg = '#d1fae5';
    badgeColor = '#059669';
    badgeIcon = '✅';
    badgeTitle = '0% (¡LIBRE!)';
  }

  if (elBadge) {
    elBadge.style.display = 'inline-flex';
    elBadge.style.background = badgeBg;
    elBadge.style.color = badgeColor;
    elBadge.style.borderColor = badgeColor + '44';
    elBadge.innerHTML = `<span>${badgeIcon}</span><span>${badgeTitle}</span>`;
  }

  let nextStepHtml = '';
  if (info.retroPct === 100) {
    if (info.dateTo50 && info.daysTo50 > 0) {
      nextStepHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;background:rgba(217,119,6,0.07);border:1px solid rgba(217,119,6,0.2);border-radius:6px;font-size:11.5px;color:#92400e;">
          <span>⏳ Baja al <strong>50% de retro</strong>:</span>
          <strong>${info.dateTo50} (en ${info.daysTo50} d.)</strong>
        </div>
      `;
    }
    if (info.dateToFree && info.daysToFree > 0) {
      nextStepHtml += `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;background:rgba(5,150,105,0.07);border:1px solid rgba(5,150,105,0.2);border-radius:6px;font-size:11.5px;color:#065f46;margin-top:4px;">
          <span>🎉 Queda <strong>100% Libre</strong>:</span>
          <strong>${info.dateToFree} (en ${info.daysToFree} d.)</strong>
        </div>
      `;
    }
  } else if (info.retroPct === 50) {
    if (info.dateToFree && info.daysToFree > 0) {
      nextStepHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 9px;background:rgba(5,150,105,0.07);border:1px solid rgba(5,150,105,0.2);border-radius:5px;font-size:11px;color:#065f46;">
          <span>🎉 Queda <strong>100% Libre</strong>:</span>
          <strong>${info.dateToFree} (en ${info.daysToFree} d.)</strong>
        </div>
      `;
    }
  } else {
    nextStepHtml = `
      <div style="display:flex;align-items:center;gap:6px;padding:3px 9px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:5px;font-size:11px;color:#065f46;">
        <span>🚀 <strong>Sin penalización:</strong> comisionable íntegramente (0% retro).</span>
      </div>
    `;
  }

  let noticeHtml = '';
  if (info.companyNotice) {
    noticeHtml = `
      <div style="display:flex;align-items:center;gap:5px;padding:3px 9px;background:rgba(217,119,6,0.08);border:1px solid rgba(217,119,6,0.25);border-radius:5px;font-size:10.5px;color:#92400e;margin-top:3px;line-height:1.3;">
        <span>⚠️</span>
        <div>${info.companyNotice}</div>
      </div>
    `;
  }

  elResult.style.display = 'block';
  elResult.innerHTML = `
    <div style="margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(226, 232, 240, 0.8); animation: fadeIn 0.2s ease-out; max-width: 820px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px;font-size:10.5px;color:var(--t3);">
        <span>Antigüedad: <strong style="color:var(--text);">${info.diffDays} días</strong> transcurridos</span>
        <span>Periodo normativo: <strong>${info.totalPeriodDays} días</strong></span>
      </div>

      <div style="width: 100%; height: 4px; background: rgba(0,0,0,0.06); border-radius: 4px; overflow: hidden; margin-bottom: 4px;">
        <div style="width: ${info.percentElapsed}%; height: 100%; background: ${badgeColor}; border-radius: 4px; transition: width 0.4s ease-out;"></div>
      </div>

      <div style="font-size: 11px; color: var(--t2); line-height: 1.35; margin-bottom: 3px;">
        ${info.ruleDetails}
      </div>

      ${nextStepHtml}
      ${noticeHtml}

      <div style="margin-top: 3px; font-size: 10px; color: var(--t3);">
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

  if (!elDisplay || !elDetail) return;

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
    elDetail.style.display = 'block';
    elDetail.innerHTML = `
      <div style="margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(226, 232, 240, 0.8); animation: fadeIn 0.2s ease-out; max-width: 820px;">
        <div style="display:inline-flex;align-items:center;gap:7px;padding:3px 9px;background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.2);border-radius:5px;font-size:11px;color:#991b1b;">
          <span>⚖️ <strong>Fórmula BOE (5% máx.):</strong> 0,05 × <strong>${validMeses} meses</strong> × <strong>${validPrecio.toFixed(4)} €/kWh</strong> × <strong>${validConsumo} kWh</strong> = <strong style="color:#b91c1c;font-size:12px;">${f2(penalizacion)} €</strong></span>
        </div>
        <div style="margin-top: 3px; font-size: 10px; color: var(--t3); line-height: 1.3;">
          📜 <em>*Tope fijado por la Ley del Sector Eléctrico (BOE) para rescisión anticipada (máx. 5% de la energía estimada pendiente).</em>
        </div>
      </div>
    `;
  } else if (validMeses > 0 || validPrecio > 0 || validConsumo > 0) {
    elDisplay.textContent = '0,00 €';
    elDisplay.style.color = '#d97706';
    const missing = [];
    if (!validMeses) missing.push('meses');
    if (!validPrecio) missing.push('precio kW');
    if (!validConsumo) missing.push('consumo');
    elDetail.style.display = 'block';
    elDetail.innerHTML = `
      <div style="margin-top: 5px; padding: 3px 8px; background: rgba(217, 119, 6, 0.07); border: 1px solid rgba(217, 119, 6, 0.2); border-radius: 5px; font-size: 10.5px; color: #92400e; display: inline-flex; align-items: center; gap: 5px; max-width: 820px;">
        <span>ℹ️</span>
        <span>Completa <strong>${missing.join(', ')}</strong> para calcular la penalización máxima legal del 5% fijada por el BOE.</span>
      </div>
    `;
  } else {
    elDisplay.textContent = '0,00 €';
    elDisplay.style.color = 'var(--blue)';
    elDetail.style.display = 'none';
    elDetail.innerHTML = '';
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


