/**
 * ============================================================================
 * MIDDLEWARE DE VALIDACIÓN DE SEGURIDAD
 * ============================================================================
 * 
 * Middleware que actúa como barrera de seguridad antes de procesar requests.
 * Protege contra:
 *   • XSS en parámetros de query
 *   • SQL Injection
 *   • Validación de tipos de datos
 *   • Rate limiting por validación fallida
 * 
 * @author Sistema de Seguridad Pulso
 * @version 2.0.0
 * ============================================================================
 */

const validateInput = require('../validators/input.validator');

/**
 * Middleware para validar parámetros de query común en la aplicación
 * Uso: app.use(validateQueryParams);
 */
const validateQueryParams = (req, res, next) => {
  try {
    // Validar parámetros comunes que no tendrían que contener HTML
    const queryParams = req.query;
    const suspiciousPatterns = ['<', '>', 'script', 'onerror', 'onclick'];

    for (const [key, value] of Object.entries(queryParams)) {
      if (typeof value === 'string') {
        // Detectar patrones sospechosos
        if (suspiciousPatterns.some(pattern => value.toLowerCase().includes(pattern))) {
          console.warn(`🚨 ALERTA DE SEGURIDAD: Parámetro sospechoso detectado en query "${key}"`);
          return res.status(400).json({
            error: 'Parámetro inválido detectado',
            details: 'Los parámetros contienen caracteres o patrones no permitidos'
          });
        }
      }
    }

    next();
  } catch (error) {
    console.error('Error en middleware de validación:', error);
    res.status(500).json({ error: 'Error de validación interno' });
  }
};

/**
 * Middleware para validar y sanitizar body de requests POST/PUT
 * Especialmente útil para observaciones y campos de texto largo
 */
const validateRequestBody = (req, res, next) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return next();
    }

    // Sanitizar y validar campos de texto largo
    const textFields = ['obs1', 'obs2', 'observacion', 'observaciones', 'notas', 'comentario'];
    
    for (const field of textFields) {
      if (req.body[field]) {
        const validation = validateInput.validateText(req.body[field], {
          maxLength: 500,
          fieldName: field
        });

        if (!validation.isValid) {
          return res.status(400).json({
            error: `Validación fallida en campo "${field}"`,
            details: validation.error
          });
        }

        // Asignar valor sanitizado
        req.body[field] = validation.value;
      }
    }

    next();
  } catch (error) {
    console.error('Error en validación de body:', error);
    res.status(500).json({ error: 'Error de validación interno' });
  }
};

/**
 * Middleware específico para validar cambios de francos
 * Usado en: POST /api/cambios/intercambiar-francos
 */
const validateFrancoExchange = (req, res, next) => {
  try {
    const { dni_agente1, dni_agente2, franco1, franco2, obs1, obs2, mail_lider } = req.body;

    // Validar DNIs
    const dniValidation1 = validateInput.validateDNI(dni_agente1);
    const dniValidation2 = validateInput.validateDNI(dni_agente2);

    if (!dniValidation1.isValid) {
      return res.status(400).json({
        error: 'DNI del agente 1 inválido',
        details: dniValidation1.error
      });
    }

    if (!dniValidation2.isValid) {
      return res.status(400).json({
        error: 'DNI del agente 2 inválido',
        details: dniValidation2.error
      });
    }

    // Validar email del líder
    const emailValidation = validateInput.validateEmail(mail_lider);
    if (!emailValidation.isValid) {
      return res.status(400).json({
        error: 'Email del líder inválido',
        details: emailValidation.error
      });
    }

    // Validar observaciones
    const obs1Validation = validateInput.validateText(obs1 || '', {
      maxLength: 300,
      minLength: 0,
      fieldName: 'Observaciones agente 1'
    });

    const obs2Validation = validateInput.validateText(obs2 || '', {
      maxLength: 300,
      minLength: 0,
      fieldName: 'Observaciones agente 2'
    });

    if (!obs1Validation.isValid) {
      return res.status(400).json({
        error: 'Validación fallida',
        details: obs1Validation.error
      });
    }

    if (!obs2Validation.isValid) {
      return res.status(400).json({
        error: 'Validación fallida',
        details: obs2Validation.error
      });
    }

    // Asignar valores validados al request
    req.validatedData = {
      dni_agente1: dniValidation1.value,
      dni_agente2: dniValidation2.value,
      franco1: Number(franco1),
      franco2: Number(franco2),
      obs1: obs1Validation.value,
      obs2: obs2Validation.value,
      mail_lider: emailValidation.value
    };

    next();
  } catch (error) {
    console.error('Error en validación de cambio de francos:', error);
    res.status(500).json({ error: 'Error de validación interno' });
  }
};

