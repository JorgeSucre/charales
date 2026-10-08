import { Component, inject } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FieldError } from '../../shared/field-error';
import { Submission } from '../../shared/submission';
import { SubmissionAlert } from '../../shared/ui';

/** HU-005. The backend e-mails the reset link; the UI never reveals whether the e-mail exists. */
@Component({
  selector: 'app-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink, FieldError, SubmissionAlert],
  template: `
    <main class="auth-box">
      <h1>Recuperar contraseña</h1>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label>Correo <input type="email" formControlName="email" autocomplete="email" /></label>
        <app-field-error [control]="form.controls.email" />
        <app-submission-alert [submission]="submission" />
        <button type="submit" [disabled]="submission.busy()">Enviar enlace</button>
      </form>
      <p class="muted">Demo: el correo simulado se muestra en la consola del navegador.</p>
      <a routerLink="/login">Volver</a>
    </main>
  `,
})
export class ForgotPasswordPage {
  private auth = inject(AuthService);
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  submit(): void {
    if (this.form.invalid) return this.form.markAllAsTouched();
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
  Validators.pattern(/^(?=.*[A-Za-zÀ-ÿ])(?=.*\d).+$/),
];

/** HU-005: set a new password with a single-use token (also the initial access of new accounts). */
@Component({
  selector: 'app-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink, FieldError, SubmissionAlert],
  template: `
    <main class="auth-box">
      <h1>Nueva contraseña</h1>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label
          >Nueva contraseña
          <input type="password" formControlName="next" autocomplete="new-password"
        /></label>
        <small class="muted">Mínimo 8 caracteres, con letras y números.</small>
        <app-field-error [control]="form.controls.next" />
        <label
          >Confirmar <input type="password" formControlName="confirm" autocomplete="new-password"
        /></label>
        <app-field-error [control]="form.controls.confirm" />
        <app-submission-alert [submission]="submission" />
        <button type="submit" [disabled]="submission.busy() || done">Guardar</button>
      </form>
      <a routerLink="/login">Ir a iniciar sesión</a>
    </main>
  `,
})
export class ResetPasswordPage {
  private auth = inject(AuthService);
  private token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  protected done = false;
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    next: ['', POLICY],
    confirm: ['', [Validators.required, sameAs('next')]],
  });

  async submit(): Promise<void> {
    this.form.controls.confirm.updateValueAndValidity();
    if (this.form.invalid) return this.form.markAllAsTouched();
    this.done = await this.submission.run(
      () => this.auth.resetPassword(this.token, this.form.getRawValue().next),
      'Contraseña guardada. Ya puedes iniciar sesión.',
    );
  }
}

/** HU-005: change requires the current password. */
@Component({
  selector: 'app-change-password-page',
  imports: [ReactiveFormsModule, FieldError, SubmissionAlert],
  template: `
    <h1>Cambiar contraseña</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="grid-form narrow">
      <label
        >Contraseña actual
        <input type="password" formControlName="current" autocomplete="current-password"
      /></label>
      <app-field-error [control]="form.controls.current" />
      <label
        >Nueva contraseña <input type="password" formControlName="next" autocomplete="new-password"
      /></label>
      <small class="muted">Mínimo 8 caracteres, con letras y números.</small>
      <app-field-error [control]="form.controls.next" />
      <label
        >Confirmar <input type="password" formControlName="confirm" autocomplete="new-password"
      /></label>
      <app-field-error [control]="form.controls.confirm" />
      <app-submission-alert [submission]="submission" />
      <button type="submit" [disabled]="submission.busy()">Guardar</button>
    </form>
  `,
})
export class ChangePasswordPage {
  private auth = inject(AuthService);
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    current: ['', Validators.required],
    next: ['', POLICY],
    confirm: ['', [Validators.required, sameAs('next')]],
  });

  async submit(): Promise<void> {
    this.form.controls.confirm.updateValueAndValidity();
    if (this.form.invalid) return this.form.markAllAsTouched();
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
