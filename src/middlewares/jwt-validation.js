// Middleware de validación de JWT global
const jwt = require("jsonwebtoken");

// Middleware que bloquea rutas que requieren autenticación
function jwtValidationMiddleware(req, res, next) {
  const JWT_SECRET = process.env.JWT_SECRET;

  // Rutas públicas que no requieren autenticación
  const publicPaths = ['/', '/auth/login', '/error401', '/logok/inicio', '/auth/logout', '/auth/acceso-especial'];
  
  if (publicPaths.includes(req.path)) {
    return next();
  }

  const token = req.cookies['login-jwt'];

  if (!token) {
    console.log("Token no brindado");
    return res.status(403).json({ error: "Token no brindado" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("Error al verificar el token:", err);
      return res.status(403).json({ error: "Token no válido" });
    }
    req.user = decoded;
    next();
  });
}

module.exports = jwtValidationMiddleware;
