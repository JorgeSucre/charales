import { Component, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { CategoryService } from '../../core/services/category.service';
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
  imports: [FormsModule, LoadState, SubmissionAlert, DatePipe],
  template: `
    <h1>Avisos</h1>
    @if (auth.can('avisos.crear') || editingId()) {
      <form class="grid-form" (ngSubmit)="submit()" novalidate>
        <h2>{{ editingId() ? 'Editar aviso' : 'Nuevo aviso' }}</h2>
        <label>Título <input name="title" [(ngModel)]="draft.title" maxlength="200" /></label>
        <label
          >Mensaje <textarea name="message" rows="4" [(ngModel)]="draft.message"></textarea>
        </label>
        <div class="two-col">
          <label
            >Visible desde <input type="datetime-local" name="from" [(ngModel)]="draft.startsAt"
          /></label>
          <label
            >Visible hasta <input type="datetime-local" name="to" [(ngModel)]="draft.endsAt"
          /></label>
        </div>
        <fieldset>
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
        <app-submission-alert [submission]="submission" />
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          @if (editingId()) {
            <button type="button" class="secondary" (click)="reset()">Cancelar</button>
          }
        </div>
      </form>
    }
    <app-load-state [res]="notices" emptyText="Sin avisos."
      ><ng-template>
        @for (n of notices.value() ?? []; track n.id) {
          <article class="panel">
            <header class="page-head">
              <h3>{{ n.title }}</h3>
              <span>
                @if (!n.published) {
                  <span class="tag off">No publicado</span>
                } @else if (n.current) {
                  <span class="tag">Vigente</span>
                } @else {
                  <span class="tag off">Fuera de vigencia</span>
                }
              </span>
            </header>
            <p class="pre">{{ n.message }}</p>
            <p class="muted">
              {{ n.publishedAt | date: 'd MMM y, HH:mm' }} · {{ n.audience.join(', ') }} · vigencia
              {{ n.startsAt ? (n.startsAt | date: 'd MMM y') : '—' }} a
              {{ n.endsAt ? (n.endsAt | date: 'd MMM y') : 'sin fin' }}
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
  protected submission = new Submission();
  protected editingId = signal<Id | null>(null);
  protected draft = this.blank();

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

  edit(n: NoticeView): void {
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
  }

  reset(): void {
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
