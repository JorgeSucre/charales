import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { focusFirstInvalid } from '../../shared/focus';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';

/** HU-005. The backend e-mails the reset link; the UI never reveals whether the e-mail exists. */
@Component({
  selector: 'app-forgot-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, FieldError, FieldA11y, SubmissionAlert],
  template: `
    <div class="auth-shell">
      <main class="auth-box">
        <div class="auth-brand">
          <img src="brand/CHCH23logo.webp" alt="Escudo de Charales" width="56" height="56" />
          <div>
            <p class="auth-eyebrow">Escuela Formativa Charales</p>
            <h1>Recuperar contraseña</h1>
          </div>
        </div>
        <p class="auth-subtitle">
          Escribe tu correo registrado y te enviaremos un enlace temporal para restablecerla.
        </p>

        <form #formEl [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div>
            <label
              >Correo electrónico
              <input
                type="email"
                formControlName="email"
                autocomplete="email"
                placeholder="nombre@ejemplo.com"
              />
            </label>
            <app-field-error [control]="form.controls.email" />
          </div>

          <app-submission-alert [submission]="submission" />

          <button type="submit" class="auth-submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Enviando…' : 'Enviar enlace' }}
          </button>
        </form>

        <p class="auth-note">
          Entorno demo: el enlace simulado se imprime en la consola del navegador.
        </p>
        <div class="auth-footer">
          <a routerLink="/login">Volver a iniciar sesión</a>
        </div>
      </main>
    </div>
  `,
})
export class ForgotPasswordPage {
  private auth = inject(AuthService);
  private formEl = viewChild.required<ElementRef<HTMLFormElement>>('formEl');
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(this.formEl().nativeElement));
      return;
    }
    this.submission.run(
      () => this.auth.requestPasswordReset(this.form.getRawValue().email),
      'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.',
    );
  }
}

const sameAs =
  (other: string) =>
  (c: AbstractControl): ValidationErrors | null =>
    c.parent && c.value !== c.parent.get(other)?.value ? { mismatch: true } : null;

/** Policy shown in the form; AuthService enforces the same (passwordProblem). */
const POLICY = [
  Validators.required,
  Validators.minLength(8),
  (c: AbstractControl): ValidationErrors | null =>
    !c.value || /^(?=.*[A-Za-zÀ-ÿ])(?=.*\d).+$/.test(c.value) ? null : { passwordPolicy: true },
];

/** HU-005: set a new password with a single-use token (also the initial access of new accounts). */
@Component({
  selector: 'app-reset-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, FieldError, FieldA11y, SubmissionAlert],
  template: `
    <div class="auth-shell">
      <main class="auth-box">
        <div class="auth-brand">
          <img src="brand/CHCH23logo.webp" alt="Escudo de Charales" width="56" height="56" />
          <div>
            <p class="auth-eyebrow">Escuela Formativa Charales</p>
            <h1>Nueva contraseña</h1>
          </div>
        </div>
        <p class="auth-subtitle">Define una contraseña nueva para acceder a tu cuenta.</p>

        <form #formEl [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div>
            <label
              >Nueva contraseña
              <div class="password-field">
                <input
                  [type]="showNext() ? 'text' : 'password'"
                  formControlName="next"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="password-toggle"
                  (click)="showNext.set(!showNext())"
                  [attr.aria-pressed]="showNext()"
                  [attr.aria-label]="
                    showNext() ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'
                  "
                >
                  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                    @if (showNext()) {
                      <path
                        d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9.3 3.1 11 8a11.7 11.7 0 0 1-3.2 4.9M6.6 6.6A11.7 11.7 0 0 0 1 12c1.7 4.9 6 8 11 8a10.9 10.9 0 0 0 4-.7"
                      />
                    } @else {
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    }
                  </svg>
                </button>
              </div>
            </label>
            <small class="muted">Mínimo 8 caracteres, con letras y números.</small>
            <app-field-error [control]="form.controls.next" />
          </div>

          <div>
            <label
              >Confirmar contraseña
              <div class="password-field">
                <input
                  [type]="showConfirm() ? 'text' : 'password'"
                  formControlName="confirm"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="password-toggle"
                  (click)="showConfirm.set(!showConfirm())"
                  [attr.aria-pressed]="showConfirm()"
                  [attr.aria-label]="
                    showConfirm() ? 'Ocultar confirmación' : 'Mostrar confirmación'
                  "
                >
                  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                    @if (showConfirm()) {
                      <path
                        d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9.3 3.1 11 8a11.7 11.7 0 0 1-3.2 4.9M6.6 6.6A11.7 11.7 0 0 0 1 12c1.7 4.9 6 8 11 8a10.9 10.9 0 0 0 4-.7"
                      />
                    } @else {
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    }
                  </svg>
                </button>
              </div>
            </label>
            <app-field-error [control]="form.controls.confirm" />
          </div>

          <app-submission-alert [submission]="submission" />

          <button type="submit" class="auth-submit" [disabled]="submission.busy() || done()">
            {{ submission.busy() ? 'Guardando…' : 'Guardar contraseña' }}
          </button>
        </form>

        <div class="auth-footer">
          <a routerLink="/login">Ir a iniciar sesión</a>
        </div>
      </main>
    </div>
  `,
})
export class ResetPasswordPage {
  private auth = inject(AuthService);
  private formEl = viewChild.required<ElementRef<HTMLFormElement>>('formEl');
  private token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  protected done = signal(false);
  protected showNext = signal(false);
  protected showConfirm = signal(false);
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    next: ['', POLICY],
    confirm: ['', [Validators.required, sameAs('next')]],
  });

  async submit(): Promise<void> {
    this.form.controls.confirm.updateValueAndValidity();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(this.formEl().nativeElement));
      return;
    }
    this.done.set(
      await this.submission.run(
        () => this.auth.resetPassword(this.token, this.form.getRawValue().next),
        'Contraseña guardada. Ya puedes iniciar sesión.',
      ),
    );
  }
}

