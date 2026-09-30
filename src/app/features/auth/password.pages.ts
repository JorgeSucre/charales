import { Component, inject } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FieldError } from '../../shared/field-error';
import { Submission } from '../../shared/submission';

/** HU-005. The backend sends the reset link; the UI never reveals whether the email exists. */
@Component({
  selector: 'app-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink, FieldError],
  template: `
    <main class="auth-box">
      <h1>Recuperar contraseña</h1>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label>Correo <input type="email" formControlName="email" autocomplete="email" /></label>
        <app-field-error [control]="form.controls.email" />
        @if (submission.result(); as r) {
          <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
        }
        <button type="submit" [disabled]="submission.busy()">Enviar enlace</button>
      </form>
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

@Component({
  selector: 'app-change-password-page',
  imports: [ReactiveFormsModule, FieldError],
  template: `
    <h1>Cambiar contraseña</h1>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="narrow">
      <label
        >Contraseña actual
        <input type="password" formControlName="current" autocomplete="current-password"
      /></label>
      <app-field-error [control]="form.controls.current" />
      <label
        >Nueva contraseña <input type="password" formControlName="next" autocomplete="new-password"
      /></label>
      <app-field-error [control]="form.controls.next" />
      <label
        >Confirmar <input type="password" formControlName="confirm" autocomplete="new-password"
      /></label>
      <app-field-error [control]="form.controls.confirm" />
      @if (submission.result(); as r) {
        <p class="alert" [class.ok]="r.ok" [class.error]="!r.ok" role="status">{{ r.text }}</p>
      }
      <button type="submit" [disabled]="submission.busy()">Guardar</button>
    </form>
  `,
})
export class ChangePasswordPage {
  private auth = inject(AuthService);
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    current: ['', Validators.required],
    next: ['', [Validators.required, Validators.minLength(8)]],
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
