import { Component, inject, resource, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Id } from '../../core/models';
import { PlayerService } from '../../core/services/player.service';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';
import { PHONE_PATTERN } from '../../shared/validate';
import { TutorService, TutorView } from './tutor.service';

/**
 * HU-011: tutors with one or more children (N:M); relationship and primary contact belong to each tutor–player pair.
 * HU-012: link a login account to enable the family portal.
 */
@Component({
  selector: 'app-tutors-page',
  imports: [ReactiveFormsModule, FormsModule, RouterLink, FieldError, LoadState, SubmissionAlert],
  template: `
    <h1>Padres / tutores</h1>
    @if (auth.can('tutores.crear') || editing()) {
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form">
        <h2>{{ editing() ? 'Editar tutor' : 'Registrar tutor' }}</h2>
        <label>Nombre(s) <input formControlName="firstName" autocomplete="off" /></label>
        <app-field-error [control]="form.controls.firstName" />
        <div class="two-col">
          <label>Apellido paterno <input formControlName="lastName1" autocomplete="off" /></label>
          <label>Apellido materno <input formControlName="lastName2" autocomplete="off" /></label>
        </div>
        <app-field-error [control]="form.controls.lastName1" />
        <div class="two-col">
          <label>Teléfono <input type="tel" formControlName="phone" autocomplete="off" /></label>
          <label
            >Correo de contacto <input type="email" formControlName="email" autocomplete="off"
          /></label>
        </div>
        <app-field-error [control]="form.controls.phone" />
        <app-field-error [control]="form.controls.email" />
        <label>Dirección <input formControlName="address" autocomplete="off" /></label>

        <fieldset formArrayName="links">
          <legend>Jugadores a cargo</legend>
          @for (link of links.controls; track link; let i = $index) {
            <div class="inline-row" [formGroupName]="i">
              <select formControlName="playerId" aria-label="Jugador">
                <option [ngValue]="null" disabled>Jugador…</option>
                @for (p of players.value() ?? []; track p.id) {
                  <option [ngValue]="p.id">{{ p.name }}</option>
                }
              </select>
              <input
                formControlName="relationship"
                placeholder="Parentesco (madre, abuelo…)"
                aria-label="Parentesco"
              />
              <label class="check"
                ><input type="checkbox" formControlName="isPrimary" /> Principal</label
              >
              <button type="button" class="link danger" (click)="links.removeAt(i)">Quitar</button>
            </div>
          }
          <button type="button" class="secondary" (click)="addLink()">Agregar jugador</button>
        </fieldset>

        <app-submission-alert [submission]="submission" />
        <div class="actions">
          <button type="submit" [disabled]="submission.busy()">Guardar</button>
          @if (editing()) {
            <button type="button" class="secondary" (click)="cancel()">Cancelar</button>
          }
        </div>
      </form>
    }

    @if (editing(); as t) {
      <section class="grid-form">
        <h2>Acceso al portal</h2>
        @if (t.accountEmail) {
          <p>
            Cuenta vinculada: <strong>{{ t.accountEmail }}</strong>
          </p>
          <button type="button" class="secondary" (click)="unlink(t)">Desvincular cuenta</button>
        } @else {
          <p class="muted">
            Se reutiliza la cuenta si el correo ya inicia sesión (por ejemplo, un entrenador); si
            no, se crea y se envía el enlace de acceso inicial.
          </p>
          <label
            >Correo de acceso <input type="email" [(ngModel)]="accountEmail" name="accountEmail"
          /></label>
          <button type="button" (click)="link(t)" [disabled]="submission.busy()">
            Vincular cuenta
          </button>
        }
      </section>
    }

    <div class="filters">
      <label
        >Buscar <input type="search" [ngModel]="query()" (ngModelChange)="query.set($event)"
      /></label>
    </div>
    <app-load-state [res]="tutors"
      ><ng-template>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Contacto</th>
                <th>Jugadores (parentesco)</th>
                <th>Portal</th>
                <th><span class="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              @for (t of tutors.value() ?? []; track t.id) {
                <tr>
                  <td>{{ t.name }}</td>
                  <td>{{ t.phone ?? '' }} {{ t.email ?? '' }}</td>
                  <td class="wrap">
                    @for (l of t.links; track l.playerId) {
                      <a [routerLink]="['/admin/players', l.playerId]">{{ l.playerName }}</a> ({{
                        l.relationship
                      }}{{ l.isPrimary ? ', principal' : '' }})<br />
                    }
                  </td>
                  <td>{{ t.accountEmail ? 'Activo' : '—' }}</td>
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
  private fb = inject(FormBuilder).nonNullable;
  protected players = resource({ loader: () => this.playerService.options() });
  protected query = signal('');
  protected tutors = resource({
    params: () => this.query(),
    loader: ({ params }) => this.service.list(params),
  });
  protected submission = new Submission();
  protected editing = signal<TutorView | null>(null);
  protected accountEmail = '';
  protected form = this.fb.group({
    firstName: ['', Validators.required],
    lastName1: ['', Validators.required],
    lastName2: [''],
    phone: ['', Validators.pattern(PHONE_PATTERN)],
    email: ['', Validators.email],
    address: [''],
    links: this.fb.array([this.linkGroup()]),
  });
  protected links = this.form.controls.links;

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

  edit(t: TutorView): void {
    this.editing.set(t);
    this.accountEmail = t.email ?? '';
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
  }

  cancel(): void {
    this.editing.set(null);
    this.form.reset();
    this.links.clear();
    this.addLink();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
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
    if (
      await this.submission.run(
        () => this.service.save(draft),
        draft.id ? 'Tutor actualizado.' : 'Tutor registrado.',
      )
    ) {
      this.cancel();
      this.tutors.reload();
    }
  }

  async link(t: TutorView): Promise<void> {
    const ok = await this.submission.run(
      () => this.service.linkAccount(t.id, this.accountEmail),
      (r) =>
        r.created
          ? `Cuenta creada y vinculada; se envió el acceso inicial a ${r.email}.`
          : `Cuenta existente ${r.email} vinculada.`,
    );
    if (ok) this.refresh(t.id);
  }

  async unlink(t: TutorView): Promise<void> {
    if (!confirm('¿Desvincular la cuenta? El tutor dejará de ver el portal.')) return;
    if (await this.submission.run(() => this.service.unlinkAccount(t.id), 'Cuenta desvinculada.'))
      this.refresh(t.id);
  }

  private async refresh(id: Id): Promise<void> {
    this.tutors.reload();
    this.editing.set(await this.service.get(id));
  }
}
