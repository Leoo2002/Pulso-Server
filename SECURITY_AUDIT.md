# 🛡️ Auditoría de Seguridad — Pulso-Server

> **Fecha**: 2026-06-12
> **Repo**: https://github.com/Leoo2002/Pulso-Server
> **Stack**: Node.js 18+ / Express 4.21 / Supabase / JWT / Google OAuth
> **Archivos analizados**: 33 JS (~2,900 LOC) + configs + docs

---

## 📊 Resumen Ejecutivo

| Nivel | Count | Descripción |
|-------|-------|-------------|
| 🔴 CRÍTICO | 3 | Requieren acción inmediata |
| 🟡 ALTO | 5 | Deben resolverse pronto |
| 🟡 MEDIO | 5 | Mejores prácticas |
| 🟢 BAJO | 3 | Recomendaciones |
| **Total** | **16** | |

---

## 🔴 CRÍTICOS

### C1 — Service Role Key expuesta en REST API calls directas

**Archivos**: `src/services/metricas.service.js`, `src/services/historico-guardia.service.js`, `src/routes/metricas.routes.js`, `src/routes/historico-guardia.routes.js`

**Problema**: `SUPABASE_KEY` es la `SERVICE_ROLE_KEY` (definida en `src/config/database.js:5` como `process.env.SUPABASE_SERVICE_KEY`). Esta key **bypasea todas las Row Level Security (RLS)** de Supabase y otorga acceso administrativo total.

Se usa directamente en headers de llamadas `fetch()` a la REST API de Supabase:

```js
// metricas.service.js L557-558
'apikey': SUPABASE_KEY,
'Authorization': `Bearer ${SUPABASE_KEY}`,
```

**Impacto**: Un atacante que comprometa el proceso del servidor obtiene acceso completo a TODAS las tablas de Supabase, incluyendo `kpi`, `registros_guardia`, y `public`. Además, cualquier bug en la autorización de rutas expone datos sensibles sin restricción.

**Además**: conviven DOS keys en el mismo código:
| Variable | Key | Archivos |
|----------|-----|----------|
| `SUPABASE_KEY` | `SERVICE_ROLE` (admin) | `database.js`, `metricas.*`, `supabase.js` |
| `SUPABASE_ANON_KEY` | Anon key (RLS) | `historico-guardia.service.js` |

**Fix**:
1. Usar `SUPABASE_ANON_KEY` para lecturas (SELECT, RPC de solo lectura)
2. Reservar `SERVICE_ROLE_KEY` solo para writes administrativos
3. Centralizar la elección de key en un helper con autorización explícita

---

### C2 — Ruteo de autenticación frágil en server.js

**Archivo**: `server.js`

**Problema**: Las rutas de autenticación pública se montan de forma incorrecta:

```js
// INCORRECTO: mount público apunta a paths que no existen
app.use('/auth/login', authRoutes);           // → espera POST /auth/login/login
app.use('/auth/logout', authRoutes);          // → espera GET /auth/logout/logout
app.use('/auth/acceso-especial', authRoutes); // → espera POST /auth/acceso-especial/acceso-especial

// El middleware JWT se aplica a /auth
app.use('/auth', jwtValidationMiddleware);

// Segundo mount que SÍ funciona
app.use('/auth', authRoutes);                 // → POST /auth/login funciona AQUÍ
```

**Impacto**: El login funciona solo porque `jwt-validation.js` tiene `/auth/login` hardcodeado en su lista `publicPaths`. Cualquier refactor, cambio de orden, o adición de ruta pública puede romper la autenticación. No hay tests que lo detecten.

**Fix**:
```js
// server.js
// 1. Middlewares globales PRIMERO (sin auth)
app.use('/auth/login', authRoutes);
app.use('/auth/logout', authRoutes);
app.use('/auth/acceso-especial', authRoutes);

// 2. JWT middleware
app.use('/auth', jwtValidationMiddleware);

// 3. Solo montar UNA vez authRoutes con JWT
app.use('/auth', authRoutes);

// O mejor: manejar público/protegido DENTRO del router
```

---

### C3 — JWT verify sin restricción de algoritmo

**Archivos**: `src/middlewares/auth.js:22`, `src/middlewares/jwt-validation.js:22`, `src/routes/auth.routes.js:88,174`

**Problema**: Los 4 llamados a `jwt.verify()` no especifican algoritmo:

```js
jwt.verify(token, JWT_SECRET, (err, decoded) => {
  // Falta: { algorithms: ['HS256'] }
});
```

**Impacto**: Vulnerabilidad de **algorithm confusion**. Si el servidor alguna vez expone una clave pública, o si un atacante puede forzar el algoritmo a `'none'`, puede forjar tokens JWT y autenticarse como cualquier usuario.

