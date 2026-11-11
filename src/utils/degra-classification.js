const MOTIVES_BY_CLAIM_TYPE = {
  TICKET: {
    'Rellamadadores / Retención': [
      'Solicitud de reintento de llamada',
      'Cliente vuelve a contactar (Reiterado)',
      'Imposibilidad de gestión en CRM por agente',
      'Asistencia en escenario de retención / Fidelización'
    ],
    'Pagos y Suspensiones': [
      'Inconvenientes con un pago / Pago no acreditado',
      'Pago erróneo / Transferencia de fondos entre cuentas',
      'Suspensión por error / Cliente sin mora',
      'Promesa de pago / Financiación',
      'Rehabilitación urgente de línea'
    ],
    'Ajustes y Notas de Crédito (NCL)': [
      'Solicitud de NCL por cuota de equipo / Servicio',
      'Ajuste comercial (Pos-Bajas / Downselling)',
      'Promoción / Descuento no cargado',
      'Error en tarifa de abonados'
    ],
    'Clientes Posbaja & Fidelización': [
      'Posbaja con compromiso de pago',
      'Promos Fidelización / Detractores',
      'Solicitud de comprobante / Envío de documentación'
    ]
  },
  ITRACKER: {
    'Portabilidad / FAN': [
      'Discrepancia en Nombre/DNI vs. CRM',
      'Error DP-010702 ALIM (MSISDN en proceso)',
      'Error NO SE PUDO REALIZAR',
      'Cancelación / Modificación de estado en Iniciar portabilidad',
      'Reversión Mutuo Acuerdo'
    ],
    'Inconvenientes de Sistemas / Aplicativos': [
      'Inconsistencia entre App y Catálogo / App Mi Personal / App Contención',
      'Error al cargar gestión en CRM / FAN / Siebel',
      'Visualización en Vista 360 (V360)',
      'Error de usuario / Permisos en ITracker / Genesys (PAD de atención)'
    ],
    'Gestión de Equipos / SIM / Servicios': [
      'Suspensión / Rehabilitación por Siniestro o Mora',
      'Suspensión / Rehabilitación de Equipos por Leasing',
      'Cambio de SIM / Cambio de eSIM / Nominación',
      'Desconocimiento de Terminal / Accesorios / Dispositivos / Smart TV',
      'Desconocimiento de Línea / Hogares (Fraude / No Fraude)'
    ],
    'Reingresos y Escalaciones': [
      'Reingreso de caso (Pendiente / Reabierto)',
      'Respuesta no concluyente / Solicitud de escalación Onsite'
    ]
  }
};

function validateDegraClassification(ticket) {
  const claimType = ticket.tipo_reclamo_circuito;
  if (!Object.prototype.hasOwnProperty.call(MOTIVES_BY_CLAIM_TYPE, claimType)) {
    return 'Seleccioná un tipo de reclamo válido para Degra.';
  }
  const submotives = MOTIVES_BY_CLAIM_TYPE[claimType][ticket.motivo_principal];
  if (!submotives) return 'El motivo no corresponde al tipo de reclamo seleccionado.';
  if (!submotives.includes(ticket.submotivo)) {
    return 'El submotivo no corresponde al motivo seleccionado.';
  }
  return '';
}

module.exports = { MOTIVES_BY_CLAIM_TYPE, validateDegraClassification };
