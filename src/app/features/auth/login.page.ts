import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FieldA11y, FieldError } from '../../shared/field-error';
import { focusFirstInvalid } from '../../shared/focus';
import { Submission } from '../../shared/submission';

/** HU-001/002/003: one login for every role; the landing page depends on the roles/profiles of the account. */
@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, FieldError, FieldA11y],
  template: `
    <div class="auth-shell">
      <main class="auth-box">
        <div class="auth-brand">
          <img src="brand/CHCH23logo.webp" alt="Escudo de Charales" width="56" height="56" />
          <div>
            <p class="auth-eyebrow">Escuela Formativa Charales</p>
            <h1>Iniciar sesión</h1>
          </div>
        </div>
        <p class="auth-subtitle">
          Ingresa con tu correo y contraseña para acceder a la plataforma.
        </p>

        @if (expired) {
          <p class="alert info" role="status">Tu sesión expiró. Vuelve a iniciar sesión.</p>
        }

        <form #formEl [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div>
            <label
              >Correo electrónico
              <input
                type="email"
                formControlName="email"
                autocomplete="username"
                placeholder="nombre@ejemplo.com"
              />
            </label>
            <app-field-error [control]="form.controls.email" />
          </div>

          <div>
            <label
              >Contraseña
              <div class="password-field">
                <input
                  [type]="showPassword() ? 'text' : 'password'"
                  formControlName="password"
                  autocomplete="current-password"
                />
                <button
                  type="button"
                  class="password-toggle"
                  (click)="showPassword.set(!showPassword())"
                  [attr.aria-pressed]="showPassword()"
                  [attr.aria-label]="showPassword() ? 'Ocultar contraseña' : 'Mostrar contraseña'"
                >
                  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                    @if (showPassword()) {
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
            <app-field-error [control]="form.controls.password" />
          </div>

          @if (submission.result(); as r) {
            @if (!r.ok) {
              <p class="alert error" role="alert">{{ r.text }}</p>
            }
          }

          <button type="submit" class="auth-submit" [disabled]="submission.busy()">
            {{ submission.busy() ? 'Entrando…' : 'Entrar' }}
          </button>
        </form>

        <div class="auth-footer">
          <a routerLink="/forgot-password">¿Olvidaste tu contraseña?</a>
        </div>
      </main>
    </div>
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private formEl = viewChild.required<ElementRef<HTMLFormElement>>('formEl');
  protected expired = this.route.snapshot.queryParamMap.get('expired') === '1';
  protected showPassword = signal(false);
  protected submission = new Submission();
  protected form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      setTimeout(() => focusFirstInvalid(this.formEl().nativeElement));
      return;
    }
    const { email, password } = this.form.getRawValue();
    if (await this.submission.run(() => this.auth.login(email, password), 'Bienvenido')) {
      this.router.navigateByUrl(
        this.route.snapshot.queryParamMap.get('returnUrl') ?? this.auth.homeUrl(),
      );
    }
  }
}
