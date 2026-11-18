# Charales · Entrega final

Charales es la aplicación web de gestión de la escuela de fútbol (jugadores, inscripciones, cobranza, uniformes,
calendario). Este ZIP contiene todo lo necesario para instalarla en un servidor AlmaLinux. No hace falta el
repositorio Git.

| Parte         | Tecnología                            | Dirección final            |
| ------------- | ------------------------------------- | -------------------------- |
| Frontend      | Angular compilado, servido por Apache | `http://45.80.152.66`      |
| API           | Node.js 24 + PM2 (usuario `charales`) | `http://45.80.152.66:3002` |
| Base de datos | MariaDB 10.6 o mayor                  | base y cuenta `charalesdb` |

**La guía completa, paso a paso, es [`DEPLOYMENT.md`](DEPLOYMENT.md).** Resumen:

| Paso | Quién           | Qué                                                                                                      |
| ---- | --------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | root            | Crear el usuario `charales`, descomprimir el ZIP en `/home/charales/charales`, `comprobar-requisitos.sh` |
| 2–3  | root            | Instalar Node.js 24, PM2, Apache y, si hace falta, MariaDB ≥ 10.6                                        |
| 4–5  | root            | Anotar host/puerto de MariaDB; `crear-base.sh` (sólo si la base y la cuenta no existen)                  |
| 6    | charales        | Completar `.env` (3 datos), `npm install --legacy-peer-deps`, `npm run db:setup`, `npm run db:admin`     |
| 7    | charales / root | `instalar.sh` (API con PM2) y `pm2 startup systemd` (arranque automático)                                |
| 8–10 | root            | `instalar-apache.sh` (frontend), SELinux, abrir los puertos 80 y 3002                                    |
| 11   | charales        | `verificar-servidor.sh` y prueba en el navegador                                                         |

**Datos que tienes que completar** en `backend/.env`: `DB_HOST`, `DB_PORT` (los de tu MariaDB) y `DB_PASSWORD`
(la contraseña de la cuenta `charalesdb`, que se entrega por separado y **no** está en el ZIP). Lo demás (IP, puerto
3002, HTTP, `MAIL_PROVIDER=none`, `TRUSTED_PROXIES=none`) ya está configurado.

**Integridad:** el SHA-256 del ZIP acompaña al envío; dentro, `sha256sum -c MANIFEST.sha256` comprueba cada archivo.
`INVENTARIO.txt` lista el contenido y el commit del que se generó.

Ningún script borra datos ni sobrescribe configuraciones existentes: se detienen y avisan.
