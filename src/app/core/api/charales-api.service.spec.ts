import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CharalesApi } from './charales-api.service';

/** Rows exactly as GET /api/jugadores and /api/categorias return them for db/mariadb/020_dev_seed.sql. */
const JUGADOR_J0001 = {
  id: 1,
  identificador: 'J-0001',
  nombre: 'Diego',
  apellido_paterno: 'Hernández',
  apellido_materno: 'López',
  fecha_nacimiento: '2016-03-12',
  sexo: 'M',
  telefono: null,
  email: null,
  direccion: 'Calle Pino 12',
  estatus: 'ACTIVO',
  creado_en: '2026-10-08 11:17:18',
  actualizado_en: '2026-10-08 11:17:18',
};
const CATEGORIA = (id: number, nombre: string, activo: number) => ({
  id,
  temporada_id: 1,
  nombre,
  edad_minima: 8,
  edad_maxima: 10,
  cupo_maximo: null,
  activo,
  creado_en: '2026-10-08 11:17:18',
  actualizado_en: '2026-10-08 11:17:18',
});

describe('CharalesApi (HTTP layer to the REST API)', () => {
  let api: CharalesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CharalesApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('players(): GET /api/jugadores, same-origin, no credentials flag needed', async () => {
    const result = api.players();
    const req = http.expectOne('/api/jugadores');
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBe(false);
    req.flush([JUGADOR_J0001]);
    expect((await result).length).toBe(1);
  });

  it('maps a real jugadores row to the Player model', async () => {
    const result = api.players();
    http.expectOne('/api/jugadores').flush([JUGADOR_J0001]);
    expect(await result).toEqual([
      {
        id: 1,
        identifier: 'J-0001',
        firstName: 'Diego',
        lastName1: 'Hernández',
        lastName2: 'López',
        birthDate: '2016-03-12',
        sex: 'M',
        phone: null,
        email: null,
        address: 'Calle Pino 12',
        status: 'ACTIVO',
        createdAt: '2026-10-08T11:17:18',
        updatedAt: '2026-10-08T11:17:18',
      },
    ]);
  });

  it('categories(): GET /api/categorias and activo 1/0 → boolean', async () => {
    const result = api.categories();
    const req = http.expectOne('/api/categorias');
    expect(req.request.method).toBe('GET');
    req.flush([CATEGORIA(1, 'Sub-10', 1), CATEGORIA(2, 'Sub-12', 0)]);
    const [sub10, sub12] = await result;
    expect(sub10).toEqual({
      id: 1,
      seasonId: 1,
      name: 'Sub-10',
      minAge: 8,
      maxAge: 10,
      maxCapacity: null,
      active: true,
      createdAt: '2026-10-08T11:17:18',
      updatedAt: '2026-10-08T11:17:18',
    });
    expect(sub12.active).toBe(false);
  });

  it("401: the API's message as the error; session() reads it as «no session»", async () => {
    const players = api.players();
    http
      .expectOne('/api/jugadores')
      .flush(
        { error: 'Sesión no iniciada o expirada.' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await expect(players).rejects.toThrow('Sesión no iniciada o expirada.');

    const session = api.session();
    http
      .expectOne('/auth/session')
      .flush(
        { error: 'Sesión no iniciada o expirada.' },
        { status: 401, statusText: 'Unauthorized' },
      );
    expect(await session).toBeNull();
  });

  it("403: the API's permission message", async () => {
    const result = api.categories();
    http
      .expectOne('/api/categorias')
      .flush(
        { error: 'No tienes permiso para esta operación.' },
        { status: 403, statusText: 'Forbidden' },
      );
    await expect(result).rejects.toThrow('No tienes permiso para esta operación.');
  });

  it('status 0 / proxy 502 (API unreachable): a clear connection message, also from session()', async () => {
    const result = api.session();
    http.expectOne('/auth/session').error(new ProgressEvent('error'), { status: 0 });
    await expect(result).rejects.toThrow('No se pudo conectar con la API');

    const viaProxy = api.players(); // ng serve proxy with the API stopped: 502, empty body
    http.expectOne('/api/jugadores').flush('', { status: 502, statusText: 'Bad Gateway' });
    await expect(viaProxy).rejects.toThrow('No se pudo conectar con la API');
  });

  it('login(): POST /auth/login with a JSON body; the cookie is left to the browser', async () => {
    const result = api.login('admin@example.com', 'demo1234');
    const req = http.expectOne('/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'admin@example.com', password: 'demo1234' });
    req.flush({ email: 'admin@example.com', roles: ['ADMINISTRADOR'] });
    expect((await result).roles).toEqual(['ADMINISTRADOR']);
  });

  it('logout(): POST /auth/logout', async () => {
    const result = api.logout();
    const req = http.expectOne('/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await result;
  });
});
