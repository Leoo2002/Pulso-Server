// Middleware de validación de JWT global
const jwt = require("jsonwebtoken");
const { tokenErrorType } = require('./auth-error-type');

// Middleware que bloquea rutas que requieren autenticación
function jwtValidationMiddleware(req, res, next) {
  const JWT_SECRET = process.env.JWT_SECRET;

  const token = req.cookies['login-jwt'];

  if (!token) {
    res.locals.securityErrorType = 'token_missing';
    return res.status(401).json({ error: "Token no brindado" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("Error al verificar el token:", err);
      res.locals.securityErrorType = tokenErrorType(err);
      return res.status(401).json({ error: "Token no válido" });
    }
    req.user = decoded;
    next();
  });
}

module.exports = jwtValidationMiddleware;
