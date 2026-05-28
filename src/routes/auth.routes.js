// Rutas de autenticación
const express = require('express');
const router = express.Router();
const jwt = require("jsonwebtoken");
const { verifyGoogleToken } = require('../services/auth.service');
const { supabase } = require('../config/database');

// Endpoint para login con Google
router.post('/login', async (req, res) => {
  const { token } = req.body;

  console.log("\uD83D\uDD0D JWT_SECRET:", process.env.JWT_SECRET ? "\u2705 Configurado" : "\u274C No configurado");

  try {
    const payload = await verifyGoogleToken(token);
    console.log('Payload verificado');

    const { email, name } = payload;

    // Obtener rol del usuario
    const { data: rolData, error: rolError } = await supabase.rpc('getrol', {
      mail: email
    });

    if (rolError || !rolData || rolData.length === 0) {
      console.error("Error obteniendo el rol:", rolError, " rolData:", rolData);
      return res.status(500).json({ error: "Error al obtener el rol del usuario" });
    }

    // Obtener rango del usuario
    const { data: rangoData, error: rangoError } = await supabase.rpc('getrango', {
      mail: email
    });

    if (rangoError || rangoData === null || rangoData === undefined) {
      console.error("Error obteniendo el rango:", rangoError, " rangoData:", rangoData);
      return res.status(500).json({ error: "Error al obtener el rango del usuario" });
    }

    console.log("Rol del usuario:", rolData);
    console.log("Rango del usuario:", rangoData);

    const { exp, iat, nbf, ...payloadLimpio } = payload;
    const jwtToken = jwt.sign({
      ...payloadLimpio,
      rol: rolData,
      rango: rangoData,
      segmento: "SOPORTE-RRSS"
    },
      process.env.JWT_SECRET, { expiresIn: '8h' });

    res.cookie('login-jwt', jwtToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1000 * 60 * 60 * 8 // 8 horas
    });

    // Agregar rol y rango al payload de respuesta
    payload.rol = rolData;
    payload.rango = rangoData;
    payload.segmento = "SOPORTE-RRSS";
    res.json({ payload });

  } catch (error) {
    console.error("Error verificando token de Google:", error);
    res.status(401).json({ error: "Error al crear el token" });
  }
});

// Endpoint para logout
router.get('/logout', (req, res) => {
  console.log("Cerrando sesión");
  res.clearCookie('login-jwt', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  });
  res.json({ message: "Sesión cerrada" });
});

// Endpoint para recargar storage
router.get("/recargar-storage", (req, res) => {
  const token = req.cookies['login-jwt'];

  if (!token) {
    return res.status(401).json({ error: "No hay token" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("❌ Error al verificar el token:", err.message);
      return res.status(403).json({ error: "Token no válido o expirado" });
    }

    console.log("✅ Token válido, devolviendo payload para recargar sessionStorage");
    res.json({ payload: decoded });
  });
});

// Endpoint para acceso especial (sin Google Auth)
router.post('/acceso-especial', async (req, res) => {
  console.log("Acceso especial solicitado");

  const { contra, rango } = req.body;

  try {
    if (contra !== process.env.U_SECRET) {
      return res.status(403).json({ error: "Acceso denegado" });
    } else {
      console.log("Acceso especial concedido");
    }

    // Simular un payload como si fuera un usuario de Google Auth
    const payload = {
      aud: "dev",
      azp: "dev",
      email: process.env.ACCESO_ESPECIAL_EMAIL || "dev@localhost",
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8, // 8 hs
      family_name: "Prueba",
      given_name: "Usuario",
      hd: process.env.ACCESO_ESPECIAL_HD || "localhost",
      iat: Math.floor(Date.now() / 1000),
      iss: "https://accounts.google.com",
      jti: require('crypto').randomBytes(16).toString('hex'),
      name: "Usuario Prueba",
      nbf: Math.floor(Date.now() / 1000),
      picture: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png",
      sub: require('crypto').randomBytes(16).toString('hex'),
      rol: "acceso-especial",
      rango: rango ?? 0,
      segmento: "SOPORTE-RRSS"
    };

    const jwtToken = jwt.sign({
      ...payload
    }, process.env.JWT_SECRET);

    res.cookie('login-jwt', jwtToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1000 * 60 * 60 * 8 // 8 hs
    });

    res.json({ payload });

  } catch (error) {
    console.error("Error al ingresar a Usuario Especial:", error);
    res.status(401).json({ error: "Error al crear el token" });
  }
});

// Endpoint para validar acceso a vistas específicas
const authMiddleware = require('../middlewares/auth');
const { PERMISOS_VISTAS, ACCESOS_EXTRA } = require('../constants/permissions');

router.get("/validar-acceso", (req, res, next) => {
  const view = req.query.view;
  console.log("Validando acceso a la vista:", view);

  const rolesPermitidos = PERMISOS_VISTAS[view];

  if (!rolesPermitidos) {
    return res.status(400).json({ error: "Vista desconocida" });
  }

  // Obtener el correo del token JWT directamente si req.user no está definido
  let correo = req.user?.email;
  
  if (!correo) {
    const token = req.cookies['login-jwt'];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        correo = decoded.email;
        console.log(`📧 Correo obtenido del token: ${correo}`);
      } catch (err) {
        console.warn("⚠️ Error al decodificar token en validar-acceso:", err.message);
      }
    }
  }

  // Verificar si el correo tiene acceso especial a esta vista
  if (correo && ACCESOS_EXTRA[view]?.includes(correo)) {
    console.log(`✅ Acceso permitido a ${view} para correo especial: ${correo}`);
    return res.status(200).json({ ok: true });
  }

  // Validar por rol
  authMiddleware(rolesPermitidos)(req, res, next);
}, (req, res) => {
  res.status(200).json({ ok: true });
});

module.exports = router;
