import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  resource,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AttendanceStatus, Id } from '../../core/models';
import { COMPETITION_STATUS_LABELS, TYPE_LABELS } from '../../core/services/competition.service';
import { WEEKDAYS, addDays, today } from '../../shared/dates';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { sumCents } from '../../shared/money';
import {
  CHARGE_TONE,
  COMPETITION_TONE,
  MATCH_TONE,
  ORDER_TONE,
} from '../../shared/status-tone';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';
import { emailValidator, phoneValidator } from '../../shared/validate';
import { CHARGE_STATUS_LABELS } from '../billing/billing.service';
import { MATCH_STATUS_LABELS } from '../matches/match.service';
import { ATTENDANCE_LABELS } from '../trainings/attendance.service';
import { ORDER_STATUS_LABELS } from '../uniforms/uniform.service';
import { PortalService } from './portal.service';

const ATTENDANCE_TONE: Record<AttendanceStatus, string> = {
  PRESENTE: 'ok',
  AUSENTE: 'danger',
  JUSTIFICADO: 'warn',
};

/** HU-061: one card per child (category, next match, balance) + recent notices. Read-only. */
@Component({
  selector: 'app-portal-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LoadState, MoneyPipe, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Mis hijos</h1>
        <p class="page-subtitle">
          Consulta horarios de entrenamiento, partidos, asistencia, avisos y estado de cuenta de tu
          familia.
        </p>
      </div>
      <a class="button secondary sm" routerLink="/portal/notices">Todos los avisos</a>
    </div>

    <app-load-state [res]="cards" emptyText="No hay jugadores vinculados a tu cuenta."
      ><ng-template>
        <div class="kpis">
          <div class="kpi">
            <span>Jugadores vinculados</span>
            <strong>{{ (cards.value() ?? []).length }}</strong>
          </div>
          <div class="kpi">
            <span>Saldo pendiente total</span>
            <strong>{{ totalBalanceCents() | money }}</strong>
          </div>
          <div class="kpi" [class.danger]="totalOverdueCents() > 0" [class.kpi-ok]="totalOverdueCents() === 0">
            <span>Saldo vencido</span>
            <strong>{{ totalOverdueCents() | money }}</strong>
          </div>
        </div>

        <div class="child-cards">
          @for (c of cards.value() ?? []; track c.playerId) {
            <a class="card child portal-child-card" [routerLink]="['/portal/children', c.playerId]">
              <div class="portal-child-head">
                <strong>{{ c.name }}</strong>
                <span class="tag neutral">{{ c.categoryName ?? 'Sin categoría' }}</span>
              </div>
              <span class="muted">{{ c.age }} años</span>

              <div class="portal-child-meta">
                @if (c.nextMatch; as m) {
                  <span>
                    <strong>Próximo partido:</strong>
                    {{ m.date | date: 'EEE d MMM' }} {{ m.time }} vs {{ m.opponentName }}
                  </span>
                } @else {
                  <span class="muted">Sin partidos próximos programados</span>
                }
              </div>

              <div class="portal-child-foot">
                @if (c.overdueCents > 0) {
                  <span class="tag danger">
                    Saldo {{ c.balanceCents | money }} · Vencido {{ c.overdueCents | money }}
                  </span>
                } @else if (c.balanceCents > 0) {
                  <span class="tag warn">Saldo por pagar: {{ c.balanceCents | money }}</span>
                } @else {
                  <span class="tag ok">Al corriente</span>
                }
                <span class="portal-child-cta">Ver ficha →</span>
              </div>
            </a>
          }
        </div>
      </ng-template></app-load-state
    >

    <section class="portal-notices-section" aria-labelledby="portal-recent-notices">
      <div class="panel-head-row">
        <h2 id="portal-recent-notices">Avisos recientes</h2>
        <a routerLink="/portal/notices">Ver todos</a>
      </div>
      <app-load-state [res]="notices" emptyText="Sin avisos vigentes."
        ><ng-template>
          @for (n of (notices.value() ?? []).slice(0, 3); track n.id) {
            <article class="panel">
              <div class="panel-head-row">
                <h3>{{ n.title }}</h3>
                <span class="tag neutral">{{ n.audience.join(', ') }}</span>
              </div>
              <p class="pre">{{ n.message }}</p>
              <p class="muted">Publicado el {{ n.publishedAt | date: 'd MMM y' }}</p>
            </article>
          }
        </ng-template></app-load-state
      >
    </section>
  `,
})
export class PortalHomePage {
  private service = inject(PortalService);
  protected cards = resource({ loader: () => this.service.overview() });
  protected notices = resource({ loader: () => this.service.noticeList() });

  protected totalBalanceCents = computed(() =>
    sumCents((this.cards.value() ?? []).map((c) => c.balanceCents)),
  );
  protected totalOverdueCents = computed(() =>
    sumCents((this.cards.value() ?? []).map((c) => c.overdueCents)),
  );
}

type ChildTab = 'deportivo' | 'partidos' | 'cuenta' | 'asistencia' | 'uniformes';

/** One child: HU-062 (category, schedule, venue, coaches), HU-063, HU-039, HU-042, HU-047, HU-033, HU-056. */
@Component({
  selector: 'app-child-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LoadState, MoneyPipe, DatePipe],
  template: `
    <a class="back-link" routerLink="/portal">← Mis hijos</a>
    <app-load-state [res]="child"
      ><ng-template>
        @if (child.value(); as c) {
          <div class="page-head">
            <div class="record-identity">
              <h1>{{ c.name }}</h1>
              <p class="page-subtitle">
                <span class="mono">{{ c.identifier }}</span> · {{ c.age }} años ·
                {{
                  c.category
                    ? c.category.name + ' (desde ' + c.category.since + ')'
                    : 'Sin categoría vigente'
                }}
              </p>
            </div>
          </div>
          <div class="tabs" role="tablist">
            @for (t of tabs; track t[0]) {
              <button
                type="button"
                role="tab"
                [attr.aria-selected]="tab() === t[0]"
                [class.active]="tab() === t[0]"
                (click)="tab.set(t[0])"
              >
                {{ t[1] }}
              </button>
            }
          </div>
          @switch (tab()) {
            @case ('deportivo') {
              <div class="two-col">
                <section class="panel">
                  <h2>Horarios de entrenamiento</h2>
                  <ul class="list clean-list">
                    @for (s of c.schedules; track s.id) {
                      <li class="portal-row-item">
                        <strong>{{ weekdays[s.weekday] }}</strong>
                        <span class="tabular">{{ s.startTime }}–{{ s.endTime }}</span> ·
                        <span>{{ s.venueName }}</span>
                      </li>
                    } @empty {
                      <li class="muted">Sin horarios registrados.</li>
                    }
                  </ul>
                </section>
                <section class="panel">
                  <h2>Entrenadores</h2>
                  <ul class="list clean-list">
                    @for (co of c.coaches; track $index) {
                      <li class="portal-row-item">
                        <strong>{{ co.name }}</strong>
                        @if (co.responsibility) {
                          <span class="tag neutral">{{ co.responsibility }}</span>
                        }
                      </li>
                    } @empty {
                      <li class="muted">Sin entrenadores asignados.</li>
                    }
                  </ul>
                </section>
              </div>
              <section class="panel">
                <h2>Torneos y ligas</h2>
                <ul class="list clean-list">
                  @for (t of c.competitions; track t.participationId) {
                    <li class="portal-row-item">
                      <div>
                        <strong>{{ t.competitionName }}</strong> ({{ types[t.type] }}) ·
                        {{ t.categoryName }}
                        <div class="cell-sub tabular">
                          {{ t.startDate ?? '¿?' }} – {{ t.endDate ?? '¿?' }}
                        </div>
                      </div>
                      <div class="row-actions">
                        <span class="tag {{ competitionTone[t.status] }}">{{
                          competitionLabels[t.status]
                        }}</span>
                        <button type="button" class="link" (click)="tab.set('partidos')">
                          Ver partidos
                        </button>
                      </div>
                    </li>
                  } @empty {
                    <li class="muted">No está en el plantel de ninguna competencia.</li>
                  }
                </ul>
              </section>
            }
            @case ('partidos') {
              <section class="panel">
                <h2>Próximos partidos</h2>
                <ul class="list clean-list">
                  @for (m of c.upcoming; track m.id) {
                    <li class="portal-row-item" [class.muted]="m.status === 'CANCELADO'">
                      <div>
                        <strong class="tabular"
                          >{{ m.date | date: 'EEE d MMM' }} {{ m.time }}</strong
                        >
                        vs <strong>{{ m.opponentName }}</strong>
                        <div class="cell-sub">
                          {{ m.venueName ?? 'Sede por definir' }} · {{ m.competitionName }}
                        </div>
                        @if (m.rescheduleReason) {
                          <div class="cell-sub">Motivo: {{ m.rescheduleReason }}</div>
                        }
                      </div>
                      <span class="tag {{ matchTone[m.status] }}">{{
                        matchLabels[m.status]
                      }}</span>
                    </li>
                  } @empty {
                    <li class="muted">Sin partidos próximos.</li>
                  }
                </ul>
              </section>
              <section class="panel">
                <h2>Resultados</h2>
                <ul class="list clean-list">
                  @for (m of c.results; track m.id) {
                    <li class="portal-row-item">
                      <div>
                        <span class="tabular">{{ m.date | date: 'd MMM y' }}</span> · vs
                        <strong>{{ m.opponentName }}</strong>
                        <div class="cell-sub">{{ m.competitionName }}</div>
                      </div>
                      <strong class="tag neutral tabular"
                        >{{ m.goalsFor }} – {{ m.goalsAgainst }}</strong
                      >
                    </li>
                  } @empty {
                    <li class="muted">Sin resultados registrados.</li>
                  }
                </ul>
              </section>
            }
            @case ('cuenta') {
              <div class="kpis">
                <div class="kpi">
                  <span>Saldo por pagar</span>
                  <strong>{{ c.statement.totals.balanceCents | money }}</strong>
                </div>
                <div
                  class="kpi"
                  [class.danger]="c.statement.totals.overdueCents > 0"
                  [class.kpi-ok]="c.statement.totals.overdueCents === 0"
                >
                  <span>Vencido</span>
                  <strong>{{ c.statement.totals.overdueCents | money }}</strong>
                </div>
                <div class="kpi kpi-ok">
                  <span>Pagado</span>
                  <strong>{{ c.statement.totals.paidCents | money }}</strong>
                </div>
              </div>
              <div class="table-wrap">
                <table>
                  <caption class="sr-only">
                    Cargos y estado de cuenta de {{ c.name }}
                  </caption>
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Vence</th>
                      <th class="num">Neto</th>
                      <th class="num">Pagado</th>
                      <th class="num">Saldo</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (ch of c.statement.charges; track ch.id) {
                      <tr [class.muted]="ch.status === 'CANCELADO'">
                        <td>
                          <strong>{{ ch.label }}</strong>
                        </td>
                        <td class="tabular">{{ ch.dueDate ?? '—' }}</td>
                        <td class="num">{{ ch.netCents | money }}</td>
                        <td class="num">{{ ch.paidCents | money }}</td>
                        <td class="num">
                          <strong>{{ ch.balanceCents | money }}</strong>
                        </td>
                        <td>
                          <span class="tag {{ chargeTone[ch.status] }}">{{
                            chargeLabels[ch.status]
                          }}</span>
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="6" class="muted">Sin cargos registrados.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            @case ('asistencia') {
              <div class="filters">
                <label
                  >Desde
                  <input
                    type="date"
                    [value]="from()"
                    (change)="from.set($any($event.target).value)"
                /></label>
                <label
                  >Hasta
                  <input type="date" [value]="to()" (change)="to.set($any($event.target).value)"
                /></label>
                <button type="button" class="secondary sm" (click)="resetAttendanceRange()">
                  Últimos 2 meses
                </button>
              </div>
              <app-load-state [res]="attendance"
                ><ng-template>
                  @if (attendance.value(); as a) {
                    <div class="kpis">
                      <div
                        class="kpi"
                        [class.kpi-ok]="a.summary.presentPct >= 80"
                        [class.danger]="a.summary.total > 0 && a.summary.presentPct < 75"
                      >
                        <span>Asistencia</span>
                        <strong>{{ a.summary.presentPct }}%</strong>
                      </div>
                      <div class="kpi">
                        <span>Presentes</span>
                        <strong>{{ a.summary.present }} / {{ a.summary.total }}</strong>
                      </div>
                      <div class="kpi">
                        <span>Justificadas</span>
                        <strong>{{ a.summary.justified }}</strong>
                      </div>
                    </div>
                    <ul class="list clean-list">
                      @for (r of a.rows; track $index) {
                        <li class="portal-row-item">
                          <div>
                            <strong class="tabular">{{ r.date | date: 'EEE d MMM' }}</strong>
                            @if (r.notes) {
                              <div class="cell-sub">{{ r.notes }}</div>
                            }
                          </div>
                          <span class="tag {{ attendanceTone[r.status] }}">{{
                            attendanceLabels[r.status]
                          }}</span>
                        </li>
                      } @empty {
                        <li class="muted">Sin registros de asistencia en el periodo.</li>
                      }
                    </ul>
                  }
                </ng-template></app-load-state
              >
            }
            @case ('uniformes') {
              <section class="panel">
                <h2>Pedidos de uniformes</h2>
                <ul class="list clean-list">
                  @for (o of c.uniforms; track o.id) {
                    <li class="portal-row-item">
                      <div>
                        <strong class="tabular">{{ o.requestedOn }}</strong> ·
                        @for (l of o.lines; track $index) {
                          {{ l.quantity }} × {{ l.product }} {{ l.size }}{{ $last ? '' : ', ' }}
                        }
                        <div class="cell-sub tabular">Total: {{ o.totalCents | money }}</div>
                      </div>
                      <span class="tag {{ orderTone[o.status] }}">{{
                        orderLabels[o.status]
                      }}</span>
                    </li>
                  } @empty {
                    <li class="muted">Sin pedidos de uniforme registrados.</li>
                  }
                </ul>
              </section>
            }
          }
        }
      </ng-template></app-load-state
    >
  `,
})
export class ChildPage {
  readonly id = input.required<Id, unknown>({ transform: numberAttribute });
  private service = inject(PortalService);
  protected weekdays = WEEKDAYS;
  protected types = TYPE_LABELS;
  protected competitionLabels = COMPETITION_STATUS_LABELS;
  protected competitionTone = COMPETITION_TONE;
  protected matchLabels = MATCH_STATUS_LABELS;
  protected matchTone = MATCH_TONE;
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected chargeTone = CHARGE_TONE;
  protected attendanceLabels = ATTENDANCE_LABELS;
  protected attendanceTone = ATTENDANCE_TONE;
  protected orderLabels = ORDER_STATUS_LABELS;
  protected orderTone = ORDER_TONE;
  protected tabs: [ChildTab, string][] = [
    ['deportivo', 'Deportivo'],
    ['partidos', 'Partidos'],
    ['cuenta', 'Pagos y adeudos'],
    ['asistencia', 'Asistencia'],
    ['uniformes', 'Uniformes'],
  ];
  protected tab = signal<ChildTab>('deportivo');
  /** HU-033: attendance period (default: from the 1st of the previous month to today). */
  private defaultFrom = addDays(`${today().slice(0, 7)}-01`, -31).slice(0, 8) + '01';
  protected from = signal(this.defaultFrom);
  protected to = signal(today());
  protected attendance = resource({
    params: () => ({ id: this.id(), from: this.from(), to: this.to() }),
    loader: ({ params }) => this.service.attendance(params.id, params.from, params.to),
  });
  protected child = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.child(params),
  });

  resetAttendanceRange(): void {
    this.from.set(this.defaultFrom);
    this.to.set(today());
  }
}

/** HU-059: current notices — general + children's categories + addressed to me; newest first; read-only. */
@Component({
  selector: 'app-portal-notices-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LoadState, DatePipe],
  template: `
    <a class="back-link" routerLink="/portal">← Mis hijos</a>
    <div class="page-head">
      <div>
        <h1>Avisos</h1>
        <p class="page-subtitle">
          Comunicados generales de la escuela y avisos dirigidos a las categorías de tus hijos.
        </p>
      </div>
    </div>
    <app-load-state [res]="notices" emptyText="Sin avisos vigentes."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            <strong class="tabular">{{ (notices.value() ?? []).length }}</strong>
            {{ (notices.value() ?? []).length === 1 ? 'aviso vigente' : 'avisos vigentes' }}
          </p>
        </div>
        @for (n of notices.value() ?? []; track n.id) {
          <article class="panel">
            <div class="panel-head-row">
              <h3>{{ n.title }}</h3>
              <span class="tag neutral">{{ n.audience.join(', ') }}</span>
            </div>
            <p class="pre">{{ n.message }}</p>
            <p class="muted">Publicado el {{ n.publishedAt | date: 'd MMM y' }}</p>
          </article>
        }
      </ng-template></app-load-state
    >
  `,
})
export class PortalNoticesPage {
  private service = inject(PortalService);
  protected notices = resource({ loader: () => this.service.noticeList() });
}

/** HU-064: the tutor edits only their contact data (never the player's identity); validated and audited. */
@Component({
  selector: 'app-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, FieldError, FieldA11y, LoadState, SubmissionAlert],
  template: `
    <a class="back-link" routerLink="/portal">← Mis hijos</a>
    <div class="page-head">
      <div>
        <h1>Mi perfil</h1>
        <p class="page-subtitle">Mantén actualizados tus medios de contacto con la escuela.</p>
      </div>
    </div>
    <app-load-state [res]="profile"
      ><ng-template>
        @if (profile.value(); as p) {
          <section class="panel narrow">
            <div class="account-box profile-identity-box">
              <span class="account-box-label">Titular de la cuenta</span>
              <strong>{{ p.firstName }} {{ p.lastName1 }} {{ p.lastName2 ?? '' }}</strong>
            </div>
            <form
              [formGroup]="form"
              (ngSubmit)="submit()"
              novalidate
              class="grid-form profile-form"
            >
              <div>
                <label>Teléfono <input type="tel" formControlName="phone" autocomplete="tel" /></label>
                <app-field-error [control]="form.controls.phone" />
              </div>
              <div>
                <label
                  >Correo de contacto
                  <input type="email" formControlName="email" autocomplete="email"
                /></label>
                <app-field-error [control]="form.controls.email" />
              </div>
              <label
                >Dirección <input formControlName="address" autocomplete="street-address"
              /></label>
              <app-submission-alert [submission]="submission" />
              <div class="actions">
                <button type="submit" [disabled]="submission.busy()">
                  {{ submission.busy() ? 'Guardando…' : 'Guardar cambios' }}
                </button>
              </div>
            </form>
            <p class="muted profile-note">
              Para cambiar tu nombre o los datos de tus hijos, acude directamente a la dirección de
              la escuela.
            </p>
          </section>
        }
      </ng-template></app-load-state
    >
  `,
})
export class ProfilePage {
  private service = inject(PortalService);
  protected profile = resource({ loader: () => this.service.profile() });
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    phone: ['', phoneValidator],
    email: ['', emailValidator],
    address: [''],
  });

  constructor() {
    effect(() => {
      const p = this.profile.value();
      if (p)
        this.form.setValue({
          phone: p.phone ?? '',
          email: p.email ?? '',
          address: p.address ?? '',
        });
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    if (
      await this.submission.run(
        () => this.service.updateProfile(this.form.getRawValue()),
        'Datos actualizados.',
      )
    )
      this.profile.reload();
  }
}