/**
 * Middleware específico para validar obtención de rango
 * Usado en: GET /api/email/rango
 */
const validateEmailRangoRequest = (req, res, next) => {
  try {
    const email = req.query.mail;

    if (!email) {
      return res.status(400).json({
        error: 'Parámetro requerido faltante',
        details: 'El parámetro "mail" es requerido'
      });
    }

    const emailValidation = validateInput.validateEmail(email);

    if (!emailValidation.isValid) {
      return res.status(400).json({
        error: 'Email inválido',
        details: emailValidation.error
      });
    }

    // Asignar email validado
    req.validatedData = { email: emailValidation.value };

    next();
  } catch (error) {
    console.error('Error en validación de email:', error);
    res.status(500).json({ error: 'Error de validación interno' });
  }
};

/**
 * Middleware específico para validar obtención de agentes
 * Usado en: GET /api/agentes
 */
const validateAgentesRequest = (req, res, next) => {
  try {
    const dni_lider = req.query.dni_lider;

    if (!dni_lider) {
      return res.status(400).json({
        error: 'Parámetro requerido faltante',
        details: 'El parámetro "dni_lider" es requerido'
      });
    }

    const dniValidation = validateInput.validateDNI(dni_lider);

    if (!dniValidation.isValid) {
      return res.status(400).json({
        error: 'DNI inválido',
        details: dniValidation.error
      });
    }

    // Asignar DNI validado
    req.validatedData = { dni_lider: dniValidation.value };

    next();
  } catch (error) {
    console.error('Error en validación de agentes:', error);
    res.status(500).json({ error: 'Error de validación interno' });
  }
};

/**
 * Middleware para logging de intentos sospechosos
 * Muestra en consola información COMPLETA del ataque con todos los detalles del usuario
 */
