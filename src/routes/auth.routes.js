// Rutas de autenticación
const express = require('express');
const router = express.Router();
const jwt = require("jsonwebtoken");
const { verifyGoogleToken } = require('../services/auth.service');
const { supabase } = require('../config/database');
const { requireTicketeraAccess } = require('../middlewares/ticketera-access');

// Endpoint para login con Google
router.post('/login', async (req, res) => {
  const { token } = req.body;

  let payload;
  try {
    payload = await verifyGoogleToken(token);
  } catch (error) {
    console.error("Error verificando token de Google:", error);
    return res.status(401).json({ error: "Error al crear el token" });
  }

  try {
    const { email } = payload;
    const { data: nominaData, error: nominaError } = await supabase.rpc(
      'obtener_datos_usuario_nomina', { p_email: email }
    );

    if (nominaError) {
      console.error('Error obteniendo datos de nomina:', nominaError);
      return res.status(500).json({ error: 'Error al obtener los datos de nomina del usuario' });
    }

    const nomina = Array.isArray(nominaData) ? nominaData[0] : nominaData;
    const datos = nomina?.datos;
    if ((Array.isArray(nominaData) && nominaData.length > 1)
      || (nomina != null && (typeof nomina !== 'object' || Array.isArray(nomina)
        || !Object.prototype.hasOwnProperty.call(nomina, 'datos')))
      || (datos != null && (typeof datos !== 'object' || Array.isArray(datos)))
      || (datos?.rango != null && (!['number', 'string'].includes(typeof datos.rango)
        || String(datos.rango).trim() === '' || !Number.isInteger(Number(datos.rango))))
      || (datos?.segmento != null && (!Array.isArray(datos.segmento)
        || datos.segmento.some((segmento) => typeof segmento !== 'string')))
      || (datos?.herramientas != null && (!Array.isArray(datos.herramientas)
        || datos.herramientas.some((tool) => !tool || typeof tool.nombre !== 'string'
          || !['number', 'string'].includes(typeof tool.id_herramienta))))) {
      console.error('La funcion obtener_datos_usuario_nomina devolvio un formato invalido.');
      return res.status(502).json({ error: 'La respuesta de nomina no tiene el formato esperado' });
    }

    let rolData = datos?.rol;
    if (rolData == null) {
      const { data, error } = await supabase.rpc('getrol', { mail: email });
      if (error || !data || data.length === 0) {
        console.error("Error obteniendo el rol:", error, " rolData:", data);
        return res.status(500).json({ error: "Error al obtener el rol del usuario" });
      }
      rolData = data;
    }

    let rangoData = datos?.rango;
    if (rangoData == null) {
      const { data, error } = await supabase.rpc('getrango', { mail: email });
      if (error || data == null) {
        console.error("Error obteniendo el rango:", error, " rangoData:", data);
        return res.status(500).json({ error: "Error al obtener el rango del usuario" });
      }
      rangoData = data;
    }

    const { exp, iat, nbf, ...payloadLimpio } = payload;
    const sessionPayload = {
      ...payloadLimpio,
      rol: rolData,
      rango: rangoData,
      segmento: datos?.segmento ?? "SOPORTE-RRSS"
    };
    // Los datos de negocio no reemplazan identidad ni claims de Google/JWT.
    for (const field of ['id', 'dni', 'mail', 'lider', 'nombre', 'usuario', 'herramientas']) {
      if (datos?.[field] != null) sessionPayload[field] = datos[field];
    }
    if (datos == null) sessionPayload.nomina = null;
    else if (nomina.origen != null) sessionPayload.origen = nomina.origen;

    const jwtToken = jwt.sign(sessionPayload, process.env.JWT_SECRET, { expiresIn: '8h' });

    res.cookie('login-jwt', jwtToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 1000 * 60 * 60 * 8 // 8 horas
    });

    res.json({ payload: jwt.decode(jwtToken) });

  } catch (error) {
    console.error("Error al crear la sesion del usuario:", error);
    res.status(500).json({ error: "Error al crear el token" });
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

  const { contra } = req.body;

  try {
    if (!process.env.U_SECRET) {
      console.error('Acceso especial no configurado: falta U_SECRET.');
      return res.status(503).json({ error: 'El acceso especial no esta disponible.' });
    }
    if (contra !== process.env.U_SECRET) {
      return res.status(403).json({ error: "Acceso denegado" });
    } else {
      console.log("Acceso especial concedido");
    }

    // Simular un payload como si fuera un usuario de Google Auth
    const payload = {
      aud: "dev",
      azp: "dev",
      email: "leonel.quiroga@konecta.com",
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8, // 8 hs
      family_name: "QUIROGA PACHECO",
      given_name: "LEONEL",
      hd: process.env.ACCESO_ESPECIAL_HD || "localhost",
      iat: Math.floor(Date.now() / 1000),
      iss: "https://accounts.google.com",
      jti: require('crypto').randomBytes(16).toString('hex'),
      name: "LEONEL QUIROGA PACHECO",
      nbf: Math.floor(Date.now() / 1000),
      picture: "https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png",
      sub: require('crypto').randomBytes(16).toString('hex'),
      id: 342,
      dni: "43809369",
      rol: "DESARROLLADOR",
      mail: "leonel.quiroga@konecta.com",
      lider: null,
      nombre: "LEONEL QUIROGA PACHECO",
      usuario: "U936558",
      rango: 1,
      segmento: ["ABONO", "ONBOARDING HOGAR", "ONBOARDING MOVIL", "ONBOARDING WSP", "VENTAS MOVIL", "WA VENTAS MOVIL"],
      herramientas: [
        { nombre: "Ticketera_ABONO_DEGRA", id_herramienta: 12 },
        { nombre: "Ticketera_ONBOARDING", id_herramienta: 10 },
        { nombre: "Ticketera_Ventas", id_herramienta: 11 }
      ],
      origen: "nomina"
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

  if (view === 'tickets') {
    return authMiddleware([0, 1, 2, 3, 4, 5])(req, res, () => {
      requireTicketeraAccess()(req, res, () => res.status(200).json({ ok: true }));
    });
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
