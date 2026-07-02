/**
 * ============================================================================
 * EJEMPLO DE INTEGRACIÓN DE SEGURIDAD EN RUTAS
 * ============================================================================
 * 
 * Este archivo muestra cómo integrar los validadores de seguridad
 * en las rutas existentes. Copiar estas prácticas a todas las rutas.
 * 
 * ANTES (Vulnerable):
 * ────────────────────────────────────────────────────────────────
 * router.get('/agentes', (req, res) => {
 *   const dni_lider = req.query.dni_lider;  // ❌ SIN VALIDAR
 *   let { data } = await supabase.from('agentes')
 *     .select('*')
 *     .eq('dni_lider', dni_lider);
 *   res.json(data);
 * });
 * 
 * DESPUÉS (Seguro):
 * ────────────────────────────────────────────────────────────────
 * Ver código abajo...
 * 
 * @author Sistema de Seguridad Pulso
 * @version 2.0.0
 * ============================================================================
 */

const express = require('express');
const validateInput = require('../validators/input.validator');
const {
  validateQueryParams,
  validateFrancoExchange,
  validateEmailRangoRequest,
  validateAgentesRequest,
  logSecurityEvents
} = require('../middlewares/security-validation.middleware');

const router = express.Router();

/**
 * ============================================================================
 * EJEMPLO 1: GET /api/agentes - Obtener agentes de un líder
 * ============================================================================
 * 
 * VULNERABILIDAD ORIGINAL:
 *   ❌ dni_lider no se validaba
 *   ❌ Sin protección contra SQL injection
 * 
 * SOLUCIÓN:
 *   ✅ Middleware de validación específico
 *   ✅ Uso de validador de DNI
 *   ✅ Logging de eventos de seguridad
 */

router.get('/agentes',
  logSecurityEvents,           // Registrar evento
  validateAgentesRequest,      // Validar DNI del líder
  async (req, res) => {
    try {
      // Los datos ya están validados en req.validatedData
      const dni_lider = req.validatedData.dni_lider;

      console.log(`📋 Obteniendo agentes para líder: ${dni_lider}`);

      // Usar supabase RPC con parámetros vinculados (seguro)
      let { data: agentes, error } = await supabase
        .from('agentes')
        .select('dni, nombre, email')
        .eq('dni_lider', dni_lider);

      if (error) {
        console.error('Error en Supabase:', error);
        return res.status(500).json({
          error: 'Error al obtener agentes',
          details: 'Por favor, intenta de nuevo más tarde'
        });
      }

      console.log(`✅ ${agentes?.length || 0} agentes encontrados`);

      return res.json({
        success: true,
        count: agentes?.length || 0,
        data: agentes || []
      });

    } catch (error) {
      console.error('Error en ruta /agentes:', error);
      return res.status(500).json({
        error: 'Error interno del servidor',
        details: error.message
      });
    }
  }
);

/**
 * ============================================================================
 * EJEMPLO 2: GET /api/email/rango - Obtener rango por email
 * ============================================================================
 * 
 * VULNERABILIDAD ORIGINAL:
 *   ❌ Email no se validaba
 *   ❌ Sin verificación de formato
 * 
 * SOLUCIÓN:
 *   ✅ Validación de email con regex seguro
 *   ✅ Trim y lowercase automático
 *   ✅ Limit de longitud
 */

router.get('/email/rango',
  logSecurityEvents,
  validateEmailRangoRequest,
  async (req, res) => {
    try {
      // Email ya validado y sanitizado
      const email = req.validatedData.email;

      console.log(`📧 Obteniendo rango para email: ${email}`);

      // Usar RPC de Supabase con parámetros vinculados
      let { data: rango, error } = await supabase.rpc('getrango', {
        mail: email
      });

      if (error) {
        console.error('Error en Supabase:', error);
        return res.status(500).json({
          error: 'Error al obtener rango',
          details: 'Por favor, verifica el email e intenta de nuevo'
        });
      }

      return res.json({
        success: true,
        email: email,
        rango: rango || null
      });

    } catch (error) {
      console.error('Error en ruta /email/rango:', error);
      return res.status(500).json({
        error: 'Error interno del servidor',
        details: error.message
      });
    }
  }
);

