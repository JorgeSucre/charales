import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  HostAttributeToken,
  computed,
  inject,
  input,
} from '@angular/core';
import { AbstractControl, NgControl } from '@angular/forms';
import { EMAIL_MESSAGE, PHONE_MESSAGE } from './validate';

/** Error payloads as Angular's built-in validators produce them. */
type ErrorInfo = { requiredLength?: number; min?: number; max?: number };

/**
 * One wording per kind of error, for every form (docs/DEVELOPMENT.md, «Mensajes de validación»). The field is named
 * by its label, next to which the message is shown; the API repeats each rule with the field's name.
 */
const MESSAGES: Record<string, (e: ErrorInfo) => string> = {
  required: () => 'Este campo es obligatorio.',
  email: () => EMAIL_MESSAGE,
  phone: () => PHONE_MESSAGE,
  personName: () => 'Escribe sólo letras, espacios, guiones, apóstrofos o puntos de abreviatura.',
  catalogName: () => 'Incluye al menos una letra o un número.',
  minlength: (e) => `Escribe al menos ${e.requiredLength} caracteres.`,
  maxlength: (e) => `Escribe como máximo ${e.requiredLength} caracteres.`,
  min: (e) => `Ingresa un valor de al menos ${e.min}.`,
  max: (e) => `Ingresa un valor de como máximo ${e.max}.`,
  passwordPolicy: () => 'La contraseña debe incluir al menos una letra y un número.',
  mismatch: () => 'Las contraseñas no coinciden.',
  pattern: () => 'Revisa el formato de este campo.',
};

const ids = new WeakMap<AbstractControl, string>();
let next = 0;
/** Same id for a control in FieldError and in FieldA11y, without naming it in every template. */
function errorId(control: AbstractControl): string {
  let id = ids.get(control);
  if (!id) ids.set(control, (id = `field-error-${++next}`));
  return id;
}

const shown = (c: AbstractControl | null): c is AbstractControl => !!c && c.invalid && c.touched;

/** Shows the first validation error of a control once touched. Eager: form state isn't signal-based. */
@Component({
  selector: 'app-field-error',
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `@if (message(); as m) {
    <small class="field-error" role="alert" [id]="id()">{{ m }}</small>
  }`,
})
export class FieldError {
  readonly control = input.required<AbstractControl>();
  /** Names the field when it has no visible label next to the message (e.g. a row of fields). */
  readonly label = input<string>();
  protected id = computed(() => errorId(this.control()));

  message(): string | null {
    const c = this.control();
    if (!c.errors || !c.touched) return null;
    const [key, value] = Object.entries(c.errors)[0];
    const text = MESSAGES[key]?.(value) ?? 'Revisa el valor de este campo.';
    const label = this.label();
    return label ? `${label}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
  }
}

/**
 * Links each form field to its FieldError while the error shows: aria-invalid and aria-describedby (WCAG 3.3.1),
 * keeping any aria-describedby the template already gives (a hint).
 */
@Directive({
  selector: '[formControlName],[formControl]',
  host: {
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
    '[attr.aria-describedby]': 'describedBy()',
  },
})
export class FieldA11y {
  private ngControl = inject(NgControl, { self: true });
  private hint = inject(new HostAttributeToken('aria-describedby'), { optional: true });

  protected invalid(): boolean {
    return shown(this.ngControl.control);
  }

  protected describedBy(): string | null {
    const c = this.ngControl.control;
    return [this.hint, shown(c) ? errorId(c) : null].filter(Boolean).join(' ') || null;
  }
}
