// ══════════════════════════════════════════════════════════════════════════════
// 📱 MÓDULO DE INTEGRACIÓN CON WHATSAPP WEB Y MENSAJES COMERCIALES
// ══════════════════════════════════════════════════════════════════════════════

function getClientPhoneForWhatsApp() {
  const phoneInput = document.getElementById('f-cliente-telefono');
  if (!phoneInput) return '';
  let cleaned = (phoneInput.value || '').replace(/[^0-9]/g, '');
  if (cleaned.length === 9) {
    cleaned = '34' + cleaned;
  }
  return cleaned;
}

function buildOfferWhatsAppText(key) {
  if (!window.lastCompResults || !Array.isArray(window.lastCompResults)) return '';
  const res = window.lastCompResults.find(r => r.key === key);
  if (!res) return '';

  const clientName = (document.getElementById('f-cliente-nombre')?.value || '').trim();
  const isLuz = compMode === 'luz';
  const totalStr = (Number(res.total) || 0).toFixed(2).replace('.', ',') + ' €/mes';
  const actualStr = res.actual > 0 ? (Number(res.actual) || 0).toFixed(2).replace('.', ',') + ' €/mes' : null;
  const ahorroMesStr = res.ahorro !== null ? (res.ahorro > 0 ? (Number(res.ahorro) || 0).toFixed(2).replace('.', ',') + ' €/mes' : '0,00 €/mes') : 'Optimizado';
  const ahorroAnoStr = res.ahorro !== null && res.ahorro > 0 ? (Number(res.ahorro) * 12).toFixed(2).replace('.', ',') + ' €/año' : null;
  const pctStr = res.actual > 0 && res.ahorro > 0 ? Math.round((res.ahorro / res.actual) * 100) + '%' : null;

  let msg = `⚡ *PROPUESTA DE AHORRO ENERGÉTICO* ⚡\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (clientName) {
    msg += `👤 *Cliente:* ${clientName}\n`;
  }
  msg += `🏢 *Compañía:* ${res.r.name.split(' (')[0]}\n`;
  msg += `🏷️ *Tarifa:* ${res.tariffName || res.r.name}\n`;
  msg += `💡 *Suministro:* ${isLuz ? 'Luz' : 'Gas'}\n\n`;

  if (actualStr) {
    msg += `📄 *Factura Actual:* ${actualStr}\n`;
  }
  msg += `💰 *Nueva Cuota Estimada:* *${totalStr}*\n`;

  if (res.ahorro > 0) {
    msg += `📉 *Ahorro Mensual:* *${ahorroMesStr}*\n`;
    if (ahorroAnoStr) {
      msg += `🚀 *Ahorro Anual:* *${ahorroAnoStr}* ${pctStr ? `(_${pctStr}_)` : ''}\n`;
    }
  }

  msg += `\n✅ *Condiciones Clave:*`;
  msg += `\n• Sin compromiso de permanencia.`;
  msg += `\n• Gestión 100% gratuita y sin corte de luz/gas.`;
  msg += `\n• Mantenimiento de tu contador y distribuidora habitual.`;
  msg += `\n\n📞 _Asesoría Energética Renosur Grupo_`;

  return msg;
}

function shareOfferViaWhatsApp(key) {
  const text = buildOfferWhatsAppText(key);
  if (!text) {
    alert('No se pudo generar el texto de la oferta.');
    return;
  }
  const phone = getClientPhoneForWhatsApp();
  const url = phone 
    ? `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`
    : `https://web.whatsapp.com/send?text=${encodeURIComponent(text)}`;

  window.open(url, 'whatsapp_web');
}

function copyOfferWhatsAppText(key, btn) {
  const text = buildOfferWhatsAppText(key);
  if (!text) return;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showCopyFeedback(btn));
  } else {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showCopyFeedback(btn);
    } catch (e) {
      console.error('Error copying to clipboard', e);
    }
    document.body.removeChild(textarea);
  }
}

function buildSummaryWhatsAppText() {
  if (!window.lastCompResults || !Array.isArray(window.lastCompResults) || window.lastCompResults.length === 0) return '';
  const clientName = (document.getElementById('f-cliente-nombre')?.value || '').trim();
  const actual = parseFloat(document.getElementById('f-actual')?.value) || 0;
  const isLuz = compMode === 'luz';

  let msg = `📊 *ESTUDIO COMPARATIVO ENERGÉTICO* 📊\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (clientName) msg += `👤 *Cliente:* ${clientName}\n`;
  if (actual > 0) msg += `📄 *Factura Actual:* ${actual.toFixed(2).replace('.', ',')} €/mes\n\n`;

  msg += `🏆 *Opciones Analizadas (de mayor a menor ahorro):*\n\n`;

  window.lastCompResults.forEach((r, idx) => {
    if (r.isLocked) return;
    const name = r.tariffName || r.r.name;
    const total = r.total.toFixed(2).replace('.', ',') + ' €/mes';
    const ahorroMes = r.ahorro > 0 ? ` (Ahorras ${r.ahorro.toFixed(2).replace('.', ',')} €/mes)` : '';
    msg += `${idx + 1}. *${name}*: *${total}*${ahorroMes}\n`;
  });

  msg += `\n✅ Sin permanencia • Gestión 100% gratuita`;
  msg += `\n📞 _Renosur Grupo Asesoría_`;

  return msg;
}

function shareSummaryViaWhatsApp() {
  const text = buildSummaryWhatsAppText();
  if (!text) return;
  const phone = getClientPhoneForWhatsApp();
  const url = phone 
    ? `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`
    : `https://web.whatsapp.com/send?text=${encodeURIComponent(text)}`;

  window.open(url, 'whatsapp_web');
}

function copySummaryWhatsAppText(btn) {
  const text = buildSummaryWhatsAppText();
  if (!text) return;

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showCopyFeedback(btn));
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showCopyFeedback(btn);
    } catch (e) {}
    document.body.removeChild(textarea);
  }
}

function showCopyFeedback(btn) {
  if (!btn) return;
  const origHtml = btn.innerHTML;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline-block;vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg> ¡Copiado!`;
  btn.style.borderColor = '#10b981';
  btn.style.color = '#059669';
  setTimeout(() => {
    btn.innerHTML = origHtml;
    btn.style.borderColor = '';
    btn.style.color = '';
  }, 1800);
}