const logSecurityEvents = (req, res, next) => {
  try {
    // Interceptar el método res.json para loguear respuestas de error
    const originalJson = res.json;

    res.json = function(data) {
      if (res.statusCode >= 400 && data.error) {
        const timestamp = new Date();
        const errorType = _detectErrorType(data.error);
        const severity = _calculateSeverity(errorType, res.statusCode);

        // Extraer datos del usuario desde el JWT decodificado
        // Los campos del JWT son: sub (Google ID), email, name, given_name, family_name, rol, rango, segmento
        const user = req.user;
        const userId      = user?.sub   || null;
        const userEmail   = user?.email || null;
        const userName    = user?.name  || (user?.given_name ? `${user.given_name} ${user.family_name || ''}`.trim() : null);
        const userRol     = user?.rol   || null;
        const userRango   = user?.rango !== undefined ? user.rango : null;
        const userSegmento = user?.segmento || null;

        // 🚨 INFORMACIÓN COMPLETA DEL ATAQUE/ERROR
        const logMessage = `
╔════════════════════════════════════════════════════════════════════════════╗
║                     🚨 EVENTO DE SEGURIDAD DETECTADO                      ║
╠════════════════════════════════════════════════════════════════════════════╣
║
║  📅 FECHA Y HORA
║  ├─ Timestamp: ${timestamp.toISOString()}
║  └─ Hora local: ${timestamp.toLocaleString('es-AR')}
║
║  👤 INFORMACIÓN DEL USUARIO
║  ├─ ID (Google sub): ${userId        || '❓ No autenticado'}
║  ├─ Email:           ${userEmail     || '❓ No autenticado'}
║  ├─ Nombre:          ${userName      || '❓ Desconocido'}
║  ├─ Rol:             ${userRol       || '❓ Desconocido'}
║  ├─ Rango:           ${userRango     !== null ? userRango : '❓ Desconocido'}
║  ├─ Segmento:        ${userSegmento  || '❓ Desconocido'}
║  └─ Estado:          ${user ? '✅ Autenticado' : '❌ Anónimo / Sin sesión'}
║
║  🌐 RED Y CONEXIÓN
║  ├─ IP: ${req.ip || req.connection.remoteAddress || '❓ Desconocida'}
║  ├─ User-Agent: ${req.get('user-agent') ? req.get('user-agent').substring(0, 60) + '...' : '❓ Desconocido'}
║  ├─ Origin: ${req.get('origin') || '❓ Desconocido'}
║  └─ Host: ${req.get('host') || '❓ Desconocido'}
║
║  🔴 ATAQUE/ERROR
║  ├─ Tipo: ${errorType.toUpperCase()} [${severity}]
║  ├─ Método HTTP: ${req.method}
║  ├─ Ruta: ${req.path}
║  ├─ Status Code: ${res.statusCode}
║  ├─ Mensaje Error: ${data.error}
║  └─ Detalles: ${data.details || 'N/A'}
║
║  📨 PARÁMETROS ENVIADOS
║  ├─ Query Params: ${JSON.stringify(req.query).substring(0, 80)}
║  └─ Body enviado: ${JSON.stringify(req.body).substring(0, 80)}
║
╚════════════════════════════════════════════════════════════════════════════╝
        `;

        console.log(logMessage);

        // 📧 Enviar notificación a mail/Slack/Discord (si está configurado)
        _notifySecurityEvent({
          timestamp: timestamp.toISOString(),
          errorType,
          severity,
          method: req.method,
          route: req.path,
          status: res.statusCode,
          user_id:       userId       || 'No autenticado',
          user_email:    userEmail    || 'No autenticado',
          user_name:     userName     || 'Desconocido',
          user_role:     userRol      || 'Desconocido',
          user_rango:    userRango    !== null ? userRango : 'Desconocido',
          user_segmento: userSegmento || 'Desconocido',
          ip:            req.ip || req.connection?.remoteAddress || 'Desconocida',
          user_agent:    req.get('user-agent') || 'Desconocido',
          origin:        req.get('origin') || 'Desconocido',
          error_message: data.error,
          error_details: data.details
        }).catch(err => console.error('⚠️ Error enviando notificación:', err));
      }
      return originalJson.call(this, data);
    };

    next();
  } catch (error) {
    console.error('Error en middleware de logging de seguridad:', error);
    next();
  }
};

/**
 * Detecta el tipo de error basado en el mensaje
 * @private
 */
const _detectErrorType = (errorMessage) => {
  const msg = errorMessage?.toLowerCase() || '';

  if (msg.includes('token') || msg.includes('jwt') || msg.includes('expirado') || msg.includes('expired')) return 'token_expired';
  if (msg.includes('script') || msg.includes('html') || msg.includes('xss')) return 'xss';
  if (msg.includes('sql') || msg.includes('injection') || msg.includes('drop') || msg.includes('select')) return 'sql_injection';
  if (msg.includes('email')) return 'email_injection';
  if (msg.includes('comando') || msg.includes('command')) return 'command_injection';
  if (msg.includes('parámetro') || msg.includes('parameter')) return 'invalid_parameter';
  if (msg.includes('validación') || msg.includes('validation')) return 'validation_error';
  if (msg.includes('autenticación') || msg.includes('authentication')) return 'auth_error';
  if (msg.includes('autorización') || msg.includes('authorization')) return 'authorization_error';

  return 'unknown_error';
};