CVE relacionado: [CVE-2022-23529](https://nvd.nist.gov/vuln/detail/CVE-2022-23529) (jsonwebtoken < 9.0.1)

**Fix**:
```js
jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, decoded) => { ... });
```

---

## 🟡 ALTOS

### A1 — Sin helmet / security headers HTTP

**Archivo**: `server.js` (ausencia)

**Problema**: No hay UN SOLO header de seguridad HTTP configurado. Sin: `helmet`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`.

**Impacto**:
- **Clickjacking**: cualquiera puede embeker el frontend en un iframe y engañar usuarios
- **MIME sniffing**: navegadores pueden interpretar respuestas como otro content-type
- **XSS**: sin CSP, cualquier script injectado se ejecuta sin restricción
- **HSTS**: sin HSTS, un atacante en la misma red puede interceptar requests HTTP (aunque el cookie sea `secure: true`)

**Fix**:
```bash
npm install helmet
```
```js
// server.js
app.use(require('helmet')());
```

---

### A2 — Sin rate limiting en /acceso-especial

**Archivo**: `src/routes/auth.routes.js:100-151`

**Problema**: `POST /acceso-especial` compara una contraseña estática sin rate limiting:

```js
const { contra, rango } = req.body;
if (contra !== process.env.U_SECRET) {  // Brute-forceable
```

**Impacto**: Un atacante puede hacer fuerza bruta a `U_SECRET` sin restricción. Si lo descubre, obtiene un JWT que puede simular CUALQUIER rango (incluyendo admin/rango 1) sin Google OAuth.

**Fix**:
```bash
npm install express-rate-limit
```
```js
const rateLimit = require('express-rate-limit');
const accesoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutos
  max: 5,                      // 5 intentos
  message: { error: 'Demasiados intentos. Intente más tarde.' }
});
app.use('/auth/acceso-especial', accesoLimiter, authRoutes);
```

---

### A3 — authMiddleware (role-based) no se usa en rutas protegidas

**Archivos**: `src/routes/*.routes.js`

**Problema**: `authMiddleware` (verifica rango/rol) solo se usa en `GET /validar-acceso` (endpoint consultivo). Todas las rutas reales (`/api/agentes`, `/api/nomina`, `/api/metricas`, `/api/programacion`, `/api/dev`, etc.) usan SOLO `jwt-validation.js` que **no verifica roles**.

**Impacto**: Cualquier usuario autenticado (rango 0-6) puede:
- Ver nóminas completas
- Modificar agentes
- Ejecutar RPCs de producción via `/dev/ejecutar-rpc`
- Ver métricas y KPIs

Aunque `permissions.js` define permisos por vista, SOLO se usa en el frontend para ocultar botones — no hay enforcement server-side.

**Fix**:
```js
// agentes.routes.js - ejemplo
const authMiddleware = require('../middlewares/auth');

router.get("/lideres", authMiddleware([1, 2, 3]), async (req, res) => {
  // solo rango 1-3
});
```

---

### A4 — Sin CSRF token + sameSite: 'none'

**Archivo**: `src/routes/auth.routes.js:50-55`

**Problema**:
```js
res.cookie('login-jwt', jwtToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'none',  // cross-site requests INCLUDEN la cookie
  // Sin CSRF token
});
```

**Impacto**: `sameSite: 'none'` envía la cookie en requests desde cualquier sitio. Sin un token CSRF, un sitio malicioso podría hacer que un navegador autenticado ejecute acciones en la API (cambiar turnos, modificar agentes, etc.).

**Fix**: Usar `sameSite: 'lax'` si el frontend y backend están en el mismo dominio, o implementar doble submit cookie pattern con un token CSRF.

---

### A5 — Sin package-lock.json

**Problema**: No hay `package-lock.json` en el repo. Las versiones usan rangos `^`:

```json
"express": "^4.21.2",
"jsonwebtoken": "^9.0.2",
"@supabase/supabase-js": "^2.49.4",
"google-auth-library": "^9.15.1"
```

**Impacto**: Cada `npm install` puede resolver versiones distintas de dependencias y sub-dependencias. Una sub-dependencia vulnerable puede introducirse sin que el código cambie. Además, `npm audit` no funciona sin lockfile.

**Fix**:
```bash
npm install --package-lock-only
git add package-lock.json && git commit -m "chore: add package-lock.json"
```

---

## 🟡 MEDIOS

### M1 — Sync file operations bloquean el event loop

**Archivo**: `src/services/metricas.service.js` (7 ocurrencias)

```js
fs.readFileSync(req.file.path);    // Bloquea todo Node.js hasta terminar
fs.unlinkSync(req.file.path);      // Idem
```

**Impacto**: En Node.js, `readFileSync` bloquea **todo el event loop**: todas las conexiones simultáneas se congelan hasta que la operación de disco termina. En producción con múltiples usuarios subiendo archivos, degrada severamente el performance.

**Fix**:
```js
// En lugar de:
const buffer = fs.readFileSync(req.file.path);
// Usar:
const buffer = await fs.promises.readFile(req.file.path);
```

---

### M2 — Info disclosure en stack traces

**Archivo**: `src/routes/metricas.routes.js:109`

```js
details: process.env.NODE_ENV === 'development' ? error.stack : undefined
```

**Impacto**: Si `NODE_ENV` no se setea explícitamente en producción (o se setea a otro valor), los stack traces se exponen en respuestas HTTP. Render y otros PaaS no siempre setean `NODE_ENV=production` automáticamente.

**Fix**: Usar un valor explícito y con default:
```js
const isDev = (process.env.NODE_ENV || 'production') === 'development';
```

---

### M3 — Sin límite explícito de body size en express.json()

**Archivo**: `server.js`

```js
app.use(express.json());  // default: 100kb
```

El default de Express 4 es 100kb, que es razonable. Pero con `multer` manejando archivos en `metricas.service.js`, es mejor ser explícito.

**Fix**:
```js
app.use(express.json({ limit: '10kb' }));
```

---

### M4 — Fecha hardcodeada en /Obtenerhorarios

**Archivo**: `src/routes/cambios.routes.js`

```js
fecha_ini: '2025-04-28'  // Hardcodeado — ya expiró
```

**Impacto**: El endpoint devuelve datos incorrectos o vacíos. Síntoma de validación de datos deficiente en endpoints críticos de negociación de turnos.

---

### M5 — Código duplicado: historico-guardia service vs routes

**Archivos**:
- `src/services/historico-guardia.service.js` (290 líneas) — patrón legacy (registra rutas con `app`)
- `src/routes/historico-guardia.routes.js` (213 líneas) — patrón Router

Ambos implementan la MISMA funcionalidad con autorización potencialmente distinta (uno usa `SUPABASE_ANON_KEY`, otro `SUPABASE_KEY`).

---

## 🟢 BAJOS

### B1 — Sin tests de seguridad

```json
"test": "echo \"Error: no test specified\" && exit 1"
```

Cero tests. No hay forma de verificar que cambios de seguridad no rompen funcionalidad existente.

### B2 — Sin validación de esquemas (Zod/Joi)

Ninguna ruta valida el schema del body/query con una biblioteca de schemas. Algunos endpoints tienen chequeos inline pero son inconsistentes. Ejemplo de falta de validación:

```js
// auth.routes.js — ¿qué pasa si token es un array/objeto?
const { token } = req.body;
const payload = await verifyGoogleToken(token);
```

### B3 — Dual Supabase client instances

`src/config/database.js` y `supabase.js` (raíz) crean instancias SEPARADAS del cliente Supabase, ambas con la service role key. Si se configuran diferente en el futuro, pueden tener comportamientos inconsistentes.

---

## 📋 Checklist de Fixes por Prioridad

### Semana 1 — Críticos

- [ ] **C1** Separar service_role key de REST API calls (usar anon key para reads)
- [ ] **C2** Reestructurar server.js: montar authRoutes una vez, manejar público/protegido dentro del router
- [ ] **C3** Agregar `{ algorithms: ['HS256'] }` a todos los `jwt.verify()`

### Semana 2 — Altos

- [ ] **A1** `npm install helmet` y agregar `app.use(require('helmet')())`
- [ ] **A2** `npm install express-rate-limit`, aplicar a `/acceso-especial` y `/login`
- [ ] **A3** Agregar `authMiddleware(rolesPermitidos)` a rutas sensibles (nomina, dev, metricas, cambios)
- [ ] **A4** Revisar CSRF: idealmente sameSite: 'lax' o implementar token CSRF
- [ ] **A5** `npm install --package-lock-only && git add package-lock.json`

### Semana 3 — Medios

- [ ] **M1** Reemplazar `fs.readFileSync` por `fs.promises.readFile` en metricas.service.js
- [ ] **M2** Setear `NODE_ENV=production` en deploy / agregar fallback seguro en stack traces
- [ ] **M3** Agregar límite explícito a `express.json()`
- [ ] **M4** Reemplazar fecha hardcodeada con parámetro dinámico
- [ ] **M5** Elegir un patrón (Router) y eliminar `historico-guardia.service.js` legacy

### Semana 4 — Bajos

- [ ] **B1** Agregar al menos tests unitarios para validación de cambios y auth
- [ ] **B2** Integrar Zod o Joi para validación de schemas en endpoints POST
- [ ] **B3** Eliminar `supabase.js` raíz y unificar en `database.js`

---

## 📊 Score de Seguridad

```
🔐 Health Score: 3/10

🟢 Configuración aceptable:
  ✅ Cookies httpOnly + secure
  ✅ JWT con expiración (8h)
  ✅ Google OAuth como provider principal
  ✅ CORS con orígenes explícitos
  ✅ Variables de entorno vía dotenv
  ✅ .env.example completo (sin valores reales)
  ✅ .gitignore configurado

🔴 Falta crítica:
  ❌ Service key en REST API calls
  ❌ Ruteo de auth frágil
  ❌ Algoritmo JWT sin restringir
  ❌ Helmet/security headers
  ❌ Rate limiting
  ❌ Auth middleware no usado
  ❌ CSRF protection
  ❌ Lockfile
  ❌ Tests
  ❌ Input validation
```

---

## 🔗 Referencias

- [OWASP Node.js Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [jsonwebtoken CVE-2022-23529](https://nvd.nist.gov/vuln/detail/CVE-2022-23529)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Helmet.js Documentation](https://helmetjs.github.io/)
