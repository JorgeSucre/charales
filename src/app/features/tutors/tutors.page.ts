import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { PlayerService } from '../../core/services/player.service';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { focusFirstInvalid } from '../../shared/focus';
import { FormPanel } from '../../shared/form-panel';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';
import { emailValidator, personNameValidator, phoneValidator } from '../../shared/validate';
import { TutorService, TutorView } from './tutor.service';

/**
 * HU-011: tutors with one or more children (N:M); relationship and primary contact belong to each tutor–player pair.
 * HU-012: link a login account to enable the family portal.
 */
@Component({
  selector: 'app-tutors-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    FieldError,
    FieldA11y,
    LoadState,
    SubmissionAlert,
  ],
  template: `
    <div class="page-head">
      <div>
        <h1>Padres / tutores</h1>
        <p class="page-subtitle">
          Directorio de contactos familiares, vínculos por jugador y acceso al portal familiar.
        </p>
      </div>
      @if (auth.can('tutores.crear')) {
        <button
          type="button"
          (click)="create()"
          [attr.aria-expanded]="panel.open() && !editing()"
          aria-controls="tutor-form"
        >
          Registrar tutor
        </button>
      }
    </div>

    <app-submission-alert [submission]="submission" />

    @if (panel.open()) {
      <section
        class="panel tutor-workspace"
        [class.with-portal]="!!editing()"
        (keydown.escape)="cancel()"
      >
        <div class="tutor-workspace-grid">
          <form
            id="tutor-form"
            [formGroup]="form"
            (ngSubmit)="submit()"
            novalidate
            class="grid-form"
          >
            <h2>{{ editing() ? 'Editar tutor' : 'Registrar tutor' }}</h2>
            <p class="field-hint">
              Los campos marcados con <span class="req" aria-hidden="true">*</span> son
              obligatorios. Un tutor puede estar vinculado a varios jugadores.
            </p>

            <div>
              <label
                ><span
                  >Nombre(s) <span class="req" aria-hidden="true">*</span
                  ><span class="sr-only"> (obligatorio)</span></span
                >
                <input formControlName="firstName" autocomplete="off"
              /></label>
              <app-field-error [control]="form.controls.firstName" />
            </div>

            <div class="two-col">
              <div>
                <label
                  ><span
                    >Apellido paterno <span class="req" aria-hidden="true">*</span
                    ><span class="sr-only"> (obligatorio)</span></span
                  >
                  <input formControlName="lastName1" autocomplete="off"
                /></label>
                <app-field-error [control]="form.controls.lastName1" />
              </div>
              <div>
                <label
                  >Apellido materno <input formControlName="lastName2" autocomplete="off"
                /></label>
                <app-field-error [control]="form.controls.lastName2" />
              </div>
            </div>

            <div class="two-col">
              <div>
                <label
                  >Teléfono
                  <input
                    type="tel"
                    formControlName="phone"
                    placeholder="33 1234 5678"
                    autocomplete="off"
                  />
                </label>
                <app-field-error [control]="form.controls.phone" />
              </div>
              <div>
                <label
                  >Correo de contacto
                  <input
                    type="email"
                    formControlName="email"
                    placeholder="familia@ejemplo.com"
                    autocomplete="off"
                  />
                </label>
                <app-field-error [control]="form.controls.email" />
              </div>
            </div>

            <label>Dirección <input formControlName="address" autocomplete="off" /></label>

            <fieldset formArrayName="links" class="stack">
              <legend>Jugadores a cargo</legend>
              <p class="field-hint">
                Indica el parentesco con cada jugador y marca <strong>Principal</strong> cuando sea
                el contacto prioritario para ese jugador.
              </p>
              <div class="link-list">
                @for (link of links.controls; track link; let i = $index) {
                  <div class="link-row" [formGroupName]="i">
                    <div class="inline-row">
                      <select formControlName="playerId" aria-label="Jugador">
                        <option [ngValue]="null" disabled>Selecciona jugador…</option>
                        @for (p of players.value() ?? []; track p.id) {
                          <option [ngValue]="p.id">{{ p.name }}</option>
                        }
                      </select>
                      <input
                        formControlName="relationship"
                        placeholder="Parentesco (madre, padre, abuelo…)"
                        aria-label="Parentesco"
                      />
                      <label class="check"
                        ><input type="checkbox" formControlName="isPrimary" /> Principal</label
                      >
                      <button type="button" class="link danger" (click)="links.removeAt(i)">
                        Quitar
                      </button>
                    </div>
                    <app-field-error [control]="link.controls.playerId" label="Jugador" />
                    <app-field-error [control]="link.controls.relationship" label="Parentesco" />
                  </div>
                }
              </div>
              <div>
                <button type="button" class="secondary sm" (click)="addLink()">
                  Agregar otro jugador
                </button>
              </div>
            </fieldset>

            @if (!editing()) {
              <p class="field-hint">
                El acceso al portal familiar se vincula una vez guardado el registro del tutor.
              </p>
            }

            <div class="actions">
              <button type="submit" [disabled]="submission.busy()">
                {{ submission.busy() ? 'Guardando…' : 'Guardar' }}
              </button>
              <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
            </div>
          </form>

          @if (editing(); as t) {
            <aside class="portal-panel" aria-labelledby="portal-heading">
              <div class="portal-panel-head">
                <h2 id="portal-heading">Acceso al portal familiar</h2>
                @if (t.accountEmail) {
                  <span class="tag ok">Activo</span>
                } @else {
                  <span class="tag neutral">Sin acceso</span>
                }
              </div>

              @if (t.accountEmail) {
                <p class="muted">
                  Este tutor puede iniciar sesión para consultar el expediente, agenda, asistencia y
                  estado de cuenta de sus jugadores vinculados.
                </p>
                <div class="account-box">
                  <span class="account-box-label">Cuenta vinculada</span>
                  <strong>{{ t.accountEmail }}</strong>
                </div>
                <div class="actions">
                  <button
                    type="button"
                    class="secondary"
                    [disabled]="submission.busy()"
                    (click)="unlink(t)"
                  >
                    Desvincular cuenta
                  </button>
                </div>
              } @else {
                <p class="muted">
                  Se reutiliza la cuenta si el correo ya inicia sesión (por ejemplo, un entrenador);
                  si no existe, se crea y se envía el enlace de acceso inicial.
                </p>
                <label
                  >Correo de acceso
                  <input
                    type="email"
                    [ngModel]="accountEmail()"
                    (ngModelChange)="accountEmail.set($event)"
                    name="accountEmail"
                    placeholder="correo@ejemplo.com"
                  />
                </label>
                <div class="actions">
                  <button
                    type="button"
                    (click)="link(t)"
                    [disabled]="submission.busy() || !accountEmail().trim()"
                  >
                    Vincular cuenta
                  </button>
                </div>
              }
            </aside>
          }
        </div>
      </section>
    }

    <div class="filters">
      <label class="filter-grow"
        >Buscar tutor
        <input
          type="search"
          placeholder="Nombre, teléfono o correo…"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
        />
      </label>
      @if (query().trim()) {
        <button type="button" class="secondary sm" (click)="query.set('')">Limpiar</button>
      }
    </div>

    <app-load-state [res]="tutors" emptyText="No se encontraron tutores con ese criterio."
      ><ng-template>
        <div class="list-meta">
          <p class="muted">
            Mostrando <strong class="tabular">{{ (tutors.value() ?? []).length }}</strong>
            {{ (tutors.value() ?? []).length === 1 ? 'tutor' : 'tutores' }}
          </p>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tutor</th>
                <th>Contacto</th>
                <th>Jugadores vinculados</th>
                <th>Portal familiar</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (t of tutors.value() ?? []; track t.id) {
                <tr>
                  <td>
                    <strong>{{ t.name }}</strong>
                    @if (t.address) {
                      <div class="cell-sub">{{ t.address }}</div>
                    }
                  </td>
                  <td>
                    @if (t.phone || t.email) {
                      @if (t.phone) {
                        <div class="tabular">{{ t.phone }}</div>
                      }
                      @if (t.email) {
                        <div class="cell-sub">{{ t.email }}</div>
                      }
                    } @else {
                      <span class="muted">Sin datos</span>
                    }
                  </td>
                  <td class="wrap">
                    @if (t.links.length) {
                      <ul class="tutor-links-cell">
                        @for (l of t.links; track l.playerId) {
                          <li>
                            <a [routerLink]="['/admin/players', l.playerId]">{{ l.playerName }}</a>
                            <span class="muted">· {{ l.relationship }}</span>
                            @if (l.isPrimary) {
                              <span class="tag ok">Principal</span>
                            }
                          </li>
                        }
                      </ul>
                    } @else {
                      <span class="muted">Sin jugadores</span>
                    }
                  </td>
                  <td>
                    @if (t.accountEmail) {
                      <span class="tag ok">Activo</span>
                      <div class="cell-sub">{{ t.accountEmail }}</div>
                    } @else {
                      <span class="tag neutral">Sin acceso</span>
                    }
                  </td>
                  <td>
                    @if (auth.can('tutores.editar')) {
                      <button type="button" class="link" (click)="edit(t)">Editar</button>
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
export class TutorsPage {
  private service = inject(TutorService);
  private playerService = inject(PlayerService);
  protected auth = inject(AuthService);
  /** `?nuevo=1` (a quick task of the Tablero) opens the create form at once, if the role may create. */
  private openOnArrival = inject(ActivatedRoute).snapshot.queryParamMap.has('nuevo')
    ? setTimeout(() => this.auth.can('tutores.crear') && this.create())
    : null;
  private fb = inject(FormBuilder).nonNullable;
  protected players = resource({ loader: () => this.playerService.options() });
  protected query = signal('');
  protected tutors = resource({
    params: () => this.query(),
    loader: ({ params }) => this.service.list(params),
  });
  protected submission = new Submission();
  protected editing = signal<TutorView | null>(null);
  protected accountEmail = signal('');
  protected form = this.fb.group({
    firstName: ['', [Validators.required, personNameValidator]],
    lastName1: ['', [Validators.required, personNameValidator]],
    lastName2: ['', personNameValidator],
    phone: ['', phoneValidator],
    email: ['', emailValidator],
    address: [''],
    links: this.fb.array([this.linkGroup()]),
  });
  protected links = this.form.controls.links;
  protected panel = new FormPanel('tutor-form', () => this.form.dirty);

  private linkGroup(playerId: Id | null = null, relationship = '', isPrimary = false) {
    return this.fb.group({
      playerId: [playerId as Id | null, Validators.required],
      relationship: [relationship, Validators.required],
      isPrimary: [isPrimary],
    });
  }

  addLink(): void {
    this.links.push(this.linkGroup());
  }

  /** Opens an empty form (asks first if the open one has unsaved changes). */
  create(): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.panel.show();
  }

  edit(t: TutorView): void {
    if (!this.panel.close()) return;
    this.reset();
    this.submission.result.set(null);
    this.editing.set(t);
    this.accountEmail.set(t.email ?? '');
    this.links.clear();
    for (const l of t.links)
      this.links.push(this.linkGroup(l.playerId, l.relationship, l.isPrimary));
    this.form.patchValue({
      firstName: t.firstName,
      lastName1: t.lastName1,
      lastName2: t.lastName2 ?? '',
      phone: t.phone ?? '',
      email: t.email ?? '',
      address: t.address ?? '',
    });
    this.panel.show();
  }

  /** Closes the form without saving (asks first if it has unsaved changes); the record is untouched. */
  cancel(): void {
    if (this.panel.close()) this.reset();
  }

  private reset(): void {
    this.editing.set(null);
    this.accountEmail.set('');
    this.form.reset();
    this.links.clear();
    this.addLink();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(document.getElementById('tutor-form')!));
      return;
    }
    const { links, ...rest } = this.form.getRawValue();
    const draft = {
      ...rest,
      id: this.editing()?.id,
      links: links.map((l) => ({
        playerId: l.playerId!,
        relationship: l.relationship,
        isPrimary: l.isPrimary,
      })),
    };
    // HU-011: the primary contact is optional, so leaving a player without one is allowed, but never silently.
    const orphaned = (this.editing()?.links ?? []).filter(
      (l) => l.isPrimary && !draft.links.some((n) => n.playerId === l.playerId && n.isPrimary),
    );
    if (
      orphaned.length &&
      !confirm(
        `${orphaned.map((l) => l.playerName).join(', ')} quedará sin contacto principal. ` +
          'Puedes asignarlo después desde el expediente. ¿Guardar de todos modos?',
      )
    )
      return;
    if (
      await this.submission.run(
        () => this.service.save(draft),
        draft.id ? 'Tutor actualizado.' : 'Tutor registrado.',
      )
    ) {
      this.panel.done();
      this.reset();
      this.tutors.reload();
    }
  }

  async link(t: TutorView): Promise<void> {
    const ok = await this.submission.run(
      () => this.service.linkAccount(t.id, this.accountEmail()),
      (r) =>
        r.created
          ? `Cuenta creada y vinculada; se envió el acceso inicial a ${r.email}.`
          : `Cuenta existente ${r.email} vinculada.`,
    );
    if (ok) await this.refresh(t.id);
  }

  async unlink(t: TutorView): Promise<void> {
    if (!confirm('¿Desvincular la cuenta? El tutor dejará de ver el portal.')) return;
    if (await this.submission.run(() => this.service.unlinkAccount(t.id), 'Cuenta desvinculada.'))
      await this.refresh(t.id);
  }

  private async refresh(id: Id): Promise<void> {
    this.tutors.reload();
    const fresh = await this.service.get(id);
    this.editing.set(fresh);
    if (fresh && !fresh.accountEmail) this.accountEmail.set(fresh.email ?? '');
  }
}
