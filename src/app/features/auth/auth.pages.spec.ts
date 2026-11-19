import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { baseProviders } from '../../app.config';
import { AuthService } from '../../core/auth/auth.service';

describe('auth pages (UI, toggles & focus)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [...baseProviders, provideHttpClientTesting()] });
  });

  it('LoginPage shows crest, toggles password visibility accessibly, and focuses first invalid field', async () => {
    const harness = await RouterTestingHarness.create('/login');
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;

    expect(el.querySelector('img[src="brand/CHCH23logo.webp"]')).not.toBeNull();
    expect(el.querySelector('a[href="/forgot-password"]')).not.toBeNull();

    const pwdInput = el.querySelector<HTMLInputElement>('input[formcontrolname="password"]')!;
    const toggle = el.querySelector<HTMLButtonElement>('.password-toggle')!;
    expect(pwdInput.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    toggle.click();
    harness.detectChanges();
    expect(pwdInput.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    harness.detectChanges();
    expect(pwdInput.type).toBe('password');

    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    harness.detectChanges();
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(el.querySelector('input[formcontrolname="email"]'));
  });

  it('ForgotPasswordPage and ResetPasswordPage render crest, return link, and password toggles', async () => {
    const harness = await RouterTestingHarness.create('/forgot-password');
    harness.detectChanges();
    let el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('a[href="/login"]')).not.toBeNull();

    await harness.navigateByUrl('/reset-password?token=abc');
    harness.detectChanges();
    el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelectorAll('input[type="password"]').length).toBe(2);

    const toggles = el.querySelectorAll<HTMLButtonElement>('.password-toggle');
    toggles[0].click();
    harness.detectChanges();
    expect(el.querySelectorAll('input[type="password"]').length).toBe(1);
    expect(el.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('ChangePasswordPage renders 3 password toggles when authenticated', async () => {
    await TestBed.inject(AuthService).login('admin@example.com', 'demo1234');
    const harness = await RouterTestingHarness.create('/account/password');
    harness.detectChanges();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelectorAll('input[type="password"]').length).toBe(3);
    expect(el.querySelectorAll('.password-toggle').length).toBe(3);
  });
});
