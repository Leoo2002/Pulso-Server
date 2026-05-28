// Servicio de autenticación con Google
const { client, GOOGLE_CLIENT_ID } = require('../config/google-auth');

// Función para verificar el token de Google y obtener el payload
async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  return payload;
}

module.exports = { verifyGoogleToken };
