// ══════════════════════════════════════════════════════════════════════════════
// 🎯 MÓDULO DE INCENTIVOS Y SALTO DE TRAMO DE COMISIONES
// ══════════════════════════════════════════════════════════════════════════════

function getTramoBonusInfo(points, objective) {
  const pts = Number(points) || 0;
  const obj = Number(objective) || 18; // Default 18 for 5h or 21 for 6h

  // Tramos estándar de Telemarketing Renosur:
  // Tramo Base: Objetivo (18 o 21 pts)
  // Tramo 1 (+10 €/contrato): obj + 7 pts (25 pts para 18 / 28 pts para 21)
  // Tramo 2 (+15 €/contrato): obj + 12 pts (30 pts para 18 / 33 pts para 21)
  const tramoBase = obj;
  const tramo1 = obj + 7;
  const tramo2 = obj + 12;

  if (pts < tramoBase) {
    const diff = (tramoBase - pts).toFixed(1);
    return {
      tier: 'pending_base',
      tierName: 'Objetivo Mensual',
      bonusText: 'Comisión Base',
      nextTierGoal: tramoBase,
      remainingToNext: diff,
      badgeText: `🎯 A ${diff} pts del Objetivo Base`,
      badgeColor: '#f59e0b',
      badgeBg: 'rgba(245, 158, 11, 0.12)',
      bonusAmount: '0 €/contrato extra',
      message: `Te faltan <strong>${diff} pts</strong> para entrar en comisiones y cobrar la comisión base.`
    };
  } else if (pts >= tramoBase && pts < tramo1) {
    const diff = (tramo1 - pts).toFixed(1);
    return {
      tier: 'base_met',
      tierName: 'Tramo Base Activo',
      bonusText: 'Tramo 1 (+10 €/contrato)',
      nextTierGoal: tramo1,
      remainingToNext: diff,
      badgeText: `🚀 A solo ${diff} pts de +10€/contrato`,
      badgeColor: '#059669',
      badgeBg: 'rgba(5, 150, 105, 0.12)',
      bonusAmount: '+0 €/contrato extra',
      message: `¡Comisión base desbloqueada! A <strong>${diff} pts</strong> de subir a <strong>Tramo 1 (+10 € extra por venta)</strong>.`
    };
  } else if (pts >= tramo1 && pts < tramo2) {
    const diff = (tramo2 - pts).toFixed(1);
    return {
      tier: 'tramo_1',
      tierName: 'Tramo 1 Activo (+10 €)',
      bonusText: 'Tramo 2 (+15 €/contrato)',
      nextTierGoal: tramo2,
      remainingToNext: diff,
      badgeText: `🔥 ¡+10€/venta activo! A ${diff} pts de +15€`,
      badgeColor: '#d97706',
      badgeBg: 'rgba(217, 119, 6, 0.12)',
      bonusAmount: '+10 €/contrato extra',
      message: `¡Tramo 1 activo (+10 €/venta)! A solo <strong>${diff} pts</strong> del <strong>Tramo Máximo (+15 € extra)</strong>.`
    };
  } else {
    return {
      tier: 'tramo_max',
      tierName: 'Tramo Máximo Activo (+15 €)',
      bonusText: 'Incentivo Máximo',
      nextTierGoal: pts,
      remainingToNext: '0.0',
      badgeText: `👑 ¡Tramo Máximo (+15€/venta)!`,
      badgeColor: '#7c3aed',
      badgeBg: 'rgba(124, 58, 237, 0.12)',
      bonusAmount: '+15 €/contrato extra',
      message: `👑 ¡Enhorabuena! Tienes activo el <strong>Tramo Máximo (+15 € extra en cada venta)</strong>.`
    };
  }
}
