/**
 * After a rejected submit, focus the first invalid field (Angular marks it `.ng-invalid`), where its error is shown,
 * so a keyboard or screen-reader user lands on it even when it is off screen. Call it only on submit, never while
 * typing.
 */
export function focusFirstInvalid(form: HTMLElement): void {
  form
    .querySelector<HTMLElement>('input.ng-invalid, select.ng-invalid, textarea.ng-invalid')
    ?.focus();
}
