/**
 * Configuración de Rate Limiting para el servidor
 *
 * Estrategia por tipo de ruta:
 *  - globalLimiter      → Fallback de seguridad para cualquier ruta no cubierta
 *  - authLimiter        → Login y acceso especial (anti-fuerza bruta)
 *  - apiLimiter         → Endpoints generales de la API (datos, agentes, cambios, etc.)
 *  - heavyLimiter       → Operaciones costosas: generación de PDF, subida de archivos Excel
 */

const rateLimit = require('express-rate-limit');

// ─── Mensajes de error estandarizados ────────────────────────────────────────

const TOO_MANY_REQUESTS = (accion) => ({
  error: `Demasiadas solicitudes de ${accion}. Intentá de nuevo más tarde.`
});

// ─── Global (red de seguridad) ────────────────────────────────────────────────

/**
 * Límite global aplicado a todas las rutas como última línea de defensa.
 * 500 solicitudes por IP cada 10 minutos.
 */
const globalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 500,
  standardHeaders: true,  // Incluye RateLimit-* headers en la respuesta
  legacyHeaders: false,   // Deshabilita X-RateLimit-* headers deprecados
  message: TOO_MANY_REQUESTS('al servidor'),
  skipSuccessfulRequests: false
});

// ─── Autenticación (anti-fuerza bruta) ───────────────────────────────────────

/**
 * Rate limit estricto para rutas de autenticación.
 * 20 intentos por IP cada 10 minutos.
 * Aplica a: POST /auth/login, POST /auth/acceso-especial
 */
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS('autenticación'),
  skipSuccessfulRequests: false
});

// ─── API general ──────────────────────────────────────────────────────────────

/**
 * Rate limit moderado para todos los endpoints de la API protegidos por JWT.
 * 200 solicitudes por IP cada 10 minutos.
 * Aplica a: /api/*, /auth/validar-acceso, /auth/recargar-storage
 */
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS('a la API'),
  skipSuccessfulRequests: false
});

// ─── Operaciones pesadas ──────────────────────────────────────────────────────

/**
 * Rate limit estricto para rutas que generan archivos o procesan datos masivos.
 * 40 solicitudes por IP cada 8 minutos.
 * Aplica a: POST /api/pdf, POST /api/cargarProgra, POST /api/produDiaria, POST /api/kpi
 */
const heavyLimiter = rateLimit({
  windowMs: 8 * 60 * 1000, // 8 minutos
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: TOO_MANY_REQUESTS('a operaciones de procesamiento'),
  skipSuccessfulRequests: false
});

module.exports = { globalLimiter, authLimiter, apiLimiter, heavyLimiter };
