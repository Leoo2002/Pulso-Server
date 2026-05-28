// Middleware de autenticación JWT
const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware que verifica si el usuario está autenticado
 * y tiene uno de los rangos permitidos.
 * @param {number[]} rolesPermitidos - Lista de rangos permitidos.
 */
function authMiddleware(rolesPermitidos = []) {
  console.log("🔐 Middleware de autenticación cargado");
  return (req, res, next) => {
    const token = req.cookies['login-jwt'];
    console.log("🔑 Verificando token");

    if (!token) {
      return res.status(401).json({ error: "No autorizado: token faltante" });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        console.warn("❌ Token inválido o expirado:", err.message);
        return res.status(403).json({ error: "Token inválido o expirado" });
      }

      const rango = decoded.rango;
      if (!rolesPermitidos.includes(rango)) {
        console.log(rango);
        console.warn("🚫 Acceso denegado: rango insuficiente");
        return res.status(403).json({ error: "Acceso denegado: permiso insuficiente" });
      }
      
      req.user = decoded;

      next();
    });
  };
}

module.exports = authMiddleware;
