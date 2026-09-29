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
    elResult.innerHTML = '';
    return;
  }

  const info = calcRetrocomisionInfo(cia, fecha);

  if (info.isFuture) {
    elResult.innerHTML = `
      <div style="background: #fef2f2; border: 1.5px solid #fca5a5; border-radius: var(--rs); padding: 9px 14px; color: #b91c1c; font-size: 12.5px; display: flex; align-items: center; gap: 8px; margin-top: 8px;">
        <span style="font-size: 18px;">⚠️</span>
        <div>${info.message}</div>
      </div>
    `;
    return;
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
    <div style="background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); border: 1.5px solid ${badgeColor}55; border-radius: 12px; padding: 12px 16px; box-shadow: 0 3px 12px rgba(0,0,0,0.03); margin-top: 10px; animation: fadeIn 0.25s ease-out;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        <span style="font-size: 12.5px; font-weight: 800; padding: 3px 9px; border-radius: 6px; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeColor}44; display: inline-flex; align-items: center; gap: 5px;">
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
        <div style="width: 100%; height: 7px; background: #e2e8f0; border-radius: 5px; overflow: hidden; position: relative;">
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
});

