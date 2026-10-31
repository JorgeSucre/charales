import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiAuthService } from '../auth/api-auth.service';
import { AuthUser, SessionStore } from '../auth/session.store';
import { PlayerService } from '../services/player.service';
import { RPC_METHODS } from './rpc-methods';
import { RPC_SERVICES, rpcProviders } from './rpc-services';

/**
 * The browser side of the real API (D13): ApiAuthService and the RPC clients. The server side — MariaDB,
 * authorization, transactions — is covered by api/rpc.test.ts and api/api.test.ts against a real database.
 */
const USER: AuthUser = {
  userId: 2,
  sessionId: 9,
  email: 'secretaria@example.com',
  displayName: 'Sofía Secretaria',
  roles: ['SECRETARIA'],
  permissions: ['jugadores.consultar'],
  officePermissions: ['jugadores.consultar'],
  tutorId: null,
  coachId: null,
  isStaff: true,
  expiresAt: '2026-10-13T20:00:00',
  lastUsedAt: '2026-10-13T12:00:00',
};

describe('API client (ApiAuthService + RPC)', () => {
  let http: HttpTestingController;
  let store: SessionStore;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        ...rpcProviders(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SessionStore);
  });
  afterEach(() => http.verify());

  it('login posts the credentials and keeps the AuthUser the API returns (never a token)', async () => {
    const auth = TestBed.inject(ApiAuthService);
    const pending = auth.login(' secretaria@example.com ', 'demo1234');
    const req = http.expectOne('/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'secretaria@example.com', password: 'demo1234' });
    req.flush(USER);
    await pending;
    expect(auth.user()).toEqual(USER);
    expect(auth.can('jugadores.consultar')).toBe(true);
    expect(JSON.stringify(sessionStorage)).not.toContain('charales_sid');
  });

  it('a wrong password surfaces the API message', async () => {
    const auth = TestBed.inject(ApiAuthService);
    const pending = auth.login('x@example.com', 'mala');
    http
      .expectOne('/auth/login')
      .flush({ error: 'Correo o contraseña incorrectos.' }, { status: 401, statusText: 'x' });
    await expect(pending).rejects.toThrow('Correo o contraseña incorrectos.');
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('checkSession asks the API every time: 200 refreshes the user, 401 clears it (HU-002.4)', async () => {
    const auth = TestBed.inject(ApiAuthService);
    let pending = auth.checkSession();
    http.expectOne('/auth/session').flush({ ...USER, permissions: [], officePermissions: [] });
    expect(await pending).toBe(true);
    expect(auth.can('jugadores.consultar')).toBe(false); // HU-006: permissions as of now
    pending = auth.checkSession();
    http.expectOne('/auth/session').flush({ error: 'x' }, { status: 401, statusText: 'x' });
    expect(await pending).toBe(false);
    expect(auth.user()).toBeNull();
  });

  it('logout clears the local session at once and tells the API', () => {
    store.set({ user: USER, token: '' });
    const auth = TestBed.inject(ApiAuthService);
    auth.logout();
    expect(auth.isLoggedIn()).toBe(false);
    http
      .expectOne({ method: 'POST', url: '/auth/logout' })
      .flush(null, { status: 204, statusText: '' });
  });

  it('password change, recovery and reset go to the HU-005 endpoints', async () => {
    store.set({ user: USER, token: '' });
    const auth = TestBed.inject(ApiAuthService);
    const change = auth.changePassword('demo1234', 'Nueva12345');
    const req = http.expectOne('/auth/password');
    expect(req.request.body).toEqual({ currentPassword: 'demo1234', newPassword: 'Nueva12345' });
    req.flush(null, { status: 204, statusText: '' });
    await change;
    const request = auth.requestPasswordReset(' a@example.com ');
    http.expectOne('/auth/password-reset/request').flush(null, { status: 204, statusText: '' });
    const reset = auth.resetPassword('tok', 'Nueva12345');
    http.expectOne('/auth/password-reset/confirm').flush(null, { status: 204, statusText: '' });
    await Promise.all([request, reset]);
    expect(auth.user()).toBeNull(); // the API closed every session
  });

  it('each domain service is an API client with exactly the allowlisted methods', async () => {
    for (const [name, token] of Object.entries(RPC_SERVICES)) {
      const client = TestBed.inject(token) as Record<string, unknown>;
      expect(Object.keys(client).sort()).toEqual(
        [...RPC_METHODS[name as keyof typeof RPC_METHODS]].sort(),
      );
    }
    const players = TestBed.inject(PlayerService);
    const pending = players.search({ query: 'Ana' });
    const req = http.expectOne('/api/rpc');
    expect(req.request.body).toEqual({
      service: 'PlayerService',
      method: 'search',
      args: [{ query: 'Ana' }],
    });
    req.flush({ result: { items: [], total: 0 } });
    expect(await pending).toEqual({ items: [], total: 0 });
  });

  it('trailing undefined arguments are dropped so server-side defaults apply', async () => {
    const players = TestBed.inject(PlayerService) as unknown as {
      search: (f?: unknown) => Promise<unknown>;
    };
    const pending = players.search(undefined);
    const req = http.expectOne('/api/rpc');
    expect(req.request.body.args).toEqual([]);
    req.flush({ result: null });
    await pending;
  });

  it('a 401 from an operation ends the session and goes to the login (expired)', async () => {
    store.set({ user: USER, token: '' });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const pending = TestBed.inject(PlayerService).search({});
    http
      .expectOne('/api/rpc')
      .flush(
        { error: 'Tu sesión no está iniciada o ya expiró. Inicia sesión de nuevo.' },
        { status: 401, statusText: 'x' },
      );
    await expect(pending).rejects.toThrow(
      'Tu sesión no está iniciada o ya expiró. Inicia sesión de nuevo.',
    );
    expect(store.user()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(
      ['/login'],
      expect.objectContaining({ queryParams: expect.objectContaining({ expired: 1 }) }),
    );
  });

  it('a 403 keeps the session and shows the API message', async () => {
    store.set({ user: USER, token: '' });
    const pending = TestBed.inject(PlayerService).search({});
    http
      .expectOne('/api/rpc')
      .flush(
        { error: 'No tienes permiso para realizar esta acción.' },
        { status: 403, statusText: 'x' },
      );
    await expect(pending).rejects.toThrow('No tienes permiso para realizar esta acción.');
    expect(store.user()).toEqual(USER);
  });
});
