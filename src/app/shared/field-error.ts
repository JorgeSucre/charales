import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';

const MESSAGES: Record<string, (e: any) => string> = {
  required: () => 'Campo requerido.',
  email: () => 'Correo inválido.',
  minlength: (e) => `Mínimo ${e.requiredLength} caracteres.`,
  min: (e) => `Debe ser al menos ${e.min}.`,
  pattern: () => 'Formato inválido.',
  mismatch: () => 'Las contraseñas no coinciden.',
};

/** Shows the first validation error of a control once touched. Eager: form state isn't signal-based. */
@Component({
  selector: 'app-field-error',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `@if (message(); as m) {
    <small class="field-error" role="alert">{{ m }}</small>
  }`,
})
export class FieldError {
  readonly control = input.required<AbstractControl>();

  message(): string | null {
    const c = this.control();
    if (!c.errors || !c.touched) return null;
    const [key, value] = Object.entries(c.errors)[0];
    return MESSAGES[key]?.(value) ?? 'Valor inválido.';
  }
}
