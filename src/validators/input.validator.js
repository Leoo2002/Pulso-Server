/**
 * ============================================================================
 * MÓDULO DE VALIDACIÓN Y SANITIZACIÓN DE INPUTS
 * ============================================================================
 * 
 * Propósito: Proporcionar validaciones robustas contra:
 *   • SQL Injection
 *   • XSS (Cross-Site Scripting)
 *   • Inyección de comandos
 *   • Validación de tipos de datos
 * 
 * @author Sistema de Seguridad Pulso
 * @version 2.0.0
 * @license MIT
 * ============================================================================
 */

const validateInput = {
  /**
   * Valida y sanitiza un número DNI
   * @param {string|number} dni - DNI a validar
   * @returns {Object} {isValid: boolean, value: number, error: string}
   */
  validateDNI(dni) {
    // Validar que sea un número válido
    const dniNumber = Number(dni);
    
    if (isNaN(dniNumber)) {
      return {
        isValid: false,
        value: null,
        error: 'El DNI debe ser un número válido'
      };
    }

    // Validar rango típico de DNI
    if (dniNumber < 1000000 || dniNumber > 99999999) {
      return {
        isValid: false,
        value: null,
        error: 'El DNI debe estar entre 1.000.000 y 99.999.999'
      };
    }

    return {
      isValid: true,
      value: dniNumber,
      error: null
    };
  },

  /**
   * Valida y sanitiza un email
   * @param {string} email - Email a validar
   * @returns {Object} {isValid: boolean, value: string, error: string}
   */
  validateEmail(email) {
    if (typeof email !== 'string') {
      return {
        isValid: false,
        value: null,
        error: 'El email debe ser una cadena de texto'
      };
    }

    // Sanitizar: trim y lowercase
    const sanitizedEmail = email.trim().toLowerCase();

    // Validar formato
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitizedEmail)) {
      return {
        isValid: false,
        value: null,
        error: 'El email tiene un formato inválido'
      };
    }

    // Validar longitud
    if (sanitizedEmail.length > 254) {
      return {
        isValid: false,
        value: null,
        error: 'El email excede la longitud máxima permitida (254 caracteres)'
      };
    }

    return {
      isValid: true,
      value: sanitizedEmail,
      error: null
    };
  },

  /**
   * Valida y sanitiza un string de texto (observaciones, notas, etc)
   * @param {string} text - Texto a validar
   * @param {Object} options - Opciones: {minLength: 0, maxLength: 500, allowHtml: false}
   * @returns {Object} {isValid: boolean, value: string, error: string}
   */
  validateText(text, options = {}) {
    const {
      minLength = 0,
      maxLength = 500,
      allowHtml = false,
      fieldName = 'El campo'
    } = options;

    if (typeof text !== 'string') {
      return {
        isValid: false,
        value: null,
        error: `${fieldName} debe ser una cadena de texto`
      };
    }

    // Sanitizar: trim
    const sanitizedText = text.trim();

    // Validar longitud mínima
    if (sanitizedText.length < minLength) {
      return {
        isValid: false,
        value: null,
        error: `${fieldName} debe tener al menos ${minLength} caracteres`
      };
    }

    // Validar longitud máxima
    if (sanitizedText.length > maxLength) {
      return {
        isValid: false,
        value: null,
        error: `${fieldName} no debe exceder ${maxLength} caracteres`
      };
    }

    // Detectar patrones de inyección si no se permite HTML
    if (!allowHtml) {
      if (this._containsHtmlPatterns(sanitizedText)) {
        return {
          isValid: false,
          value: null,
          error: `${fieldName} contiene caracteres o patrones no permitidos`
        };
      }

      if (this._containsSqlPatterns(sanitizedText)) {
        return {
          isValid: false,
          value: null,
          error: `${fieldName} contiene patrones sospechosos de inyección`
        };
      }
    }

    return {
      isValid: true,
      value: sanitizedText,
      error: null
    };
  },

  /**
   * Valida y sanitiza una fecha en formato YYYY-MM-DD
   * @param {string} date - Fecha a validar
   * @returns {Object} {isValid: boolean, value: string, error: string}
   */
  validateDate(date) {
    if (typeof date !== 'string') {
      return {
        isValid: false,
        value: null,
        error: 'La fecha debe ser una cadena de texto'
      };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return {
        isValid: false,
        value: null,
        error: 'La fecha debe tener formato YYYY-MM-DD'
      };
    }

    // Validar que sea una fecha válida
    const dateObj = new Date(date + 'T00:00:00Z');
    if (isNaN(dateObj.getTime())) {
      return {
        isValid: false,
        value: null,
        error: 'La fecha no es válida'
      };
    }

    return {
      isValid: true,
      value: date,
      error: null
    };
  },

  /**
   * Valida y sanitiza un valor booleano
   * @param {any} value - Valor a validar
   * @returns {Object} {isValid: boolean, value: boolean, error: string}
   */
  validateBoolean(value) {
    if (typeof value === 'boolean') {
      return { isValid: true, value, error: null };
    }

    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase().trim();
      if (['true', '1', 'yes', 'si'].includes(lowerValue)) {
        return { isValid: true, value: true, error: null };
      }
      if (['false', '0', 'no'].includes(lowerValue)) {
        return { isValid: true, value: false, error: null };
      }
    }

    return {
      isValid: false,
      value: null,
      error: 'El valor booleano no es válido'
    };
  },

  /**
   * Valida múltiples inputs a la vez
   * @param {Object} inputs - Objeto con pares {nombreCampo: valor}
   * @param {Object} rules - Objeto con reglas de validación
   * @returns {Object} {isValid: boolean, values: {}, errors: {}}
   * 
   * @example
   * validateInput.validateBatch(
   *   { dni: '12345678', email: 'test@test.com', observacion: 'Cambio' },
   *   {
   *     dni: { type: 'dni' },
   *     email: { type: 'email' },
   *     observacion: { type: 'text', maxLength: 200 }
   *   }
   * )
   */
  validateBatch(inputs, rules) {
    const values = {};
    const errors = {};
    let isValid = true;

    for (const [field, value] of Object.entries(inputs)) {
      if (!rules[field]) continue;

      const rule = rules[field];
      let result;

      switch (rule.type) {
        case 'dni':
          result = this.validateDNI(value);
          break;
        case 'email':
          result = this.validateEmail(value);
          break;
        case 'text':
          result = this.validateText(value, { ...rule, fieldName: field });
          break;
        case 'date':
          result = this.validateDate(value);
          break;
        case 'boolean':
          result = this.validateBoolean(value);
          break;
        default:
          result = { isValid: false, error: `Tipo de validación desconocido: ${rule.type}` };
      }

      if (!result.isValid) {
        isValid = false;
        errors[field] = result.error;
      } else {
        values[field] = result.value;
      }
    }

    return { isValid, values, errors };
  },

  /**
   * ============================================================================
   * MÉTODOS PRIVADOS - Detección de Patrones Maliciosos
   * ============================================================================
   */

  /**
   * Detecta patrones comunes de inyección HTML/JavaScript
   * @private
   */
  _containsHtmlPatterns(text) {
    const htmlPatterns = [
      /<script[^>]*>.*?<\/script>/gi,        // Scripts
      /javascript:/gi,                        // JavaScript protocol
      /on\w+\s*=/gi,                         // Event handlers (onclick, onerror, etc)
      /<iframe[^>]*>/gi,                     // iframes
      /<embed[^>]*>/gi,                      // embeds
      /<object[^>]*>/gi,                     // objects
      /<img[^>]*onerror/gi,                  // img onerror
      /<svg[^>]*onload/gi,                   // svg onload
      /eval\(/gi,                            // eval()
      /expression\(/gi,                      // CSS expressions
    ];

    return htmlPatterns.some(pattern => pattern.test(text));
  },

  /**
   * Detecta patrones comunes de inyección SQL
   * @private
   */
  _containsSqlPatterns(text) {
    const sqlPatterns = [
      /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
      /(--|#|\/\*|\*\/)/g,                   // SQL comments
      /(;[\s]*DROP)/gi,                      // DROP statements
      /(;[\s]*DELETE)/gi,                    // DELETE statements
      /('[\s]*(OR|AND)[\s]*')/gi,           // OR/AND injection
      /(1[\s]*=[\s]*1)/gi,                   // Basic true condition
      /xp_/gi,                               // Extended procedures
    ];

    return sqlPatterns.some(pattern => pattern.test(text));
  },

  /**
   * Sanitiza un string eliminando caracteres peligrosos (ALTERNATIVA)
   * Nota: Preferir validación a sanitización en producción
   * @private
   */
  sanitizeString(text) {
    if (typeof text !== 'string') return '';
    
    return text
      .trim()
      .replace(/[<>\"'`]/g, '')  // Elimina caracteres especiales
      .substring(0, 500);         // Limita longitud
  }
};

module.exports = validateInput;
