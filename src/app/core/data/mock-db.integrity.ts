import { addCents, multiplyCents } from '../../shared/money';
import { MockDb } from './mock-db';
import { chargeBalance, effectiveApplications } from '../../features/billing/billing.rules';

/**
 * Re-checks over MockDb the constraints of docs/escuela_futbol_mariadb.sql (FK, UNIQUE, CHECK and the generated
 * unique columns). Used by the tests after every critical flow (HU-073): if a service ever writes something the
 * database would reject, a test fails here. Returns the violations (empty = consistent).
 */
export function integrityViolations(db: MockDb): string[] {
  const out: string[] = [];
  const ids = (rows: { id: number }[]) => new Set(rows.map((r) => r.id));
  const fk = (
    name: string,
    rows: object[],
    col: string,
    target: { id: number }[],
    nullable = false,
  ) => {
    const set = ids(target);
    for (const r of rows as Record<string, unknown>[]) {
      const v = r[col];
      if (v === null && nullable) continue;
      if (!set.has(v as number)) out.push(`FK ${name}.${col}=${String(v)}`);
    }
  };
  const unique = (name: string, rows: object[], key: (r: never) => unknown) => {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = key(r as never);
      if (k === null) continue; // UNIQUE ignores NULL (MariaDB)
      const s = JSON.stringify(k);
      if (seen.has(s)) out.push(`UNIQUE ${name} ${s}`);
      seen.add(s);
    }
  };
  const check = (name: string, ok: boolean) => {
    if (!ok) out.push(`CHECK ${name}`);
  };

  // Security
  fk('usuarios', db.users, 'roleId', db.roles, true);
  unique('usuarios.email', db.users, (u: { email: string }) => u.email.toLowerCase());
  for (const u of db.users) {
    const role = db.roles.find((r) => r.id === u.roleId);
    check(`fk_usuario_rol (${u.id})`, u.roleId === null || role?.kind === 'SEGURIDAD');
    check(
      `chk_usuario_nombre_personal (${u.id})`,
      u.roleId === null ? u.firstName === null && u.lastName === null : u.firstName !== null,
    );
  }
  fk('sesiones', db.sessions, 'userId', db.users);
  fk('tokens_recuperacion', db.resetTokens, 'userId', db.users);
  fk('auditoria', db.audit, 'userId', db.users, true);
  unique('rol_permiso', db.rolePermissions, (r: { roleId: number; permissionId: number }) => [
    r.roleId,
    r.permissionId,
  ]);

  // People
  unique('jugadores.identificador', db.players, (p: { identifier: string }) => p.identifier);
  fk('historial_estatus', db.statusHistory, 'playerId', db.players);
  for (const h of db.statusHistory)
    check(`chk_hist_estatus_cambio (${h.id})`, h.previousStatus !== h.newStatus);
  fk('tutores', db.tutors, 'userId', db.users, true);
  unique('tutores.usuario_id', db.tutors, (t: { userId: number | null }) => t.userId);
  fk(
    'tutor_jugador',
    db.tutorPlayers.map((tp) => ({ ...tp, id: 0 })),
    'tutorId',
    db.tutors,
  );
  fk(
    'tutor_jugador',
    db.tutorPlayers.map((tp) => ({ ...tp, id: 0 })),
    'playerId',
    db.players,
  );
  unique('tutor_jugador PK', db.tutorPlayers, (tp: { tutorId: number; playerId: number }) => [
    tp.tutorId,
    tp.playerId,
  ]);
  unique(
    'uq_tutor_jugador_un_principal',
    db.tutorPlayers,
    (tp: { isPrimary: boolean; playerId: number }) => (tp.isPrimary ? tp.playerId : null),
  );
  fk('entrenadores', db.coaches, 'userId', db.users, true);
  unique('entrenadores.usuario_id', db.coaches, (c: { userId: number | null }) => c.userId);

  // Catalogs
  unique('uq_temporada_actual', db.seasons, (s: { isCurrent: boolean }) =>
    s.isCurrent ? 1 : null,
  );
  for (const s of db.seasons) {
    check(`chk_temporada_fechas (${s.id})`, s.endDate >= s.startDate);
    check(`chk_temporada_actual_activa (${s.id})`, !s.isCurrent || s.active);
  }
  unique('sedes.nombre', db.venues, (v: { name: string }) => v.name.toLowerCase());
  fk('categorias', db.categories, 'seasonId', db.seasons, true);
  unique(
    'uq_categoria_temporada_nombre',
    db.categories,
    (c: { seasonId: number | null; name: string }) =>
      c.seasonId === null ? null : [c.seasonId, c.name.toLowerCase()],
  );
  for (const c of db.categories) check(`chk_categoria_edades (${c.id})`, c.maxAge >= c.minAge);

  // Enrollment & membership
  fk('inscripciones', db.enrollments, 'playerId', db.players);
  fk('inscripciones', db.enrollments, 'seasonId', db.seasons);
  unique(
    'uq_inscripcion_jugador_temporada',
    db.enrollments,
    (e: { playerId: number; seasonId: number }) => [e.playerId, e.seasonId],
  );
  for (const e of db.enrollments) check(`chk_inscripcion_monto (${e.id})`, e.amountCents >= 0);
  fk('jugador_categoria', db.playerCategories, 'playerId', db.players);
  fk('jugador_categoria', db.playerCategories, 'categoryId', db.categories);
  unique(
    'uq_jugador_categoria_vigente',
    db.playerCategories,
    (pc: { endDate: string | null; playerId: number }) =>
      pc.endDate === null ? pc.playerId : null,
  );
  for (const pc of db.playerCategories) {
    check(`chk_jugador_categoria_fechas (${pc.id})`, !pc.endDate || pc.endDate >= pc.startDate);
    check(`chk_jugador_categoria_activo (${pc.id})`, pc.active || pc.endDate !== null);
  }
  fk('historial_categoria', db.categoryHistory, 'newCategoryId', db.categories);
  fk('historial_categoria', db.categoryHistory, 'previousCategoryId', db.categories, true);
  for (const h of db.categoryHistory)
    check(`chk_hist_categoria_cambio (${h.id})`, h.previousCategoryId !== h.newCategoryId);
  fk('entrenador_categoria', db.coachCategories, 'coachId', db.coaches);
  fk('entrenador_categoria', db.coachCategories, 'categoryId', db.categories);
  unique(
    'uq_entrenador_categoria_inicio',
    db.coachCategories,
    (a: { coachId: number; categoryId: number; startDate: string }) => [
      a.coachId,
      a.categoryId,
      a.startDate,
    ],
  );
  for (const a of db.coachCategories)
    check(`chk_ent_cat_activo (${a.id})`, a.active || a.endDate !== null);

  // Training
  fk('horarios_entrenamiento', db.schedules, 'categoryId', db.categories);
  fk('horarios_entrenamiento', db.schedules, 'venueId', db.venues);
  for (const h of db.schedules)
    check(`chk_horario (${h.id})`, h.weekday >= 1 && h.weekday <= 7 && h.endTime > h.startTime);
  fk('sesiones_entrenamiento', db.trainingSessions, 'categoryId', db.categories);
  fk('sesiones_entrenamiento', db.trainingSessions, 'venueId', db.venues);
  fk('sesiones_entrenamiento', db.trainingSessions, 'coachId', db.coaches, true);
  for (const s of db.trainingSessions) {
    check(`chk_sesion_ent_horas (${s.id})`, s.endTime > s.startTime);
    check(
      `fk_sesion_ent_horario (${s.id})`,
      s.scheduleId === null ||
        db.schedules.find((h) => h.id === s.scheduleId)?.categoryId === s.categoryId,
    );
  }
  fk('asistencias', db.attendance, 'sessionId', db.trainingSessions);
  fk('asistencias', db.attendance, 'playerId', db.players);
  unique(
    'uq_asistencia_sesion_jugador',
    db.attendance,
    (a: { sessionId: number; playerId: number }) => [a.sessionId, a.playerId],
  );

  // Competitions
  fk('competencias', db.competitions, 'seasonId', db.seasons, true);
  fk('competencia_categoria', db.competitionCategories, 'competitionId', db.competitions);
  fk('competencia_categoria', db.competitionCategories, 'categoryId', db.categories);
  unique(
    'uq_competencia_categoria',
    db.competitionCategories,
    (c: { competitionId: number; categoryId: number }) => [c.competitionId, c.categoryId],
  );
  fk(
    'jugador_competencia_categoria',
    db.rosters,
    'competitionCategoryId',
    db.competitionCategories,
  );
  fk('jugador_competencia_categoria', db.rosters, 'playerId', db.players);
  unique(
    'uq_jugador_competencia_categoria',
    db.rosters,
    (r: { playerId: number; competitionCategoryId: number }) => [
      r.playerId,
      r.competitionCategoryId,
    ],
  );
  for (const r of db.rosters) check(`chk_jcc_activo (${r.id})`, r.active || r.leftOn !== null);
  fk(
    'entrenador_competencia_categoria',
    db.coachCompetitions,
    'competitionCategoryId',
    db.competitionCategories,
  );
  unique(
    'uq_entrenador_comp_cat',
    db.coachCompetitions,
    (a: { coachId: number; competitionCategoryId: number }) => [a.coachId, a.competitionCategoryId],
  );
  for (const a of db.coachCompetitions)
    check(`chk_ecc_activo (${a.id})`, a.active || a.endDate !== null);
  unique('rivales.nombre', db.opponents, (o: { name: string }) => o.name.toLowerCase());
  fk('partidos', db.matches, 'competitionCategoryId', db.competitionCategories);
  fk('partidos', db.matches, 'opponentId', db.opponents, true);
  fk('partidos', db.matches, 'venueId', db.venues, true);
  for (const m of db.matches)
    check(
      `chk_partido_goles (${m.id})`,
      (m.goalsFor === null) === (m.goalsAgainst === null) &&
        (m.goalsFor === null || m.status === 'JUGADO'),
    );

  // Billing
  unique('conceptos_cobro.nombre', db.concepts, (c: { name: string }) => c.name.toLowerCase());
  fk('cargos', db.charges, 'playerId', db.players);
  fk('cargos', db.charges, 'conceptId', db.concepts);
  fk('cargos', db.charges, 'seasonId', db.seasons, true);
  unique(
    'uq_cargo_periodo_concepto',
    db.charges,
    (c: { period: string | null; playerId: number; conceptId: number }) =>
      c.period === null ? null : [c.playerId, c.conceptId, c.period],
  );
  for (const c of db.charges) {
    check(`chk_cargo_monto (${c.id})`, c.originalAmountCents >= 0);
    check(
      `chk_cargo_periodo (${c.id})`,
      c.period === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(c.period),
    );
  }
  unique('pagos.folio', db.payments, (p: { folio: string }) => p.folio);
  fk('pagos', db.payments, 'playerId', db.players);
  for (const p of db.payments) {
    check(
      `fk_pago_tutor_jugador (${p.id})`,
      p.tutorId === null ||
        db.tutorPlayers.some((tp) => tp.tutorId === p.tutorId && tp.playerId === p.playerId),
    );
    check(`chk_pago_importe (${p.id})`, p.amountCents > 0);
    check(
      `chk_pago_cancelacion (${p.id})`,
      (p.status === 'CANCELADO') === (p.cancellationReason !== null),
    );
    const applied = db.paymentApplications
      .filter((a) => a.paymentId === p.id)
      .reduce((s, a) => addCents(s, a.amountCents), 0);
    check(`pago aplicado por su importe (${p.folio})`, applied === p.amountCents);
  }
  for (const a of db.paymentApplications) {
    check(
      `fk_pago_aplicacion_pago (${a.id})`,
      db.payments.find((p) => p.id === a.paymentId)?.playerId === a.playerId,
    );
    check(
      `fk_pago_aplicacion_cargo (${a.id})`,
      db.charges.find((c) => c.id === a.chargeId)?.playerId === a.playerId,
    );
    check(`chk_pago_aplicacion_importe (${a.id})`, a.amountCents > 0);
  }
  unique('uq_pago_cargo', db.paymentApplications, (a: { paymentId: number; chargeId: number }) => [
    a.paymentId,
    a.chargeId,
  ]);
  fk('descuentos', db.discounts, 'chargeId', db.charges);
  for (const d of db.discounts) {
    check(
      `chk_descuento_montos (${d.id})`,
      d.adjustmentCents >= 0 && d.adjustmentCents <= d.originalAmountCents,
    );
    check(
      `descuentos.monto_final (${d.id})`,
      d.finalAmountCents === d.originalAmountCents - d.adjustmentCents,
    );
  }
  const apps = effectiveApplications(db.payments, db.paymentApplications);
  for (const c of db.charges)
    check(`cargo sin sobrepago (${c.id})`, chargeBalance(c, apps, db.discounts) >= 0);

  // Uniforms
  fk('variantes_uniforme', db.uniformVariants, 'productId', db.uniformProducts);
  unique('uq_producto_talla', db.uniformVariants, (v: { productId: number; size: string }) => [
    v.productId,
    v.size,
  ]);
  fk('pedidos_uniforme', db.uniformOrders, 'playerId', db.players);
  unique(
    'uq_pedido_uniforme_cargo',
    db.uniformOrders,
    (o: { chargeId: number | null }) => o.chargeId,
  );
  for (const o of db.uniformOrders) {
    check(
      `fk_pedido_uniforme_cargo (${o.id})`,
      o.chargeId === null || db.charges.find((c) => c.id === o.chargeId)?.playerId === o.playerId,
    );
    check(
      `chk_pedido_uniforme_entrega (${o.id})`,
      (o.status === 'ENTREGADO') === (o.deliveredOn !== null),
    );
    const total = db.uniformOrderLines
      .filter((l) => l.orderId === o.id)
      .reduce((s, l) => addCents(s, multiplyCents(l.unitPriceCents, l.quantity)), 0);
    const charge = db.charges.find((c) => c.id === o.chargeId);
    check(`importe del pedido = cargo (${o.id})`, !charge || charge.originalAmountCents === total);
  }
  fk('detalle_uniforme', db.uniformOrderLines, 'orderId', db.uniformOrders);
  fk('detalle_uniforme', db.uniformOrderLines, 'variantId', db.uniformVariants);
  for (const l of db.uniformOrderLines)
    check(`chk_detalle_uniforme (${l.id})`, l.quantity > 0 && l.unitPriceCents >= 0);

  // Notices
  fk('avisos', db.notices, 'createdBy', db.users);
  fk('aviso_destinatario', db.noticeRecipients, 'noticeId', db.notices);
  for (const r of db.noticeRecipients)
    check(
      `chk_aviso_dest_audiencia (${r.id})`,
      (r.categoryId !== null) === (r.audience === 'CATEGORIA') &&
        (r.tutorId !== null) === (r.audience === 'TUTOR') &&
        (r.coachId !== null) === (r.audience === 'ENTRENADOR'),
    );
  for (const n of db.notices)
    check(`chk_aviso_vigencia (${n.id})`, !n.startsAt || !n.endsAt || n.endsAt >= n.startsAt);
  // ── Constraints added after the 2026-10-07 audit (were missing from this checker) ──
  const rows = <T>(xs: T[]) => xs.map((x) => ({ ...x, id: 0 }));
  fk('rol_permiso', rows(db.rolePermissions), 'roleId', db.roles);
  fk('rol_permiso', rows(db.rolePermissions), 'permissionId', db.permissions);
  unique('roles.nombre', db.roles, (r: { name: string }) => r.name);
  unique('uq_permiso_modulo_accion', db.permissions, (p: { module: string; action: string }) => [
    p.module,
    p.action,
  ]);
  for (const u of db.users)
    check(`chk_usuario_rol_seguridad (${u.id})`, u.roleKind === 'SEGURIDAD');
  unique('sesiones.token_hash', db.sessions, (x: { tokenHash: string }) => x.tokenHash || null);
  unique(
    'tokens_recuperacion.token_hash',
    db.resetTokens,
    (x: { tokenHash: string }) => x.tokenHash,
  );
  for (const x of db.sessions) check(`chk_sesion_expira (${x.id})`, x.expiresAt > x.startedAt);
  for (const x of db.resetTokens) check(`chk_token_expira (${x.id})`, x.expiresAt > x.createdAt);
  fk('historial_estatus', db.statusHistory, 'changedBy', db.users, true);
  fk('historial_categoria', db.categoryHistory, 'playerId', db.players);
  fk('historial_categoria', db.categoryHistory, 'changedBy', db.users, true);
  fk('entrenador_competencia_categoria', db.coachCompetitions, 'coachId', db.coaches);
  fk('asistencias', db.attendance, 'recordedBy', db.users, true);
  fk('pagos', db.payments, 'recordedBy', db.users, true);
  fk('descuentos', db.discounts, 'authorizedBy', db.users, true);
  fk('aviso_destinatario', db.noticeRecipients, 'categoryId', db.categories, true);
  fk('aviso_destinatario', db.noticeRecipients, 'tutorId', db.tutors, true);
  fk('aviso_destinatario', db.noticeRecipients, 'coachId', db.coaches, true);
  unique('temporadas.nombre', db.seasons, (x: { name: string }) => x.name.toLowerCase());
  unique('productos_uniforme.nombre', db.uniformProducts, (x: { name: string }) =>
    x.name.toLowerCase(),
  );
  for (const a of db.coachCategories)
    check(`chk_ent_cat_fechas (${a.id})`, !a.endDate || a.endDate >= a.startDate);
  for (const a of db.coachCompetitions)
    check(`chk_ecc_fechas (${a.id})`, !a.endDate || a.endDate >= a.startDate);
  for (const r of db.rosters)
    check(`chk_jcc_fechas (${r.id})`, !r.leftOn || r.leftOn >= r.joinedOn);
  for (const c of db.competitions)
    check(
      `chk_competencia_fechas (${c.id})`,
      !c.startDate || !c.endDate || c.endDate >= c.startDate,
    );
  for (const c of db.concepts) check(`chk_concepto_importe (${c.id})`, c.suggestedAmountCents >= 0);
  for (const c of db.competitionCategories)
    check(`chk_comp_cat_costo (${c.id})`, c.costCents === null || c.costCents >= 0);
  for (const v of db.uniformVariants) check(`chk_variante_precio (${v.id})`, v.priceCents >= 0);
  return out;
}
