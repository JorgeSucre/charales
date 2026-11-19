import { Component, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PromptDialog } from './prompt-dialog';

@Component({
  imports: [PromptDialog],
  template: `
    <button type="button" id="trigger">Abrir</button>
    <app-prompt-dialog />
  `,
})
class HostComponent {
  readonly dialog = viewChild.required(PromptDialog);
}

describe('PromptDialog', () => {
  it('validates required input, resolves trimmed value on submit, and restores focus', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('#trigger') as HTMLButtonElement;
    trigger.focus();

    const promise = fixture.componentInstance.dialog().open({
      title: 'Cancelar cargo',
      message: 'Indica el motivo.',
      label: 'Motivo',
      tone: 'danger',
    });
    fixture.detectChanges();

    const dialogEl = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialogEl.hasAttribute('open')).toBe(true);
    expect(dialogEl.querySelector('h2')?.textContent).toContain('Cancelar cargo');

    const submitBtn = dialogEl.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn.classList.contains('danger')).toBe(true);

    // Empty submit shows inline validation error and keeps dialog open
    submitBtn.click();
    fixture.detectChanges();
    expect(dialogEl.querySelector('.field-error')?.textContent).toContain(
      'Este campo es obligatorio.',
    );
    expect(dialogEl.hasAttribute('open')).toBe(true);

    // Typing clears error and submitting resolves trimmed text
    const input = dialogEl.querySelector('input') as HTMLInputElement;
    input.value = '  Error de captura  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(dialogEl.querySelector('.field-error')).toBeNull();

    submitBtn.click();
    fixture.detectChanges();

    await expect(promise).resolves.toBe('Error de captura');
    expect(dialogEl.hasAttribute('open')).toBe(false);

    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(trigger);
  });

  it('resolves null when dismissed via cancel button or Escape', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const p1 = fixture.componentInstance.dialog().open({
      title: 'Motivo',
      label: 'Detalle',
    });
    fixture.detectChanges();

    const dialogEl = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const cancelBtn = dialogEl.querySelector('button.secondary') as HTMLButtonElement;
    cancelBtn.click();
    fixture.detectChanges();
    await expect(p1).resolves.toBeNull();

    const p2 = fixture.componentInstance.dialog().open({
      title: 'Motivo 2',
      label: 'Detalle',
    });
    fixture.detectChanges();

    dialogEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await expect(p2).resolves.toBeNull();
  });
});
