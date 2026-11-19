import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import localeEsMx from '@angular/common/locales/es-MX';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { apiUrlInterceptor } from './core/api/charales-api.service';

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
  // REST API (core/api): same-origin through proxy.conf.json, the session cookie travels by itself; on a server
  // where the API has its own port, apiUrlInterceptor points the requests there.
  provideHttpClient(withFetch(), withInterceptors([apiUrlInterceptor])),
  { provide: LOCALE_ID, useValue: 'es-MX' },
];

export const appConfig: ApplicationConfig = {
  providers: [
    ...baseProviders,
    // Run over the built-in in-memory MockDb and AuthService when no MariaDB server is present.
  ],
};
