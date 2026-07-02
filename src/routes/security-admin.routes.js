/**
 * ============================================================================
 * RUTAS DE SEGURIDAD - ADMIN
 * ============================================================================
 * 
 * Endpoints para consultar y gestionar eventos de seguridad
 * Requiere autenticación y rol ADMIN
 * 
 * @author Sistema de Seguridad Pulso
 * @version 2.0.0
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const SecurityLogsService = require('../services/security-logs.service');
const jwtValidationMiddleware = require('../middlewares/jwt-validation');

/**
 * ────────────────────────────────────────────────────────────────────────────
 * PROTECCIÓN: Solo admins pueden acceder
 * ────────────────────────────────────────────────────────────────────────────
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({
      error: 'Acceso denegado',
      details: 'Solo administradores pueden acceder a esta información'
    });
  }
  next();
};

/**
 * GET /api/security/events
 * 
 * Obtiene todos los eventos de seguridad con filtros opcionales
 * 
 * Query Parameters:
 *   - user_id: string - Filtrar por usuario
 *   - ip: string - Filtrar por IP
 *   - status: number - Filtrar por código HTTP
 *   - error_type: string - Filtrar por tipo de error (xss, sql_injection, etc)
 *   - severity: string - Filtrar por severidad (LOW, MEDIUM, HIGH, CRITICAL)
 *   - date_from: ISO string - Fecha desde
 *   - date_to: ISO string - Fecha hasta
 *   - limit: number - Límite de resultados (default: 100, max: 1000)
 * 
 * @example
 *   GET /api/security/events?severity=HIGH&limit=50
 *   GET /api/security/events?user_id=12345
 *   GET /api/security/events?ip=192.168.1.1
 */
router.get('/events', jwtValidationMiddleware, requireAdmin, async (req, res) => {
  try {
    const filters = {
      user_id: req.query.user_id,
      ip: req.query.ip,
      status: req.query.status ? parseInt(req.query.status) : null,
      error_type: req.query.error_type,
      severity: req.query.severity,
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      limit: req.query.limit ? Math.min(parseInt(req.query.limit), 1000) : 100
    };

    // Limpiar filtros vacíos
    Object.keys(filters).forEach(key => filters[key] === null && delete filters[key]);

    const events = await SecurityLogsService.getAllSecurityEvents(filters);

    return res.json({
      success: true,
      count: events.length,
      data: events,
      query_filters: filters
    });
  } catch (error) {
    console.error('❌ Error en GET /events:', error);
    return res.status(500).json({
      error: 'Error obteniendo eventos de seguridad',
      details: error.message
    });
  }
});

/**
 * GET /api/security/events/user/:userId
 * 
 * Obtiene todos los eventos de seguridad de un usuario específico
 * 
 * @param userId - ID del usuario en la BD
 * 
 * @example
 *   GET /api/security/events/user/12345
 */
router.get('/events/user/:userId', jwtValidationMiddleware, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const events = await SecurityLogsService.getUserSecurityEvents(userId);

    return res.json({
      success: true,
      user_id: userId,
      count: events.length,
      data: events
    });
  } catch (error) {
    console.error('❌ Error en GET /events/user/:userId:', error);
    return res.status(500).json({
      error: 'Error obteniendo eventos del usuario',
      details: error.message
    });
  }
});

/**
 * GET /api/security/events/ip/:ip
 * 
 * Obtiene todos los eventos de seguridad desde una IP específica
 * Útil para identificar ataques coordinados
 * 
 * @param ip - Dirección IP (IPv4 o IPv6)
 * 
 * @example
 *   GET /api/security/events/ip/192.168.1.1
 *   GET /api/security/events/ip/2001:db8::1
 */
router.get('/events/ip/:ip', jwtValidationMiddleware, requireAdmin, async (req, res) => {
  try {
    const { ip } = req.params;
    const events = await SecurityLogsService.getEventsByIP(ip);

    return res.json({
      success: true,
      ip,
      count: events.length,
      data: events
    });
  } catch (error) {
    console.error('❌ Error en GET /events/ip/:ip:', error);
    return res.status(500).json({
      error: 'Error obteniendo eventos por IP',
      details: error.message
    });
  }
});

/**
 * GET /api/security/critical
 * 
 * Obtiene solo eventos críticos (severidad CRITICAL o HIGH)
 * Ideal para panel de alertas en tiempo real
 * 
 * @example
 *   GET /api/security/critical
 */
