const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDegraClassification } = require('./degra-classification');

test('allows an operational Degra ticket with a matching submotive', () => {
  assert.equal(validateDegraClassification({
    tipo_reclamo_circuito: 'TICKET',
    motivo_principal: 'Pagos y Suspensiones',
    submotivo: 'Rehabilitación urgente de línea'
  }), '');
});

test('allows a Degra ITracker with an ITracker submotive', () => {
  assert.equal(validateDegraClassification({
    tipo_reclamo_circuito: 'ITRACKER',
    motivo_principal: 'Portabilidad / FAN',
    submotivo: 'Error NO SE PUDO REALIZAR'
  }), '');
});

test('rejects motives and submotives from another Degra claim type', () => {
  assert.notEqual(validateDegraClassification({
    tipo_reclamo_circuito: 'ITRACKER',
    motivo_principal: 'Pagos y Suspensiones',
    submotivo: 'Rehabilitación urgente de línea'
  }), '');
  assert.notEqual(validateDegraClassification({
    tipo_reclamo_circuito: 'TICKET',
    motivo_principal: 'Pagos y Suspensiones',
    submotivo: 'Error NO SE PUDO REALIZAR'
  }), '');
});

test('rejects unknown claim types', () => {
  assert.notEqual(validateDegraClassification({
    tipo_reclamo_circuito: 'Reclamo Operativo (BO)',
    motivo_principal: 'Pagos y Suspensiones',
    submotivo: 'Rehabilitación urgente de línea'
  }), '');
});
