import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FieldError } from '../../shared/field-error';
import { Submission } from '../../shared/submission';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, FieldError],
  template: `
    <main class="auth-box">
      <h1>⚽ Escuela de Fútbol Charales</h1>
      <p class="alert info">
        Modo demostración: la contraseña <strong>no se verifica</strong>. Usuarios: admin,
        secretaria, coach o tutor (&#64;charales.mx)
      </p>
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <label>Correo <input type="email" formControlName="email" autocomplete="username" /></label>
        <app-field-error [control]="form.controls.email" />
        <label
          >Contraseña
          <input type="password" formControlName="password" autocomplete="current-password"
        /></label>
        <app-field-error [control]="form.controls.password" />
        @if (submission.result(); as r) {
          @if (!r.ok) {
            <p class="alert error" role="alert">{{ r.text }}</p>
          }
        }
        <button type="submit" [disabled]="submission.busy()">
          {{ submission.busy() ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
      <a routerLink="/forgot-password">¿Olvidaste tu contraseña?</a>
    </main>
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const { email, password } = this.form.getRawValue();
    if (await this.submission.run(() => this.auth.login(email, password), 'Bienvenido')) {
      this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('returnUrl') ?? '/');
    }
  }
}
