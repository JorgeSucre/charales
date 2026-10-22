import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch } from '@angular/common/http';
import localeEsMx from '@angular/common/locales/es-MX';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { rpcProviders } from './core/api/rpc-services';
import { ApiAuthService } from './core/auth/api-auth.service';
import { AuthService } from './core/auth/auth.service';

// UI in Spanish (AGENTS.md): dates like «dom 18 oct», whatever the browser's language.
registerLocaleData(localeEsMx);

/** Router, HTTP and locale. Alone (no API providers), the services run over MockDb: what the frontend tests use. */
export const baseProviders = [
  provideBrowserGlobalErrorListeners(),
  // New pages open at the top; Back/Forward restore the previous position.
  provideRouter(
    routes,
    withComponentInputBinding(),
    withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
  ),
  // REST API (core/api): same-origin through proxy.conf.json, the session cookie travels by itself.
  provideHttpClient(withFetch()),
  { provide: LOCALE_ID, useValue: 'es-MX' },
];

export const appConfig: ApplicationConfig = {
  providers: [
    ...baseProviders,
    // The app runs on the real API + MariaDB (D13): login/session by HTTP, and every domain service is an API
    // client; the same services run on the server (api/domain). api/*.test.ts cover that side on a real database.
    { provide: AuthService, useExisting: ApiAuthService },
    ...rpcProviders(),
  ],
};