router.get('/critical', jwtValidationMiddleware, requireAdmin, async (req, res) => {
  try {
    const events = await SecurityLogsService.getCriticalEvents();

    return res.json({
      success: true,
      critical_count: events.length,
      data: events,
      last_critical: events[0] || null
    });
  } catch (error) {
    console.error('❌ Error en GET /critical:', error);
    return res.status(500).json({
      error: 'Error obteniendo eventos críticos',
      details: error.message
    });
  }
});

/**
 * GET /api/security/stats
 * 
 * Obtiene estadísticas generales de seguridad
 * 
 * Retorna:
 *   - Total de eventos
 *   - Desglose por status
 *   - Desglose por tipo de error
 *   - Desglose por severidad
 *   - Usuarios con más intentos fallidos
 *   - IPs con más intentos fallidos
 *   - Eventos en las últimas 24 horas
 * 
 * @example
 *   GET /api/security/stats
 */
router.get('/stats', jwtValidationMiddleware, requireAdmin, async (req, res) => {
  try {
    const stats = await SecurityLogsService.getSecurityStats();

    return res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Error en GET /stats:', error);
    return res.status(500).json({
      error: 'Error obteniendo estadísticas',
      details: error.message
    });
  }
});

/**
 * GET /api/security/suspicious-ips
 * 
 * Obtiene IPs con comportamiento sospechoso
 * (más intentos fallidos que el umbral configurado)
 * 
 * Query Parameters:
 *   - threshold: number - Umbral de intentos (default: 5)
 * 
 * @example
 *   GET /api/security/suspicious-ips
 *   GET /api/security/suspicious-ips?threshold=10
 */
router.get('/suspicious-ips', jwtValidationMiddleware, requireAdmin, async (req, res) => {
  try {
    const threshold = req.query.threshold ? parseInt(req.query.threshold) : 5;
    const suspiciousIPs = await SecurityLogsService.getSuspiciousIPs(threshold);

    return res.json({
      success: true,
      threshold,
      count: suspiciousIPs.length,
      data: suspiciousIPs
    });
  } catch (error) {
    console.error('❌ Error en GET /suspicious-ips:', error);
    return res.status(500).json({
      error: 'Error obteniendo IPs sospechosas',
      details: error.message
    });
  }
});

/**
 * GET /api/security/suspicious-users
 * 
 * Obtiene usuarios con comportamiento sospechoso
 * (más intentos fallidos que el umbral configurado)
 * 
 * Query Parameters:
 *   - threshold: number - Umbral de intentos (default: 5)
 * 
 * @example
 *   GET /api/security/suspicious-users
 *   GET /api/security/suspicious-users?threshold=10
 */
router.get('/suspicious-users', jwtValidationMiddleware, requireAdmin, async (req, res) => {
  try {
    const threshold = req.query.threshold ? parseInt(req.query.threshold) : 5;
    const suspiciousUsers = await SecurityLogsService.getSuspiciousUsers(threshold);

    return res.json({
      success: true,
      threshold,
      count: suspiciousUsers.length,
      data: suspiciousUsers
    });
  } catch (error) {
    console.error('❌ Error en GET /suspicious-users:', error);
    return res.status(500).json({
      error: 'Error obteniendo usuarios sospechosos',
      details: error.message
    });
  }
});

/**
 * POST /api/security/cleanup
 * 
 * Elimina eventos antiguos (cleanup)
 * CUIDADO: Esta operación es irreversible
 * 
 * Body:
 *   - days_old: number - Eliminar eventos más antiguos que X días (default: 90)
 * 
 * @example
 *   POST /api/security/cleanup
 *   Body: { "days_old": 60 }
 */
router.post('/cleanup', jwtValidationMiddleware, requireAdmin, async (req, res) => {
  try {
    const { days_old = 90 } = req.body;

    const result = await SecurityLogsService.cleanupOldEvents(days_old);

    if (!result.success) {
      return res.status(400).json({
        error: 'Error durante la limpieza',
        details: result.error
      });
    }

    return res.json({
      success: true,
      message: `Eventos más antiguos que ${days_old} días han sido eliminados`,
      deleted_count: result.data?.count || 0
    });
  } catch (error) {
    console.error('❌ Error en POST /cleanup:', error);
    return res.status(500).json({
      error: 'Error durante la limpieza',
      details: error.message
    });
  }
});

/**
 * HEALTH CHECK
 * GET /api/security/health
 * 
 * Verifica el estado del sistema de seguridad
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Security Monitoring',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
