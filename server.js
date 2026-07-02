// Servidor principal modularizado
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

// Importar configuración
const corsOptions = require('./src/config/cors');

// Importar middlewares
const jwtValidationMiddleware = require('./src/middlewares/jwt-validation');
const { globalLimiter, authLimiter, apiLimiter, heavyLimiter } = require('./src/middlewares/rate-limit');
const { logSecurityEvents, validateQueryParams, validateRequestBody } = require('./src/middlewares/security-validation.middleware');

// Importar servicios de histórico de guardia (legacy - funcionan correctamente)
const { 
  historicoGuardiaPorLider, 
  fechasReportes, 
  getFechasHistoricoGuardias, 
  getHistoricoGuardia,
  getGuardiasDelDia,
  setRegistroGuardia
} = require('./src/services/historico-guardia.service');

// Importar rutas modularizadas (SIN historico-guardia porque ya está en el service)
const authRoutes = require('./src/routes/auth.routes');
const agentesRoutes = require('./src/routes/agentes.routes');
const cambiosRoutes = require('./src/routes/cambios.routes');
const programacionRoutes = require('./src/routes/programacion.routes');
const nominaRoutes = require('./src/routes/nomina.routes');
const metricasRoutes = require('./src/routes/metricas.routes');
const pdfRoutes = require('./src/routes/pdf.routes');
const devRoutes = require('./src/routes/dev.routes');

const app = express();
const port = process.env.PORT || 5000;

// Configuración de middlewares globales
app.use(cookieParser());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));

// ────────────────────────────────────────────────────────────────────────────
// 🔐 MIDDLEWARES DE SEGURIDAD (XSS + SQL Injection)
// ────────────────────────────────────────────────────────────────────────────
app.use(logSecurityEvents);           // Log de eventos de seguridad
app.use(validateQueryParams);         // Valida parámetros de URL
app.use(validateRequestBody);         // Valida campos de texto en body

// ─── Rate Limiting ──────────────────────────────────────────────────────────
// Se aplica antes del JWT para frenar peticiones abusivas lo más temprano posible.

// Límite global de seguridad: aplica a todas las rutas
app.use(globalLimiter);

// Límite estricto en rutas de autenticación (anti-fuerza bruta)
app.use('/auth/login', authLimiter);
app.use('/auth/acceso-especial', authLimiter);

// Límite moderado en toda la API protegida
app.use('/api', apiLimiter);
app.use('/auth/validar-acceso', apiLimiter);
app.use('/auth/recargar-storage', apiLimiter);

// Límite estricto para operaciones costosas (generación de archivos / carga masiva)
app.use('/api/pdf', heavyLimiter);
app.use('/api/cargarProgra', heavyLimiter);
app.use('/api/produDiaria', heavyLimiter);
app.use('/api/kpi', heavyLimiter);

// ────────────────────────────────────────────────────────────────────────────

// Iniciar servidor
app.listen(port, () => {
  console.log("***********************************************");
  console.log(`Servidor corriendo en http://localhost:${port}`);
  console.log("***********************************************");
});

// Ruta de inicio
app.get('/', (req, res) => {
  res.send('Servidor Express funcionando en Render');
});

// Rutas públicas (sin JWT) - solo login, logout y acceso especial
app.use('/auth/login', authRoutes);
app.use('/auth/logout', authRoutes);
app.use('/auth/acceso-especial', authRoutes);

// Middleware de validación JWT - solo para rutas protegidas
app.use('/api', jwtValidationMiddleware);
app.use('/auth/validar-acceso', jwtValidationMiddleware);
app.use('/auth/recargar-storage', jwtValidationMiddleware);

// Registrar rutas protegidas modularizadas (requieren JWT)
app.use('/auth', authRoutes);
app.use('/api', agentesRoutes);
app.use('/api', cambiosRoutes);
app.use('/api', programacionRoutes);
app.use('/api', nominaRoutes);
app.use('/api', metricasRoutes);
app.use('/api', pdfRoutes);
app.use('/api', devRoutes);

// Registrar endpoints de histórico de guardia desde el service (funcionan correctamente)
historicoGuardiaPorLider(app);
fechasReportes(app);
getFechasHistoricoGuardias(app);
getHistoricoGuardia(app);
getGuardiasDelDia(app);
setRegistroGuardia(app);
