import { Component, inject, input, numberAttribute, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CompetitionStatus, CompetitionType, Id, ParticipationStatus } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import {
  COMPETITION_STATUS_LABELS,
  CompetitionService,
  CompetitionView,
  PARTICIPATION_LABELS,
  TYPE_LABELS,
} from '../../core/services/competition.service';
import { today } from '../../shared/dates';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { MoneyPipe } from '../../shared/money.pipe';
import { Submission } from '../../shared/submission';
import { SubmissionAlert, centsFromInput } from '../../shared/ui';
import { SeasonService } from '../seasons/season.service';

/** HU-034: tournaments, leagues and others (competencias.tipo) with season, organizer, dates and status. */
@Component({
  selector: 'app-competitions-page',
  imports: [ReactiveFormsModule, RouterLink, FieldError, LoadState, SubmissionAlert],
  template: `
    <h1>Competencias</h1>
    @if (auth.can('competencias.crear') || editingId()) {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
        <h2>{{ editingId() ? 'Editar competencia' : 'Nueva competencia' }}</h2>
        <label>Nombre <input formControlName="name" /></label>
        <app-field-error [control]="form.controls.name" />
        <div class="two-col">
          <label
            >Tipo
            <select formControlName="type">
              @for (t of types; track t[0]) {
                <option [value]="t[0]">{{ t[1] }}</option>
              }
            </select>
          </label>
          <label
            >Temporada
            <select formControlName="seasonId">
              <option [ngValue]="null">Sin temporada</option>
              @for (s of seasons.value() ?? []; track s.id) {
                <option [ngValue]="s.id">{{ s.name }}</option>
              }
            </select>
          </label>
          <label>Inicio <input type="date" formControlName="startDate" /></label>
          <label>Fin <input type="date" formControlName="endDate" /></label>
          <label>Organizador <input formControlName="organizer" /></label>
          <label>Contacto <input formControlName="contact" /></label>
        </div>
        <label
          >Estatus
          <select formControlName="status">
            @for (s of statuses; track s[0]) {
              <option [value]="s[0]">{{ s[1] }}</option>
            }
          </select>
        </label>
        <label>Observaciones <textarea rows="2" formControlName="notes"></textarea></label>
        <app-submission-alert [submission]="submission" />
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          @if (editingId()) {
            <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
          }
        </div>
      </form>
    }
    <app-load-state [res]="competitions"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Temporada</th>
                <th>Fechas</th>
                <th>Organizador</th>
                <th class="num">Categorías</th>
                <th>Estatus</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of competitions.value() ?? []; track c.id) {
                <tr>
                  <td>
                    <a [routerLink]="['/sports/competitions', c.id]">{{ c.name }}</a>
                  </td>
                  <td>{{ typeLabels[c.type] }}</td>
                  <td>{{ c.seasonName ?? '—' }}</td>
                  <td>{{ c.startDate ?? '¿?' }} – {{ c.endDate ?? '¿?' }}</td>
                  <td>{{ c.organizer ?? '—' }}</td>
                  <td class="num">{{ c.participations }}</td>
                  <td>
                    <span class="tag" [class.off]="c.status === 'CANCELADA'">{{
                      statusLabels[c.status]
                    }}</span>
                  </td>
                  <td>
                    @if (auth.can('competencias.editar')) {
                      <button type="button" class="link" (click)="edit(c)">Editar</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </ng-template></app-load-state
    >
  `,
})
export class CompetitionsPage {
  private service = inject(CompetitionService);
  private seasonService = inject(SeasonService);
  protected auth = inject(AuthService);
  protected types = Object.entries(TYPE_LABELS) as [CompetitionType, string][];
  protected statuses = Object.entries(COMPETITION_STATUS_LABELS) as [CompetitionStatus, string][];
  protected typeLabels = TYPE_LABELS;
  protected statusLabels = COMPETITION_STATUS_LABELS;
  protected seasons = resource({ loader: () => this.seasonService.list() });
  protected competitions = resource({ loader: () => this.service.list() });
  protected submission = new Submission();
  protected editingId = signal<Id | null>(null);
  private blank = {
    name: '',
    type: 'TORNEO' as CompetitionType,
    seasonId: null as Id | null,
    startDate: '',
    endDate: '',
    organizer: '',
    contact: '',
    status: 'PLANIFICADA' as CompetitionStatus,
    notes: '',
  };
  protected form = inject(FormBuilder).nonNullable.group({
    ...this.blank,
    name: ['', Validators.required],
  });

