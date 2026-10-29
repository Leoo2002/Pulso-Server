const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ticketRange, ticketPermissions, defaultTicketDates, ticketMatchesSearch } = require('./ticket-access');

test('concrete searches match data values, never serialized JSON field names or image metadata', () => {
  const ticket = {
    id: 21, email: 'user@example.com', ventas: { numero_gestion: '12345678' },
    imagenes: [{ ruta_archivo: 'all-images.png' }], observaciones: [{ observacion: 'Contactar cliente' }]
  };
  assert.equal(ticketMatchesSearch(ticket, 'email'), false);
  assert.equal(ticketMatchesSearch(ticket, 'numero_gestion'), false);
  assert.equal(ticketMatchesSearch(ticket, 'all-images'), false);
  assert.equal(ticketMatchesSearch(ticket, '12345678'), true);
  assert.equal(ticketMatchesSearch(ticket, 'CLIENTE'), true);
});

test('invalid range values never acquire agent or privileged permissions through coercion', () => {
  for (const rango of [null, undefined, '', ' ', false, true, [], [1], {}, -1, 6, 1.5, 'invalid']) {
    assert.equal(ticketRange({ rango }), null);
    assert.ok(Object.values(ticketPermissions({ rango })).every((permission) => permission === false));
  }
  assert.equal(ticketRange({ rango: '0' }), 0);
  assert.equal(ticketRange({ rango: 5 }), 5);
});

for (const [now, from, to] of [
  ['2026-03-31T12:00:00Z', '2026-02-28', '2026-03-31'],
  ['2028-03-31T12:00:00Z', '2028-02-29', '2028-03-31'],
  ['2026-01-31T12:00:00Z', '2025-12-31', '2026-01-31']
]) {
  test(`default listing dates clamp calendar month boundaries: ${now}`, (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
    assert.deepEqual(defaultTicketDates('All', 'all'), { from, to });
    assert.deepEqual(defaultTicketDates('', 'all'), { from, to });
    assert.deepEqual(defaultTicketDates('12345678', 'all'), { from: null, to: null });
    assert.deepEqual(defaultTicketDates('All', 'mine'), { from: null, to: null });
    assert.deepEqual(defaultTicketDates('All', 'all', '2020-01-01', '2026-01-01'),
      { from: '2020-01-01', to: '2026-01-01' });
  });
}
