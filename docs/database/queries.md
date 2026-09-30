# Consultas críticas

El SQL está en [`db/queries/critical.sql`](../../db/queries/critical.sql). `npm run db:test` las ejecuta sobre una BD
recién creada; cualquier error hace fallar la prueba. Resultados con el seed, verificados el 2026-09-30:

| #   | Pregunta                                                                 | Resultado con el seed                                                                 |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Q1  | Jugadores actuales de una categoría                                      | Sub-10: Diego, Mateo                                                                  |
| Q2  | Categoría actual de un jugador                                           | Diego → Sub-10 (2026-2027)                                                            |
| Q3  | Historial de categorías                                                  | Lucía: Sub-10 (25-26, cerrada) → Sub-12 (26-27, abierta)                              |
| Q4  | Inscritos activos en una temporada                                       | 3 (Valeria tiene la inscripción cancelada)                                            |
| Q5  | Hijos de un tutor **desde su usuario**                                   | Teresa → Diego, Lucía                                                                 |
| Q6  | Cargos pendientes de un jugador                                          | Diego: mensualidad oct (pending), uniforme (partial)                                  |
| Q7  | Saldo total de un jugador                                                | Diego: 110 000 centavos                                                               |
| Q8  | Cargos vencidos (fecha de México)                                        | 3                                                                                     |
| Q9  | Pagos de un jugador                                                      | Diego: recibos 1 y 4                                                                  |
| Q10 | Aplicaciones de un pago = recibo reconstruido                            | R-1: mensualidad sep, cobró Sofía                                                     |
| Q11 | Cancelar un pago sin perder historial                                    | Aplicaciones conservadas; el cargo vuelve a deber 60 000 (revertido)                  |
| Q12 | Ingresos por mes y concepto                                              | ago: inscripción 50 000; sep: mensualidad 60 000 + uniforme 35 000 (sin el cancelado) |
| Q13 | Ingresos por método                                                      | cash 95 000, transfer 50 000 (el pago de las 19:30 del 30-sep cuenta en septiembre)   |
| Q14 | Pedidos de uniformes (producto, talla, cantidad, cargo, pagado, entrega) | 2 líneas; precio histórico 35 000 aunque el actual es 38 000                          |
| Q15 | Uniformes pendientes de entrega                                          | Short CH de Diego                                                                     |
| Q16 | Competencias en las que participa una categoría (C2)                     | Sub-12: Liga Municipal (sin entrenador aún), Copa Otoño (Marta)                       |
| Q17 | Agenda de una categoría (hora local)                                     | Entrenamiento 1-oct 17:00; partido 4-oct 10:00                                        |
| Q18 | Jugadores activos inscritos en la temporada activa                       | 3                                                                                     |
| Q19 | Mensualidades de una temporada                                           | 4 (1 pagada, 2 vencidas, 1 pendiente)                                                 |
| Q20 | Reporte global de adeudos con tutor principal                            | Mateo 130 000, Diego 110 000, Lucía 60 000                                            |
| Q21 | Portal HU-063: competencias de los hijos del tutor autenticado           | Diego: Liga; Lucía: Liga y Copa                                                       |

Q8 y el `status` de `charge_balances` dependen de la fecha actual (`business_date(now())`).