  edit(c: CompetitionView): void {
    this.editingId.set(c.id);
    this.form.setValue({
      name: c.name,
      type: c.type,
      seasonId: c.seasonId,
      startDate: c.startDate ?? '',
      endDate: c.endDate ?? '',
      organizer: c.organizer ?? '',
      contact: c.contact ?? '',
      status: c.status,
      notes: c.notes ?? '',
    });
  }

  cancel(): void {
    this.editingId.set(null);
    this.form.reset();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const draft = {
      ...v,
      id: this.editingId() ?? undefined,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
    };
    if (await this.submission.run(() => this.service.save(draft), 'Competencia guardada.')) {
      this.cancel();
      this.competitions.reload();
    }
  }
}

/** HU-035 (categories registered, cost/status), HU-036 (roster with join/leave history) and coaches (HU-026). */
@Component({
  selector: 'app-competition-detail-page',
  imports: [FormsModule, RouterLink, LoadState, MoneyPipe, SubmissionAlert],
  template: `
    <a routerLink="/sports/competitions">← Competencias</a>
    <app-load-state [res]="competition"
      ><ng-template>
        @if (competition.value(); as c) {
          <h1>
            {{ c.name }}
            <span class="muted">{{ typeLabels[c.type] }} · {{ statusLabels[c.status] }}</span>
          </h1>
          <p class="muted">
            {{ c.seasonName ?? '' }} · {{ c.startDate ?? '¿?' }} – {{ c.endDate ?? '¿?' }} ·
            {{ c.organizer ?? '' }}
          </p>
          <app-submission-alert [submission]="submission" />

          <h2>Categorías participantes</h2>
          @if (auth.can('competencias.editar')) {
            <form class="grid-form" (ngSubmit)="register()" novalidate>
              <div class="two-col">
                <label
                  >Categoría
                  <select name="cat" [(ngModel)]="categoryId">
                    <option [ngValue]="null">Selecciona…</option>
                    @for (cat of categories.value() ?? []; track cat.id) {
                      <option [ngValue]="cat.id">
                        {{ cat.name }} · {{ cat.seasonName ?? '' }}
                      </option>
                    }
                  </select>
                </label>
                <label
                  >Fecha de inscripción <input type="date" name="reg" [(ngModel)]="registeredOn"
                /></label>
                <label
                  >Costo (MXN, opcional)
                  <input type="number" min="0" step="0.01" name="cost" [(ngModel)]="cost"
                /></label>
                <label
                  >Estatus
                  <select name="pst" [(ngModel)]="participationStatus">
                    <option value="INSCRITA">Inscrita</option>
                    <option value="PENDIENTE">Pendiente</option>
                  </select>
                </label>
              </div>
              <button type="submit" [disabled]="submission.busy() || !categoryId">
                Inscribir categoría
              </button>
            </form>
          }
          <app-load-state [res]="participations" emptyText="Sin categorías inscritas."
            ><ng-template>
              @for (p of participations.value() ?? []; track p.id) {
                <article class="panel">
                  <header class="page-head">
                    <h3>{{ p.categoryName }}</h3>
                    <span>
                      <span class="tag" [class.off]="p.status === 'BAJA'">{{
                        participationLabels[p.status]
                      }}</span>
                      · inscrita {{ p.registeredOn }} · costo
                      {{ p.costCents === null ? '—' : (p.costCents | money) }} · entrenadores:
                      {{ p.coaches.join(', ') || '—' }}
                    </span>
                  </header>
                  @if (auth.can('competencias.editar')) {
                    <div class="actions">
                      @if (p.status !== 'BAJA') {
                        <button type="button" class="link danger" (click)="setStatus(p.id, 'BAJA')">
                          Dar de baja
                        </button>
                      }
                      @if (p.status === 'PENDIENTE') {
                        <button type="button" class="link" (click)="setStatus(p.id, 'INSCRITA')">
                          Confirmar inscripción
                        </button>
                      }
                      <button type="button" class="link" (click)="openRoster(p.id)">
                        Plantel ({{ p.rosterSize }})
                      </button>
                    </div>
                  } @else {
                    <button type="button" class="link" (click)="openRoster(p.id)">
                      Ver plantel ({{ p.rosterSize }})
                    </button>
                  }
                  @if (rosterOf() === p.id) {
                    <app-load-state [res]="roster" emptyText="Plantel vacío."
                      ><ng-template>
                        <ul>
                          @for (r of roster.value() ?? []; track r.id) {
                            <li>
                              {{ r.playerName }} · alta {{ r.joinedOn }}
                              @if (r.active) {
                                @if (auth.can('competencias.editar')) {
                                  <button type="button" class="link danger" (click)="leave(r.id)">
                                    Baja
                                  </button>
                                }
                              } @else {
                                <span class="tag off">Baja {{ r.leftOn }}</span>
                              }
                            </li>
                          }
                        </ul>
                      </ng-template></app-load-state
                    >
                    @if (auth.can('competencias.editar') && p.status !== 'BAJA') {
                      <form class="inline-row" (ngSubmit)="join(p.id)" novalidate>
                        <select name="player" [(ngModel)]="playerId" aria-label="Jugador elegible">
                          <option [ngValue]="null">Jugador de {{ p.categoryName }}…</option>
                          @for (e of eligible.value() ?? []; track e.id) {
                            <option [ngValue]="e.id">{{ e.name }}</option>
                          }
                        </select>
                        <button type="submit" [disabled]="!playerId || submission.busy()">
                          Agregar al plantel
                        </button>
                      </form>
                    }
                  }
                </article>
              }
            </ng-template></app-load-state
          >
        }
      </ng-template></app-load-state
    >
  `,
})
export class CompetitionDetailPage {
  readonly id = input.required<Id, unknown>({ transform: numberAttribute });
  private service = inject(CompetitionService);
  private categoryService = inject(CategoryService);
  protected auth = inject(AuthService);
  protected typeLabels = TYPE_LABELS;
  protected statusLabels = COMPETITION_STATUS_LABELS;
  protected participationLabels = PARTICIPATION_LABELS;
  protected competition = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.get(params),
  });
  protected participations = resource({
    params: () => this.id(),
    loader: ({ params }) => this.service.participations({ competitionId: params }),
  });
  protected categories = resource({
    loader: () => this.categoryService.list({ onlyActive: true }),
  });
  protected rosterOf = signal<Id | null>(null);
  protected roster = resource({
    params: () => this.rosterOf() ?? undefined,
    loader: ({ params }) => this.service.roster(params),
  });
  protected eligible = resource({
    params: () => this.rosterOf() ?? undefined,
    loader: ({ params }) => this.service.eligiblePlayers(params),
  });
  protected submission = new Submission();
  protected categoryId: Id | null = null;
  protected registeredOn = today();
  protected cost: number | null = null;
  protected participationStatus: ParticipationStatus = 'INSCRITA';
  protected playerId: Id | null = null;

  openRoster(id: Id): void {
    this.rosterOf.set(this.rosterOf() === id ? null : id);
  }

  async register(): Promise<void> {
    const draft = {
      competitionId: this.id(),
      categoryId: this.categoryId!,
      registeredOn: this.registeredOn,
      costCents:
        this.cost === null || (this.cost as unknown) === '' ? null : centsFromInput(this.cost),
      status: this.participationStatus,
    };
    if (await this.submission.run(() => this.service.register(draft), 'Categoría inscrita.')) {
      this.categoryId = null;
      this.participations.reload();
    }
  }

  async setStatus(id: Id, status: ParticipationStatus): Promise<void> {
    if (status === 'BAJA' && !confirm('¿Dar de baja la participación? Se conserva el historial.'))
      return;
    await this.submission.run(
      () => this.service.setParticipationStatus(id, status),
      'Participación actualizada.',
    );
    this.participations.reload();
  }

  async join(ccId: Id): Promise<void> {
    if (
      await this.submission.run(
        () => this.service.addToRoster(ccId, this.playerId!),
        'Jugador agregado al plantel.',
      )
    ) {
      this.playerId = null;
      this.reloadRoster();
    }
  }

  async leave(entryId: Id): Promise<void> {
    if (!confirm('¿Dar de baja al jugador del plantel?')) return;
    if (await this.submission.run(() => this.service.removeFromRoster(entryId), 'Baja registrada.'))
      this.reloadRoster();
  }

  private reloadRoster(): void {
    this.roster.reload();
    this.eligible.reload();
    this.participations.reload();
  }
}