/**
 * Calcula la severidad de un evento
 * @private
 */
const _calculateSeverity = (errorType, status) => {
  if (status >= 500) return '🔴 CRITICAL';
  if (status === 403) return '🟠 HIGH';
  if (errorType === 'sql_injection' || errorType === 'xss') return '🟠 HIGH';
  if (status >= 400) return '🟡 MEDIUM';
  return '🟢 LOW';
};

// Cooldown de alertas: evita enviar múltiples emails por el mismo evento repetido
// Clave: "ip:errorType" → timestamp del último envío
const _alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = (parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 5) * 60 * 1000;

// Tipos de error que NO generan email (comportamiento normal, no ataques)
const _NO_EMAIL_TYPES = new Set(['token_expired']);

// Transporter reutilizable (se crea una sola vez)
let _mailerTransporter = null;
const _getTransporter = () => {
  if (!_mailerTransporter) {
    const nodemailer = require('nodemailer');
    _mailerTransporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT) || 587,
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });
  }
  return _mailerTransporter;
};

/**
 * Envía notificaciones de seguridad (mail/Slack/Discord)
 * Se ejecuta de forma asincrónica sin bloquear la respuesta
 * @private
 */
const _notifySecurityEvent = async (eventData) => {
  // Nunca enviar email para tipos de error que son comportamiento normal
  if (_NO_EMAIL_TYPES.has(eventData.errorType)) {
    return;
  }

  // Cooldown: no enviar el mismo tipo de alerta para la misma IP más de una vez por período
  const cooldownKey = `${eventData.ip}:${eventData.errorType}`;
  const lastSent = _alertCooldowns.get(cooldownKey);
  const now = Date.now();
  if (lastSent && (now - lastSent) < ALERT_COOLDOWN_MS) {
    return;
  }
  _alertCooldowns.set(cooldownKey, now);

  // 📧 MAIL: Si está configurado en .env
  if (process.env.MAIL_ALERTS_ENABLED === 'true') {
    try {
      const transporter = _getTransporter();

      await transporter.sendMail({
        from: process.env.MAIL_FROM || 'seguridad@pulso.com',
        to: process.env.MAIL_ALERTS_TO || 'admin@empresa.com',
        subject: `🚨 ALERTA DE SEGURIDAD [${eventData.severity}] - ${eventData.errorType.toUpperCase()}`,
        html: `
          <!DOCTYPE html>
          <html lang="es">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 20px;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background: white;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              }
              .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 30px;
                text-align: center;
                border-bottom: 4px solid #ff6b6b;
              }
              .header h1 {
                font-size: 24px;
                margin-bottom: 10px;
              }
              .severity-badge {
                display: inline-block;
                padding: 8px 16px;
                border-radius: 20px;
                font-weight: bold;
                font-size: 12px;
                margin-top: 10px;
              }
              .severity-critical { background: #ff6b6b; color: white; }
              .severity-high { background: #ff9f43; color: white; }
              .severity-medium { background: #ffc107; color: #333; }
              .severity-low { background: #28a745; color: white; }
              .content {
                padding: 30px;
              }
              .section {
                margin-bottom: 25px;
                background: #f8f9fa;
                padding: 20px;
                border-radius: 8px;
                border-left: 4px solid #667eea;
              }
              .section h2 {
                color: #333;
                font-size: 14px;
                text-transform: uppercase;
                margin-bottom: 15px;
                letter-spacing: 1px;
                display: flex;
                align-items: center;
              }
              .section h2:before {
                content: '';
                display: inline-block;
                width: 8px;
                height: 8px;
                background: #667eea;
                border-radius: 50%;
                margin-right: 10px;
              }
              .field {
                display: flex;
                margin-bottom: 12px;
                align-items: flex-start;
              }
              .field-label {
                font-weight: bold;
                color: #667eea;
                min-width: 140px;
                flex-shrink: 0;
              }
              .field-value {
                color: #555;
                word-break: break-word;
                flex: 1;
              }
              .error-section {
                background: #ffe5e5;
                border-left-color: #ff6b6b;
              }
              .error-section .field-label {
                color: #d63031;
              }
              .attack-section {
                background: #fff3cd;
                border-left-color: #ffc107;
              }
              .attack-section .field-label {
                color: #ff9f43;
              }
              .footer {
                background: #f8f9fa;
                padding: 20px;
                text-align: center;
                color: #666;
                font-size: 12px;
                border-top: 1px solid #e0e0e0;
              }
              .alert-box {
                background: #fff3cd;
                border: 1px solid #ffc107;
                border-radius: 6px;
                padding: 15px;
                margin-bottom: 20px;
                color: #856404;
              }
              .alert-box strong {
                color: #ff9f43;
              }
              .timestamp {
                color: #999;
                font-size: 11px;
                text-align: center;
                padding-top: 10px;
              }
              .divider {
                height: 1px;
                background: #e0e0e0;
                margin: 20px 0;
              }
              code {
                background: #f0f0f0;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: 'Courier New', monospace;
                font-size: 12px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <!-- HEADER -->
              <div class="header">
                <h1>🚨 EVENTO DE SEGURIDAD DETECTADO</h1>
                <span class="severity-badge severity-${eventData.severity.toLowerCase().split(' ')[1] || 'critical'}">
                  ${eventData.severity}
                </span>
              </div>

              <!-- CONTENIDO -->
              <div class="content">
                
                <!-- ALERTA -->
                <div class="alert-box">
                  <strong>⚠️ Tipo de Ataque:</strong> ${eventData.errorType.toUpperCase()}<br>
                  <strong>Estado:</strong> Bloqueado y registrado
                </div>

                <!-- INFORMACIÓN DEL ATAQUE -->
                <div class="section attack-section">
                  <h2>DETALLES DEL ATAQUE</h2>
                  <div class="field">
                    <span class="field-label">Tipo:</span>
                    <span class="field-value"><strong>${eventData.errorType.toUpperCase()}</strong></span>
                  </div>
                  <div class="field">
                    <span class="field-label">Método HTTP:</span>
                    <span class="field-value">${eventData.method}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Ruta Atacada:</span>
                    <span class="field-value"><code>${eventData.route}</code></span>
                  </div>
                  <div class="field">
                    <span class="field-label">Status HTTP:</span>
                    <span class="field-value"><strong>${eventData.status}</strong> (Bloqueado)</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Mensaje:</span>
                    <span class="field-value">${eventData.error_message}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Detalles:</span>
                    <span class="field-value">${eventData.error_details || 'N/A'}</span>
                  </div>
                </div>

                <!-- INFORMACIÓN DEL USUARIO -->
                <div class="section">
                  <h2>INFORMACIÓN DEL USUARIO</h2>
                  <div class="field">
                    <span class="field-label">Email:</span>
                    <span class="field-value">${eventData.user_email}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Nombre:</span>
                    <span class="field-value">${eventData.user_name}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">ID (Google sub):</span>
                    <span class="field-value" style="font-size:11px;">${eventData.user_id}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Rol:</span>
                    <span class="field-value"><strong>${eventData.user_role}</strong></span>
                  </div>
                  <div class="field">
                    <span class="field-label">Rango:</span>
                    <span class="field-value">${eventData.user_rango}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Segmento:</span>
                    <span class="field-value">${eventData.user_segmento}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Estado:</span>
                    <span class="field-value">${eventData.user_id === 'No autenticado' ? '❌ Anónimo / Sin sesión' : '✅ Autenticado'}</span>
                  </div>
                </div>

                <!-- INFORMACIÓN DE RED -->
                <div class="section">
                  <h2>INFORMACIÓN DE RED</h2>
                  <div class="field">
                    <span class="field-label">IP Origen:</span>
                    <span class="field-value"><strong>${eventData.ip}</strong></span>
                  </div>
                  <div class="field">
                    <span class="field-label">User-Agent:</span>
                    <span class="field-value" style="font-size: 11px;">${eventData.user_agent ? eventData.user_agent.substring(0, 100) : 'Desconocido'}</span>
                  </div>
                  <div class="field">
                    <span class="field-label">Origin:</span>
                    <span class="field-value">${eventData.origin}</span>
                  </div>
                </div>

                <!-- FECHA Y HORA -->
                <div class="section">
                  <h2>FECHA Y HORA</h2>
                  <div class="field">
                    <span class="field-label">Timestamp UTC:</span>
                    <span class="field-value"><code>${eventData.timestamp}</code></span>
                  </div>
                </div>

                <div class="divider"></div>

                <!-- PIE -->
                <div class="footer">
                  <p><strong>Sistema de Seguridad Pulso VAM v2.0</strong></p>
                  <p>Este evento ha sido bloqueado automáticamente por el sistema de protección.</p>
                  <p style="margin-top: 10px; color: #999;">Este es un correo automático. Por favor no responda.</p>
                  <div class="timestamp">
                    Generado: ${new Date().toLocaleString('es-AR')}<br>
                    Sistema: Pulso Security Monitoring
                  </div>
                </div>

              </div>
            </div>
          </body>
          </html>
        `
      });

      console.log('✅ Notificación de seguridad enviada por EMAIL');
    } catch (error) {
      console.error('❌ Error enviando email de alerta:', error.message);
    }
  }

  // 🔔 SLACK: Si está configurado en .env
  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      const fetch = require('node-fetch');
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 ALERTA DE SEGURIDAD [${eventData.severity}]`,
          attachments: [{
            color: eventData.severity === '🔴 CRITICAL' ? 'danger' : eventData.severity === '🟠 HIGH' ? 'warning' : 'good',
            fields: [
              { title: 'Tipo', value: eventData.errorType, short: true },
              { title: 'Usuario', value: eventData.user_email, short: true },
              { title: 'Ruta', value: eventData.route, short: true },
              { title: 'IP', value: eventData.ip, short: true },
              { title: 'Fecha', value: eventData.timestamp, short: false },
              { title: 'Mensaje', value: eventData.error_message, short: false }
            ]
          }]
        })
      });

      console.log('✅ Notificación de seguridad enviada a SLACK');
    } catch (error) {
      console.error('❌ Error enviando alerta a Slack:', error.message);
    }
  }

  // 🎮 DISCORD: Si está configurado en .env
  if (process.env.DISCORD_WEBHOOK_URL) {
    try {
      const fetch = require('node-fetch');
      const colorMap = {
        '🔴 CRITICAL': 16711680, // Rojo
        '🟠 HIGH': 16760832,     // Naranja
        '🟡 MEDIUM': 16776960,   // Amarillo
        '🟢 LOW': 65280           // Verde
      };

      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `🚨 ALERTA DE SEGURIDAD [${eventData.severity}]`,
            description: `**Tipo:** ${eventData.errorType}\n**Usuario:** ${eventData.user_email}\n**Ruta:** ${eventData.route}`,
            color: colorMap[eventData.severity] || 16711680,
            fields: [
              { name: 'Método', value: eventData.method, inline: true },
              { name: 'Status', value: `${eventData.status}`, inline: true },
              { name: 'IP', value: eventData.ip, inline: true },
              { name: 'Rol', value: eventData.user_role, inline: true },
              { name: 'Mensaje', value: eventData.error_message },
              { name: 'Detalles', value: eventData.error_details || 'N/A' }
            ],
            timestamp: new Date().toISOString()
          }]
        })
      });

      console.log('✅ Notificación de seguridad enviada a DISCORD');
    } catch (error) {
      console.error('❌ Error enviando alerta a Discord:', error.message);
    }
  }
};

module.exports = {
  validateQueryParams,
  validateRequestBody,
  validateFrancoExchange,
  validateEmailRangoRequest,
  validateAgentesRequest,
  logSecurityEvents
};
