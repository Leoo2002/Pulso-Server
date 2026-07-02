/**
 * ============================================================================
 * SERVICIO DE LOGS DE SEGURIDAD
 * ============================================================================
 * 
 * Gestiona el almacenamiento y consulta de eventos de seguridad
 * Guarda información completa del usuario y del ataque
 * 
 * Tablas requeridas en Supabase:
 *   - security_events (ver SQL al final)
 * 
 * @author Sistema de Seguridad Pulso
 * @version 2.0.0
 * ============================================================================
 */

const { supabaseClient } = require('../config/database');

class SecurityLogsService {
  /**
   * Registra un evento de seguridad en la BD
   * @param {Object} eventData - Datos del evento
   * @returns {Promise<Object>} Evento guardado o error
   */
  static async logSecurityEvent(eventData) {
    try {
      const {
        timestamp,
        method,
        route,
        ip,
        status,
        error_type,
        error_message,
        error_details,
        payload,
        query_params,
        user_id,
        user_email,
        user_name,
        user_role,
        user_agent,
        origin
      } = eventData;

      const { data, error } = await supabaseClient
        .from('security_events')
        .insert([
          {
            timestamp: timestamp || new Date().toISOString(),
            method,
            route,
            ip,
            status,
            error_type,
            error_message,
            error_details,
            payload: payload ? JSON.stringify(payload) : null,
            query_params: query_params ? JSON.stringify(query_params) : null,
            user_id,
            user_email,
            user_name,
            user_role,
            user_agent,
            origin,
            severity: this._calculateSeverity(error_type, status)
          }
        ]);

      if (error) {
        console.error('❌ Error guardando evento de seguridad:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('❌ Error en logSecurityEvent:', error);
      return { success: false, error };
    }
  }

  /**
   * Obtiene todos los eventos de seguridad
   * @param {Object} filters - Filtros opcionales {user_id, ip, status, date_from, date_to}
   * @returns {Promise<Array>} Lista de eventos
   */
  static async getAllSecurityEvents(filters = {}) {
    try {
      let query = supabaseClient
        .from('security_events')
        .select('*')
        .order('timestamp', { ascending: false });

      // Aplicar filtros
      if (filters.user_id) {
        query = query.eq('user_id', filters.user_id);
      }

      if (filters.ip) {
        query = query.eq('ip', filters.ip);
      }

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.error_type) {
        query = query.eq('error_type', filters.error_type);
      }

      if (filters.severity) {
        query = query.eq('severity', filters.severity);
      }

      if (filters.date_from && filters.date_to) {
        query = query
          .gte('timestamp', filters.date_from)
          .lte('timestamp', filters.date_to);
      }

      // Limitar resultados
      const limit = filters.limit || 100;
      query = query.limit(limit);

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error obteniendo eventos:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('❌ Error en getAllSecurityEvents:', error);
      return [];
    }
  }

  /**
   * Obtiene eventos de un usuario específico
   * @param {string|number} userId - ID del usuario
   * @returns {Promise<Array>} Eventos del usuario
   */
  static async getUserSecurityEvents(userId) {
    try {
      const { data, error } = await supabaseClient
        .from('security_events')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) {
        console.error('❌ Error obteniendo eventos del usuario:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('❌ Error en getUserSecurityEvents:', error);
      return [];
    }
  }

  /**
   * Obtiene eventos por IP
   * @param {string} ip - Dirección IP
   * @returns {Promise<Array>} Eventos desde esa IP
   */
  static async getEventsByIP(ip) {
    try {
      const { data, error } = await supabaseClient
        .from('security_events')
        .select('*')
        .eq('ip', ip)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) {
        console.error('❌ Error obteniendo eventos por IP:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('❌ Error en getEventsByIP:', error);
      return [];
    }
  }

  /**
   * Obtiene eventos críticos (severidad CRITICAL o HIGH)
   * @returns {Promise<Array>} Eventos críticos
   */
  static async getCriticalEvents() {
    try {
      const { data, error } = await supabaseClient
        .from('security_events')
        .select('*')
        .in('severity', ['CRITICAL', 'HIGH'])
        .order('timestamp', { ascending: false })
        .limit(100);

      if (error) {
        console.error('❌ Error obteniendo eventos críticos:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('❌ Error en getCriticalEvents:', error);
      return [];
    }
  }

  /**
   * Obtiene un resumen/estadísticas de eventos
   * @returns {Promise<Object>} Estadísticas
   */
  static async getSecurityStats() {
    try {
      const { data, error } = await supabaseClient
        .from('security_events')
        .select('status, error_type, severity, user_id, ip');

      if (error) {
        console.error('❌ Error obteniendo estadísticas:', error);
        return {};
      }

      const stats = {
        total_events: data?.length || 0,
        by_status: {},
        by_error_type: {},
        by_severity: {},
        by_user: {},
        by_ip: {},
        last_24h: 0
      };

      if (!data || data.length === 0) return stats;

      // Procesar estadísticas
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      data.forEach(event => {
        // Por status
        stats.by_status[event.status] = (stats.by_status[event.status] || 0) + 1;

        // Por tipo de error
        stats.by_error_type[event.error_type] = (stats.by_error_type[event.error_type] || 0) + 1;

        // Por severidad
        stats.by_severity[event.severity] = (stats.by_severity[event.severity] || 0) + 1;

        // Por usuario
        if (event.user_id) {
          stats.by_user[event.user_id] = (stats.by_user[event.user_id] || 0) + 1;
        }

        // Por IP
        if (event.ip) {
          stats.by_ip[event.ip] = (stats.by_ip[event.ip] || 0) + 1;
        }

        // Últimas 24 horas
        if (new Date(event.timestamp) > oneDayAgo) {
          stats.last_24h++;
        }
      });

      return stats;
    } catch (error) {
      console.error('❌ Error en getSecurityStats:', error);
      return {};
    }
  }

  /**
   * Obtiene IPs sospechosas (más de X intentos fallidos)
   * @param {number} threshold - Umbral de intentos (default: 5)
   * @returns {Promise<Array>} IPs sospechosas con conteo
   */
  static async getSuspiciousIPs(threshold = 5) {
    try {
      const stats = await this.getSecurityStats();
      const suspiciousIPs = [];

      for (const [ip, count] of Object.entries(stats.by_ip || {})) {
        if (count >= threshold) {
          suspiciousIPs.push({ ip, attempts: count });
        }
      }

      return suspiciousIPs.sort((a, b) => b.attempts - a.attempts);
    } catch (error) {
      console.error('❌ Error en getSuspiciousIPs:', error);
      return [];
    }
  }

  /**
   * Obtiene usuarios sospechosos (más de X intentos fallidos)
   * @param {number} threshold - Umbral de intentos (default: 5)
   * @returns {Promise<Array>} Usuarios sospechosos
   */
  static async getSuspiciousUsers(threshold = 5) {
    try {
      const stats = await this.getSecurityStats();
      const suspiciousUsers = [];

      for (const [userId, count] of Object.entries(stats.by_user || {})) {
        if (count >= threshold) {
          suspiciousUsers.push({ user_id: userId, attempts: count });
        }
      }

      return suspiciousUsers.sort((a, b) => b.attempts - a.attempts);
    } catch (error) {
      console.error('❌ Error en getSuspiciousUsers:', error);
      return [];
    }
  }

  /**
   * Elimina eventos antiguos (cleanup)
   * @param {number} daysOld - Eliminar eventos más antiguos que X días (default: 90)
   * @returns {Promise<Object>} Resultado de eliminación
   */
  static async cleanupOldEvents(daysOld = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { data, error } = await supabaseClient
        .from('security_events')
        .delete()
        .lt('timestamp', cutoffDate.toISOString());

      if (error) {
        console.error('❌ Error eliminando eventos antiguos:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('❌ Error en cleanupOldEvents:', error);
      return { success: false, error };
    }
  }

  /**
   * Calcula la severidad de un evento
   * @private
   */
  static _calculateSeverity(errorType, status) {
    if (status >= 500) return 'CRITICAL';
    if (status === 403) return 'HIGH';
    if (errorType === 'sql_injection' || errorType === 'xss') return 'HIGH';
    if (status >= 400) return 'MEDIUM';
    return 'LOW';
  }
}

/**
 * SQL PARA CREAR LA TABLA EN SUPABASE
 * 
 * Ejecutar en: Supabase > SQL Editor > New Query
 * 
 * CREATE TABLE IF NOT EXISTS security_events (
 *   id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
 *   
 *   -- Información del evento
 *   timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
 *   method VARCHAR(10) NOT NULL, -- GET, POST, PUT, DELETE, etc
 *   route VARCHAR(255) NOT NULL,
 *   status INTEGER NOT NULL,
 *   
 *   -- Detalles del error
 *   error_type VARCHAR(50), -- xss, sql_injection, invalid_input, etc
 *   error_message TEXT,
 *   error_details TEXT,
 *   
 *   -- Payload sospechoso (JSON guardado como string)
 *   payload TEXT,
 *   query_params TEXT,
 *   
 *   -- Información del cliente
 *   ip VARCHAR(45), -- IPv4 o IPv6
 *   user_agent TEXT,
 *   origin VARCHAR(255),
 *   
 *   -- Información del usuario (si está autenticado)
 *   user_id BIGINT,
 *   user_email VARCHAR(255),
 *   user_name VARCHAR(255),
 *   user_role VARCHAR(50),
 *   
 *   -- Análisis
 *   severity VARCHAR(20), -- LOW, MEDIUM, HIGH, CRITICAL
 *   
 *   -- Índices para búsquedas rápidas
 *   CONSTRAINT security_events_user_id_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL
 * );
 * 
 * CREATE INDEX idx_security_events_timestamp ON security_events(timestamp DESC);
 * CREATE INDEX idx_security_events_user_id ON security_events(user_id);
 * CREATE INDEX idx_security_events_ip ON security_events(ip);
 * CREATE INDEX idx_security_events_status ON security_events(status);
 * CREATE INDEX idx_security_events_severity ON security_events(severity);
 * CREATE INDEX idx_security_events_error_type ON security_events(error_type);
 * 
 */

module.exports = SecurityLogsService;
