/**
 * After a rejected submit, focus the first invalid field (Angular marks it `.ng-invalid`), where its error is shown,
 * so a keyboard or screen-reader user lands on it even when it is off screen. Only fields that can take focus count:
 * not disabled, not hidden, not inside an inert area. Call it only on submit, never while typing. Returns the field
 * it focused, or null.
 */
export function focusFirstInvalid(form: HTMLElement): HTMLElement | null {
  const field = [
    ...form.querySelectorAll<HTMLElement>(
      'input.ng-invalid, select.ng-invalid, textarea.ng-invalid',
    ),
  ].find(canTakeFocus);
  field?.focus();
  return field ?? null;
}

function canTakeFocus(el: HTMLElement): boolean {
  if (el.matches(':disabled, [type=hidden]') || el.closest('[inert]')) return false;
  if (typeof el.checkVisibility === 'function')
    return el.checkVisibility({ visibilityProperty: true });
  // No layout (jsdom, the unit tests): `hidden` and the computed styles up the tree.
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const style = getComputedStyle(e);
    if (e.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