/**
 * ============================================================================
 * EJEMPLO 3: POST /api/cambios/intercambiar-francos - Cambio de francos
 * ============================================================================
 * 
 * VULNERABILIDAD ORIGINAL:
 *   ❌ Observaciones sin sanitizar
 *   ❌ Emails sin validar
 *   ❌ DNIs sin validación de rango
 * 
 * SOLUCIÓN:
 *   ✅ Validación completa de todos los campos
 *   ✅ Middleware especializado para este endpoint
 *   ✅ Valores validados listos para usar
 */

router.post('/cambios/intercambiar-francos',
  logSecurityEvents,
  validateFrancoExchange,  // Validación completa
  async (req, res) => {
    try {
      // Todos los datos ya están validados
      const {
        dni_agente1,
        dni_agente2,
        franco1,
        franco2,
        obs1,
        obs2,
        mail_lider
      } = req.validatedData;

      console.log(`
        🔄 Intercambio de francos:
        ├─ Agente 1 (DNI: ${dni_agente1}) - Franco ${franco1}
        ├─ Agente 2 (DNI: ${dni_agente2}) - Franco ${franco2}
        ├─ Líder: ${mail_lider}
        └─ Observaciones validadas
      `);

      // Validación adicional de lógica de negocio
      if (dni_agente1 === dni_agente2) {
        return res.status(400).json({
          error: 'Validación fallida',
          details: 'No se puede intercambiar con el mismo agente'
        });
      }

      // Usar RPC de Supabase (procedimiento almacenado)
      const { data, error } = await supabase.rpc('intercambiar_francos_pruebas', {
        dni1: dni_agente1,
        dni2: dni_agente2,
        franco1: franco1,
        franco2: franco2,
        obs_agente1: obs1,
        obs_agente2: obs2,
        email_lider: mail_lider
      });

      if (error) {
        console.error('Error en intercambio:', error);
        return res.status(400).json({
          error: 'Error al procesar el intercambio',
          details: error.message || 'Verifica los datos e intenta de nuevo'
        });
      }

      console.log(`✅ Intercambio procesado exitosamente`);

      return res.json({
        success: true,
        message: 'Intercambio de francos procesado exitosamente',
        data: data
      });

    } catch (error) {
      console.error('Error en intercambio de francos:', error);
      return res.status(500).json({
        error: 'Error interno del servidor',
        details: error.message
      });
    }
  }
);

/**
 * ============================================================================
 * EJEMPLO 4: Validación manual para casos especiales
 * ============================================================================
 * 
 * Si necesitas validar campos especiales, usa directamente el validador:
 */

router.post('/ejemplo/validacion-custom', async (req, res) => {
  try {
    // Validar múltiples campos a la vez
    const validation = validateInput.validateBatch(
      {
        dni: req.body.dni,
        email: req.body.email,
        observacion: req.body.observacion
      },
      {
        dni: { type: 'dni' },
        email: { type: 'email' },
        observacion: { type: 'text', maxLength: 300 }
      }
    );

    // Verificar si la validación fue exitosa
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Validación fallida',
        details: validation.errors
      });
    }

    // Usar valores validados
    const { dni, email, observacion } = validation.values;

    console.log('✅ Valores validados:', { dni, email, observacion });

    // Procesar con datos seguros...

    return res.json({
      success: true,
      message: 'Datos procesados exitosamente',
      data: validation.values
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

/**
 * ============================================================================
 * RECOMENDACIONES DE IMPLEMENTACIÓN
 * ============================================================================
 * 
 * 1. APLICAR A TODAS LAS RUTAS:
 *    └─ Reemplaza todas las rutas GET con parámetros usando los validadores
 *    └─ Añade logSecurityEvents a todas las rutas
 * 
 * 2. EN server.js (ARCHIVO PRINCIPAL):
 *    Añadir al inicio:
 *    
 *    const { validateQueryParams, logSecurityEvents } = require('./src/middlewares/security-validation.middleware');
 *    
 *    app.use(validateQueryParams);  // Aplica a todas las rutas
 *    app.use(logSecurityEvents);     // Log global de eventos
 * 
 * 3. TESTING:
 *    └─ Prueba intentando inyectar: "'; DROP TABLE agentes; --"
 *    └─ Prueba con XSS: "<script>alert('xss')</script>"
 *    └─ Verificar que el middleware rechace con 400
 * 
 * 4. MONITOREO:
 *    └─ Revisar logs regularmente
 *    └─ Configurar alertas para múltiples errores 400 desde la misma IP
 *    └─ Implementar rate limiting por IP
 */

module.exports = router;
