import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { AuthUser } from '../auth/session.store';
import { Category, Player } from '../models';

/**
 * HTTP layer to the Charales REST API (docs/API.md). Same-origin through the dev-server proxy (proxy.conf.json), so
 * the browser sends the HttpOnly `charales_sid` cookie by itself: Angular never reads or stores it, and needs no
 * CORS nor `withCredentials`. Returns Promises and throws `Error` with the API's message, like every other service,
 * so `Submission` and `<app-load-state>` show it as is.
 *
 * The API session is independent from the app's (mock) AuthService until that service is migrated (ROADMAP).
 */
@Injectable({ providedIn: 'root' })
export class CharalesApi {
  private http = inject(HttpClient);

  /** The API session behind the cookie, or null when there is none (401). */
  async session(): Promise<AuthUser | null> {
    try {
      return await this.call(this.http.get<AuthUser>('/auth/session'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  }

  login(email: string, password: string): Promise<AuthUser> {
    return this.call(this.http.post<AuthUser>('/auth/login', { email, password }));
  }

  logout(): Promise<void> {
    return this.call(this.http.post<void>('/auth/logout', null));
  }

  async players(): Promise<Player[]> {
    return (await this.call(this.http.get<JugadorRow[]>('/api/jugadores'))).map(toPlayer);
  }

  async categories(): Promise<Category[]> {
    return (await this.call(this.http.get<CategoriaRow[]>('/api/categorias'))).map(toCategory);
  }

  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (e) {
      throw e instanceof HttpErrorResponse ? new ApiError(e) : e;
    }
  }
}

/** 0: network error; 502/504: the dev-server proxy could not reach the API (it is not running). */
const UNREACHABLE = [0, 502, 504];

/** HTTP failure with the API's Spanish message (`{ error }`), or a clear one when the API is unreachable. */
export class ApiError extends Error {
  readonly status: number;
  constructor(response: HttpErrorResponse) {
    const body = response.error as { error?: unknown } | null;
    super(
      UNREACHABLE.includes(response.status)
        ? 'No se pudo conectar con la API. Verifica que esté corriendo (npm run api:start).'
        : typeof body?.error === 'string'
          ? body.error
          : `La API respondió con el estado ${response.status}.`,
    );
    this.status = response.status;
  }
}

// Wire format of the lab endpoints: rows exactly as MariaDB returns them (docs/API.md § Práctica). They are mapped
// to the existing models here, at the edge (MARIADB.md § 8.2); the rest of the app only sees Player / Category.

interface JugadorRow {
  id: number;
  identificador: string;
  nombre: string;
  apellido_paterno: string;
  apellido_materno: string | null;
  fecha_nacimiento: string;
  sexo: Player['sex'];
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  estatus: Player['status'];
  creado_en: string;
  actualizado_en: string;
}

interface CategoriaRow {
  id: number;
  temporada_id: number | null;
  nombre: string;
  edad_minima: number;
  edad_maxima: number;
  cupo_maximo: number | null;
  activo: number;
  creado_en: string;
  actualizado_en: string;
}

/** MariaDB DATETIME 'YYYY-MM-DD HH:MM:SS' → model DateTime 'YYYY-MM-DDTHH:MM:SS' (same wall clock, no zone). */
const dateTime = (value: string) => value.replace(' ', 'T');

function toPlayer(r: JugadorRow): Player {
  return {
    id: r.id,
    identifier: r.identificador,
    firstName: r.nombre,
    lastName1: r.apellido_paterno,
    lastName2: r.apellido_materno,
    birthDate: r.fecha_nacimiento,
    sex: r.sexo,
    phone: r.telefono,
    email: r.email,
    address: r.direccion,
    status: r.estatus,
    createdAt: dateTime(r.creado_en),
    updatedAt: dateTime(r.actualizado_en),
  };
}

function toCategory(r: CategoriaRow): Category {
  return {
    id: r.id,
    seasonId: r.temporada_id,
    name: r.nombre,
    minAge: r.edad_minima,
    maxAge: r.edad_maxima,
    maxCapacity: r.cupo_maximo,
    active: Boolean(r.activo),
    createdAt: dateTime(r.creado_en),
    updatedAt: dateTime(r.actualizado_en),
  };
}
