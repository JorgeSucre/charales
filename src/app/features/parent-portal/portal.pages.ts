import { Component, effect, inject, input, numberAttribute, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Id } from '../../core/models';
import { TYPE_LABELS } from '../../core/services/competition.service';
import { WEEKDAYS } from '../../shared/dates';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';
import { PHONE_PATTERN } from '../../shared/validate';
import { CHARGE_STATUS_LABELS } from '../billing/billing.service';
import { MATCH_STATUS_LABELS } from '../matches/match.service';
import { ATTENDANCE_LABELS } from '../trainings/attendance.service';
import { ORDER_STATUS_LABELS } from '../uniforms/uniform.service';
import { PortalService } from './portal.service';

/** HU-061: one card per child (category, next match, balance) + recent notices. Read-only. */
@Component({
  selector: 'app-portal-home-page',
  imports: [RouterLink, LoadState, MoneyPipe, DatePipe],
  template: `
    <h1>Mis hijos</h1>
    <app-load-state [res]="cards" emptyText="No hay jugadores vinculados a tu cuenta."
      ><ng-template>
        <div class="child-cards">
          @for (c of cards.value() ?? []; track c.playerId) {
            <a class="card child" [routerLink]="['/portal/children', c.playerId]">
              <strong>{{ c.name }}</strong>
              <span>{{ c.age }} años · {{ c.categoryName ?? 'Sin categoría' }}</span>
              @if (c.nextMatch; as m) {
                <span
                  >Próximo partido: {{ m.date | date: 'EEE d MMM' }} {{ m.time }} vs
                  {{ m.opponentName }}</span
                >
              } @else {
                <span class="muted">Sin partidos próximos</span>
              }
              <span [class.danger]="c.overdueCents">
                Saldo {{ c.balanceCents | money
                }}{{ c.overdueCents ? ' (vencido ' + (c.overdueCents | money) + ')' : '' }}
              </span>
            </a>
          }
        </div>
      </ng-template></app-load-state
    >
    <h2>Avisos recientes</h2>
    <app-load-state [res]="notices" emptyText="Sin avisos vigentes."
      ><ng-template>
        @for (n of (notices.value() ?? []).slice(0, 3); track n.id) {
          <article class="panel">
            <h3>{{ n.title }}</h3>
            <p class="pre">{{ n.message }}</p>
            <p class="muted">{{ n.publishedAt | date: 'd MMM y' }}</p>
          </article>
        }
        <a routerLink="/portal/notices">Ver todos</a>
      </ng-template></app-load-state
    >
  `,
})
export class PortalHomePage {
  private service = inject(PortalService);
  protected cards = resource({ loader: () => this.service.overview() });
  protected notices = resource({ loader: () => this.service.noticeList() });
}

type ChildTab = 'deportivo' | 'partidos' | 'cuenta' | 'asistencia' | 'uniformes';

