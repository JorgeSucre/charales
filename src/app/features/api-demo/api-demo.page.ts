import { Component, inject, resource } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CharalesApi } from '../../core/api/charales-api.service';
import { AuthService } from '../../core/auth/auth.service';
import { fullName } from '../../core/models';
import { SEX_LABELS, STATUS_LABELS } from '../../core/services/player.service';
import { FieldError } from '../../shared/field-error';
import { LoadState } from '../../shared/load-state';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';

/**
 * Lab demo: Angular → (dev-server proxy) → REST API → MariaDB. Reads jugadores and categorias through CharalesApi.
 * The API has its own session (HttpOnly cookie `charales_sid`), separate from the app's login until AuthService is
 * migrated, so this page checks it and asks for an API login when there is none.
 */
@Component({
  selector: 'app-api-demo-page',
  imports: [ReactiveFormsModule, FieldError, LoadState, SubmissionAlert],
  template: `
    <h1>Datos desde la API</h1>
    <p class="alert info">
      Esta página consulta la base <strong>MariaDB</strong> real a través de la API REST (<code
        >GET /api/jugadores</code
      >
      y <code>GET /api/categorias</code>). El resto de la aplicación todavía usa datos simulados. La
      API tiene su propia sesión, guardada en una cookie <em>HttpOnly</em> que maneja el navegador.
    </p>

    <app-load-state [res]="session" [empty]="false"
      ><ng-template>
        @if (session.value(); as s) {
          <section class="panel">
            <div class="page-head">
              <h2>Sesión de la API</h2>
              <button
                type="button"
                class="secondary"
                [disabled]="submission.busy()"
                (click)="logout()"
              >
                Cerrar sesión de la API
              </button>
            </div>
            <p>
              <strong>{{ s.displayName }}</strong> · {{ s.email }} · {{ s.roles.join(', ') }} ·
              vence
              {{ s.expiresAt.replace('T', ' ') }}
            </p>
            <app-submission-alert [submission]="submission" />
          </section>

          <section class="panel">
            <div class="page-head">
              <h2>Jugadores <small class="muted">GET /api/jugadores</small></h2>
              <button type="button" class="secondary" (click)="players.reload()">Recargar</button>
            </div>
            <app-load-state [res]="players" emptyText="La tabla jugadores no tiene registros."
              ><ng-template>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th class="num">Id</th>
                        <th>Identificador</th>
                        <th>Nombre</th>
                        <th>Nacimiento</th>
                        <th>Sexo</th>
                        <th>Estatus</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (p of players.value() ?? []; track p.id) {
                        <tr>
                          <td class="num">{{ p.id }}</td>
                          <td>{{ p.identifier }}</td>
                          <td>{{ name(p) }}</td>
                          <td>{{ p.birthDate }}</td>
                          <td>{{ sexLabels[p.sex] }}</td>
                          <td>
                            <span class="tag" [class.off]="p.status !== 'ACTIVO'">{{
                              statusLabels[p.status]
                            }}</span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <p class="muted">{{ players.value()?.length }} registro(s).</p>
              </ng-template></app-load-state
            >
          </section>

          <section class="panel">
            <div class="page-head">
              <h2>Categorías <small class="muted">GET /api/categorias</small></h2>
              <button type="button" class="secondary" (click)="categories.reload()">
                Recargar
              </button>
            </div>
            <app-load-state [res]="categories" emptyText="La tabla categorias no tiene registros."
              ><ng-template>
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th class="num">Id</th>
                        <th>Nombre</th>
                        <th class="num">Temporada (id)</th>
                        <th class="num">Edades</th>
                        <th class="num">Cupo</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of categories.value() ?? []; track c.id) {
                        <tr>
                          <td class="num">{{ c.id }}</td>
                          <td>{{ c.name }}</td>
                          <td class="num">{{ c.seasonId ?? '—' }}</td>
                          <td class="num">{{ c.minAge }}–{{ c.maxAge }}</td>
                          <td class="num">{{ c.maxCapacity ?? 'Sin límite' }}</td>
                          <td>
                            <span class="tag" [class.off]="!c.active">{{
                              c.active ? 'Activa' : 'Inactiva'
                            }}</span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <p class="muted">{{ categories.value()?.length }} registro(s).</p>
              </ng-template></app-load-state
            >
          </section>
        } @else {
          <form [formGroup]="form" (ngSubmit)="login()" novalidate class="grid-form">
            <h2>Iniciar sesión en la API</h2>
            <p class="muted">
              No hay sesión de la API en este navegador. Usa una cuenta de desarrollo (contraseña
              <strong>demo1234</strong>); la API responde 403 si la cuenta no tiene permiso.
            </p>
            <label
              >Correo <input type="email" formControlName="email" autocomplete="username"
            /></label>
            <app-field-error [control]="form.controls.email" />
            <label
              >Contraseña
              <input type="password" formControlName="password" autocomplete="current-password"
            /></label>
            <app-field-error [control]="form.controls.password" />
            <app-submission-alert [submission]="submission" />
            <div class="actions">
              <button type="submit" [disabled]="submission.busy()">
                {{ submission.busy() ? 'Entrando…' : 'Entrar a la API' }}
              </button>
            </div>
          </form>
        }
      </ng-template></app-load-state
    >
  `,
})
export class ApiDemoPage {
  private api = inject(CharalesApi);
  protected sexLabels = SEX_LABELS;
  protected statusLabels = STATUS_LABELS;
  protected name = fullName;
  protected submission = new Submission();

  /** null = no API session (401): the login form is shown instead of the data. */
  protected session = resource({ loader: () => this.api.session() });
  // Loaded only while there is an API session (undefined params = idle resource, no request).
  protected players = resource({
    params: () => this.session.value()?.sessionId,
    loader: () => this.api.players(),
  });
  protected categories = resource({
    params: () => this.session.value()?.sessionId,
    loader: () => this.api.categories(),
  });

  protected form = inject(FormBuilder).nonNullable.group({
    email: [inject(AuthService).user()?.email ?? '', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  async login(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const { email, password } = this.form.getRawValue();
    if (
      await this.submission.run(() => this.api.login(email, password), 'Sesión de la API iniciada.')
    ) {
      this.form.controls.password.reset();
      this.session.reload();
    }
  }

  async logout(): Promise<void> {
    if (await this.submission.run(() => this.api.logout(), 'Sesión de la API cerrada.'))
      this.session.reload();
  }
}