/** HU-005: change requires the current password. */
@Component({
  selector: 'app-change-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FieldError, FieldA11y, SubmissionAlert],
  template: `
    <div class="page-head">
      <h1>Cambiar contraseña</h1>
    </div>
    <form #formEl [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form narrow">
      <div>
        <label
          >Contraseña actual
          <div class="password-field">
            <input
              [type]="showCurrent() ? 'text' : 'password'"
              formControlName="current"
              autocomplete="current-password"
            />
            <button
              type="button"
              class="password-toggle"
              (click)="showCurrent.set(!showCurrent())"
              [attr.aria-pressed]="showCurrent()"
              [attr.aria-label]="
                showCurrent() ? 'Ocultar contraseña actual' : 'Mostrar contraseña actual'
              "
            >
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                @if (showCurrent()) {
                  <path
                    d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9.3 3.1 11 8a11.7 11.7 0 0 1-3.2 4.9M6.6 6.6A11.7 11.7 0 0 0 1 12c1.7 4.9 6 8 11 8a10.9 10.9 0 0 0 4-.7"
                  />
                } @else {
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                }
              </svg>
            </button>
          </div>
        </label>
        <app-field-error [control]="form.controls.current" />
      </div>

      <div>
        <label
          >Nueva contraseña
          <div class="password-field">
            <input
              [type]="showNext() ? 'text' : 'password'"
              formControlName="next"
              autocomplete="new-password"
            />
            <button
              type="button"
              class="password-toggle"
              (click)="showNext.set(!showNext())"
              [attr.aria-pressed]="showNext()"
              [attr.aria-label]="
                showNext() ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'
              "
            >
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                @if (showNext()) {
                  <path
                    d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9.3 3.1 11 8a11.7 11.7 0 0 1-3.2 4.9M6.6 6.6A11.7 11.7 0 0 0 1 12c1.7 4.9 6 8 11 8a10.9 10.9 0 0 0 4-.7"
                  />
                } @else {
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                }
              </svg>
            </button>
          </div>
        </label>
        <small class="muted">Mínimo 8 caracteres, con letras y números.</small>
        <app-field-error [control]="form.controls.next" />
      </div>

      <div>
        <label
          >Confirmar contraseña
          <div class="password-field">
            <input
              [type]="showConfirm() ? 'text' : 'password'"
              formControlName="confirm"
              autocomplete="new-password"
            />
            <button
              type="button"
              class="password-toggle"
              (click)="showConfirm.set(!showConfirm())"
              [attr.aria-pressed]="showConfirm()"
              [attr.aria-label]="showConfirm() ? 'Ocultar confirmación' : 'Mostrar confirmación'"
            >
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                @if (showConfirm()) {
                  <path
                    d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.9 10.9 0 0 1 12 4c5 0 9.3 3.1 11 8a11.7 11.7 0 0 1-3.2 4.9M6.6 6.6A11.7 11.7 0 0 0 1 12c1.7 4.9 6 8 11 8a10.9 10.9 0 0 0 4-.7"
                  />
                } @else {
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                }
              </svg>
            </button>
          </div>
        </label>
        <app-field-error [control]="form.controls.confirm" />
      </div>

      <app-submission-alert [submission]="submission" />

      <div class="actions">
        <button type="submit" [disabled]="submission.busy()">
          {{ submission.busy() ? 'Guardando…' : 'Guardar contraseña' }}
        </button>
      </div>
    </form>
  `,
})
export class ChangePasswordPage {
  private auth = inject(AuthService);
  private formEl = viewChild.required<ElementRef<HTMLFormElement>>('formEl');
  protected showCurrent = signal(false);
  protected showNext = signal(false);
  protected showConfirm = signal(false);
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    current: ['', Validators.required],
    next: ['', POLICY],
    confirm: ['', [Validators.required, sameAs('next')]],
  });

  async submit(): Promise<void> {
    this.form.controls.confirm.updateValueAndValidity();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(this.formEl().nativeElement));
      return;
    }
    const { current, next } = this.form.getRawValue();
    if (
      await this.submission.run(
        () => this.auth.changePassword(current, next),
        'Contraseña actualizada.',
      )
    ) {
      this.form.reset();
    }
  }
}
