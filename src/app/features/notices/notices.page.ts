import { ChangeDetectionStrategy, Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
import { FormPanel } from '../../shared/form-panel';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';
import { CoachService } from '../coaches/coach.service';
import { TutorService } from '../tutors/tutor.service';
import { NoticeService, NoticeView } from './notice.service';

/** <input type="datetime-local"> value ('YYYY-MM-DDTHH:MM') ↔ DATETIME ('…:SS'). */
const toDateTime = (v: string) => (v ? `${v}:00`.slice(0, 19) : null);
const toInput = (v: string | null) => (v ? v.slice(0, 16) : '');

/** HU-057 (title, message, validity, audience, publish/unpublish, by date) + HU-058 (one or several categories). */
@Component({
  selector: 'app-notices-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, LoadState, SubmissionAlert, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Avisos</h1>
        <p class="page-subtitle">
          Comunicados oficiales dirigidos a familias, categorías o entrenadores con vigencia
          programada.
        </p>
      </div>
      @if (auth.can('avisos.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open() && !editingId()"
          aria-controls="notice-form"
        >
          Nuevo aviso
        </button>
      }
    </div>
    <app-submission-alert [submission]="submission" />
    @if (panel.open()) {
      <form
        id="notice-form"
        class="grid-form"
        (ngSubmit)="submit()"
        (keydown.escape)="cancel()"
        novalidate
      >
        <h2>{{ editingId() ? 'Editar aviso' : 'Nuevo aviso' }}</h2>
        <p class="field-hint">
          Los campos con <span class="req" aria-hidden="true">*</span> son obligatorios.
        </p>
        <label
          ><span
            >Título <span class="req" aria-hidden="true">*</span
            ><span class="sr-only"> (obligatorio)</span></span
          >
          <input name="title" [(ngModel)]="draft.title" maxlength="200"
        /></label>
        <label
          ><span
            >Mensaje <span class="req" aria-hidden="true">*</span
            ><span class="sr-only"> (obligatorio)</span></span
          >
          <textarea name="message" rows="4" [(ngModel)]="draft.message"></textarea>
        </label>
        <div class="two-col">
          <label
            >Visible desde <input type="datetime-local" name="from" [(ngModel)]="draft.startsAt"
          /></label>
          <label
            >Visible hasta <input type="datetime-local" name="to" [(ngModel)]="draft.endsAt"
          /></label>
        </div>
        <fieldset class="stack">
          <legend>Audiencia (sin selección = general: todas las familias y entrenadores)</legend>
          <div class="two-col">
            <label
              >Categorías
              <select multiple size="4" name="cats" [(ngModel)]="draft.categoryIds">
                @for (c of categories.value() ?? []; track c.id) {
                  <option [ngValue]="c.id">{{ c.name }} · {{ c.seasonName ?? '' }}</option>
                }
              </select>
            </label>
            <label
              >Tutores específicos
              <select multiple size="4" name="tutors" [(ngModel)]="draft.tutorIds">
                @for (t of tutors.value() ?? []; track t.id) {
                  <option [ngValue]="t.id">{{ t.name }}</option>
                }
              </select>
            </label>
            <label
              >Entrenadores específicos
              <select multiple size="4" name="coaches" [(ngModel)]="draft.coachIds">
                @for (c of coaches.value() ?? []; track c.id) {
                  <option [ngValue]="c.id">{{ c.name }}</option>
                }
              </select>
            </label>
          </div>
        </fieldset>
        <label class="check"
          ><input type="checkbox" name="pub" [(ngModel)]="draft.published" /> Publicado</label
        >
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
          </button>
          <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
        </div>
      </form>
    }
    <div class="filters">
      <label class="filter-grow"
        >Buscar
        <input
          type="search"
          placeholder="Título, mensaje o audiencia…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
      /></label>
      <label
        >Estado
        <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
          <option value="ALL">Todos</option>
          <option value="CURRENT">Vigentes</option>
          <option value="DRAFT">No publicados</option>
        </select>
      </label>
      @if (hasFilters()) {
        <button type="button" class="secondary sm" (click)="clearFilters()">Limpiar filtros</button>
      }
    </div>
    <app-load-state [res]="notices" emptyText="Sin avisos registrados."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ filteredNotices().length }}</strong> de
            <strong class="tabular">{{ (notices.value() ?? []).length }}</strong> avisos
          </p>
        </div>
        @if (filteredNotices().length === 0) {
          <p class="empty">Sin avisos que coincidan con el filtro.</p>
        } @else {
          @for (n of filteredNotices(); track n.id) {
            <article class="panel" [class.muted]="!n.published">
              <div class="panel-head-row">
                <h3>{{ n.title }}</h3>
                @if (!n.published) {
                  <span class="tag neutral">No publicado</span>
                } @else if (n.current) {
                  <span class="tag ok">Vigente</span>
                } @else {
                  <span class="tag warn">Fuera de vigencia</span>
                }
              </div>
              <p class="pre">{{ n.message }}</p>
              <p class="muted">
                <span class="tabular">{{ n.publishedAt | date: 'd MMM y, HH:mm' }}</span> ·
                <strong>{{ n.audience.join(', ') }}</strong> · Vigencia:
                <span class="tabular">{{ n.startsAt ? (n.startsAt | date: 'd MMM y') : '—' }}</span>
                a
                <span class="tabular">{{ n.endsAt ? (n.endsAt | date: 'd MMM y') : 'sin fin' }}</span>
              </p>
              @if (auth.can('avisos.editar')) {
                <div class="actions">
                  <button type="button" class="link" (click)="edit(n)">Editar</button>
                  <button type="button" class="link" (click)="publish(n)">
                    {{ n.published ? 'Despublicar' : 'Publicar' }}
                  </button>
                </div>
              }
            </article>
          }
        }
      </ng-template></app-load-state
    >
  `,
})
export class NoticesPage {
  private service = inject(NoticeService);
  private categoryService = inject(CategoryService);
  private tutorService = inject(TutorService);
  private coachService = inject(CoachService);
  protected auth = inject(AuthService);
  protected notices = resource({ loader: () => this.service.list() });
  protected categories = resource({
    loader: () => this.categoryService.list({ onlyActive: true }),
  });
  protected tutors = resource({ loader: () => this.tutorService.list() });
  protected coaches = resource({ loader: () => this.coachService.list({ onlyActive: true }) });
  protected query = signal('');
  protected statusFilter = signal<'ALL' | 'CURRENT' | 'DRAFT'>('ALL');
  protected hasFilters = computed(() => !!this.query().trim() || this.statusFilter() !== 'ALL');
  protected filteredNotices = computed(() => {
    const q = this.query().trim().toLowerCase();
    const st = this.statusFilter();
    return (this.notices.value() ?? []).filter((n) => {
      if (st === 'CURRENT' && (!n.published || !n.current)) return false;
      if (st === 'DRAFT' && n.published) return false;
      if (q) {
        const hay = `${n.title} ${n.message} ${n.audience.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });
  protected submission = new Submission();
  protected editingId = signal<Id | null>(null);
  protected draft = this.blank();
  /** The draft as it was when the form opened: anything else is an unsaved change. */
  private opened = '';
  protected panel = new FormPanel('notice-form', () => JSON.stringify(this.draft) !== this.opened);

  clearFilters(): void {
    this.query.set('');
    this.statusFilter.set('ALL');
  }

  private blank() {
    return {
      title: '',
      message: '',
      startsAt: '',
      endsAt: '',
      published: true,
      categoryIds: [] as Id[],
      tutorIds: [] as Id[],
      coachIds: [] as Id[],
    };
  }

  /** Opens an empty form (asks first if the open one has unsaved changes). */
  create(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.open();
  }

  edit(n: NoticeView): void {
    if (!this.panel.close()) return;
    this.editingId.set(n.id);
    const ids = (k: 'categoryId' | 'tutorId' | 'coachId') =>
      n.recipients.map((r) => r[k]).filter((x): x is Id => x !== null);
    this.draft = {
      title: n.title,
      message: n.message,
      startsAt: toInput(n.startsAt),
      endsAt: toInput(n.endsAt),
      published: n.published,
      categoryIds: ids('categoryId'),
      tutorIds: ids('tutorId'),
      coachIds: ids('coachId'),
    };
    this.open();
  }

  /** Closes the form without saving (asks first if it has unsaved changes); the notice is untouched. */
  cancel(): void {
    if (this.panel.close()) this.reset();
  }

  private open(): void {
    this.opened = JSON.stringify(this.draft);
    this.submission.result.set(null);
    this.panel.show();
  }

  private reset(): void {
    this.editingId.set(null);
    this.draft = this.blank();
  }

  async submit(): Promise<void> {
    const d = this.draft;
    const draft = {
      ...d,
      id: this.editingId() ?? undefined,
      startsAt: toDateTime(d.startsAt),
      endsAt: toDateTime(d.endsAt),
    };
    if (await this.submission.run(() => this.service.save(draft), 'Aviso guardado.')) {
      this.panel.done();
      this.reset();
      this.notices.reload();
    }
  }

  async publish(n: NoticeView): Promise<void> {
    await this.submission.run(
      () => this.service.setPublished(n.id, !n.published),
      n.published ? 'Aviso despublicado.' : 'Aviso publicado.',
    );
    this.notices.reload();
  }
}