/** One child: HU-062 (category, schedule, venue, coaches), HU-063, HU-039, HU-042, HU-047, HU-033, HU-056. */
@Component({
  selector: 'app-child-page',
  imports: [RouterLink, LoadState, MoneyPipe, DatePipe],
  template: `
    <a routerLink="/portal">← Mis hijos</a>
    <app-load-state [res]="child"
      ><ng-template>
        @if (child.value(); as c) {
          <h1>{{ c.name }}</h1>
          <p>
            {{ c.age }} años ·
            {{
              c.category ? c.category.name + ' desde ' + c.category.since : 'Sin categoría vigente'
            }}
          </p>
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
              <h2>Horarios de entrenamiento</h2>
              <ul class="list">
                @for (s of c.schedules; track s.id) {
                  <li>
                    <strong>{{ weekdays[s.weekday] }}</strong> {{ s.startTime }}–{{ s.endTime }} ·
                    {{ s.venueName }}
                  </li>
                } @empty {
                  <li class="muted">Sin horarios.</li>
                }
              </ul>
              <h2>Entrenadores</h2>
              <ul class="list">
                @for (co of c.coaches; track $index) {
                  <li>
                    {{ co.name }} <span class="muted">{{ co.responsibility ?? '' }}</span>
                  </li>
                } @empty {
                  <li class="muted">Sin entrenadores asignados.</li>
                }
              </ul>
              <h2>Torneos y ligas</h2>
              <ul class="list">
                @for (t of c.competitions; track t.participationId) {
                  <li>
                    <strong>{{ t.competitionName }}</strong> ({{ types[t.type] }}) ·
                    {{ t.categoryName }} · {{ t.startDate ?? '¿?' }} – {{ t.endDate ?? '¿?' }} ·
                    {{ t.status }} ·
                    <button type="button" class="link" (click)="tab.set('partidos')">
                      Ver partidos
                    </button>
                  </li>
                } @empty {
                  <li class="muted">No está en el plantel de ninguna competencia.</li>
                }
              </ul>
            }
            @case ('partidos') {
              <h2>Próximos partidos</h2>
              <ul class="list">
                @for (m of c.upcoming; track m.id) {
                  <li [class.muted]="m.status === 'CANCELADO'">
                    <strong>{{ m.date | date: 'EEE d MMM' }} {{ m.time }}</strong> vs
                    {{ m.opponentName }} · {{ m.venueName ?? 'sede por definir' }} ·
                    {{ m.competitionName }}
                    @if (m.status !== 'PROGRAMADO') {
                      <span class="tag off">{{ matchLabels[m.status] }}</span>
                    }
                    @if (m.rescheduleReason) {
                      <br /><small>{{ m.rescheduleReason }}</small>
                    }
                  </li>
                } @empty {
                  <li class="muted">Sin partidos próximos.</li>
                }
              </ul>
              <h2>Resultados</h2>
              <ul class="list">
                @for (m of c.results; track m.id) {
                  <li>
                    {{ m.date | date: 'd MMM' }} · vs {{ m.opponentName }} ·
                    <strong>{{ m.goalsFor }} – {{ m.goalsAgainst }}</strong> ·
                    {{ m.competitionName }}
                  </li>
                } @empty {
                  <li class="muted">Sin resultados.</li>
                }
              </ul>
            }
            @case ('cuenta') {
              <div class="kpis">
                <div class="kpi">
                  <span>Saldo</span><strong>{{ c.statement.totals.balanceCents | money }}</strong>
                </div>
                <div class="kpi" [class.danger]="c.statement.totals.overdueCents">
                  <span>Vencido</span><strong>{{ c.statement.totals.overdueCents | money }}</strong>
                </div>
                <div class="kpi">
                  <span>Pagado</span><strong>{{ c.statement.totals.paidCents | money }}</strong>
                </div>
              </div>
              <ul class="list">
                @for (ch of c.statement.charges; track ch.id) {
                  <li>
                    <strong>{{ ch.label }}</strong> · vence {{ ch.dueDate ?? '—' }}<br />
                    Monto {{ ch.netCents | money }} · pagado {{ ch.paidCents | money }} · saldo
                    {{ ch.balanceCents | money }}
                    <span class="tag" [class.off]="ch.status === 'VENCIDO'">{{
                      chargeLabels[ch.status]
                    }}</span>
                  </li>
                } @empty {
                  <li class="muted">Sin cargos.</li>
                }
              </ul>
            }
            @case ('asistencia') {
              <p>
                {{ c.attendance.summary.presentPct }}% de asistencia ({{
                  c.attendance.summary.present
                }}
                de {{ c.attendance.summary.total }});
                {{ c.attendance.summary.justified }} justificadas.
              </p>
              <ul class="list">
                @for (a of c.attendance.rows; track $index) {
                  <li>
                    {{ a.date | date: 'EEE d MMM' }} · {{ attendanceLabels[a.status] }}
                    {{ a.notes ? '· ' + a.notes : '' }}
                  </li>
                } @empty {
                  <li class="muted">Sin registros.</li>
                }
              </ul>
            }
            @case ('uniformes') {
              <ul class="list">
                @for (o of c.uniforms; track o.id) {
                  <li>
                    {{ o.requestedOn }} ·
                    @for (l of o.lines; track $index) {
                      {{ l.quantity }} × {{ l.product }} {{ l.size }}{{ $last ? '' : ', ' }}
                    }
                    · {{ o.totalCents | money }} ·
                    <span class="tag" [class.off]="o.status === 'CANCELADO'">{{
                      orderLabels[o.status]
                    }}</span>
                  </li>
                } @empty {
                  <li class="muted">Sin pedidos de uniforme.</li>
                }
              </ul>
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
  protected matchLabels = MATCH_STATUS_LABELS;
  protected chargeLabels = CHARGE_STATUS_LABELS;
  protected attendanceLabels = ATTENDANCE_LABELS;
  protected orderLabels = ORDER_STATUS_LABELS;
  protected tabs: [ChildTab, string][] = [
    ['deportivo', 'Deportivo'],
    ['partidos', 'Partidos'],
    ['cuenta', 'Pagos y adeudos'],
    ['asistencia', 'Asistencia'],
    ['uniformes', 'Uniformes'],
  ];
  protected tab = signal<ChildTab>('deportivo');
  protected child = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.child(params),
  });
}

/** HU-059: current notices — general + children's categories + addressed to me; newest first; read-only. */
@Component({
  selector: 'app-portal-notices-page',
  imports: [LoadState, DatePipe],
  template: `
    <h1>Avisos</h1>
    <app-load-state [res]="notices" emptyText="Sin avisos vigentes."
      ><ng-template>
        @for (n of notices.value() ?? []; track n.id) {
          <article class="panel">
            <h3>{{ n.title }}</h3>
            <p class="pre">{{ n.message }}</p>
            <p class="muted">{{ n.publishedAt | date: 'd MMM y' }}</p>
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
  imports: [ReactiveFormsModule, FieldError, LoadState, SubmissionAlert],
  template: `
    <h1>Mi perfil</h1>
    <app-load-state [res]="profile"
      ><ng-template>
        @if (profile.value(); as p) {
          <p>{{ p.firstName }} {{ p.lastName1 }} {{ p.lastName2 ?? '' }}</p>
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form narrow">
            <label>Teléfono <input type="tel" formControlName="phone" autocomplete="tel" /></label>
            <app-field-error [control]="form.controls.phone" />
            <label
              >Correo de contacto <input type="email" formControlName="email" autocomplete="email"
            /></label>
            <app-field-error [control]="form.controls.email" />
            <label
              >Dirección <input formControlName="address" autocomplete="street-address"
            /></label>
            <app-submission-alert [submission]="submission" />
            <button type="submit" [disabled]="submission.busy()">Guardar</button>
          </form>
          <p class="muted">Para cambiar tu nombre o los datos de tus hijos, acude a la escuela.</p>
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
    phone: ['', Validators.pattern(PHONE_PATTERN)],
    email: ['', Validators.email],
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
