// Rutas para gestión de agentes
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { registerFuncionesExtra } = require('../services/funciones_extra.service');
const { validateEmailRangoRequest } = require('../middlewares/security-validation.middleware');

// Obtener nombres y DNI de los líderes
router.get("/lideres", async (req, res) => {
  try {
    const { data, error } = await supabase.from("lideres").select("nombre, dni_lider");
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error al obtener nombres:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Traer nombre y DNI de agentes por líder
router.get("/agentes", async (req, res) => {
  const dni_lider = Number(req.query.dni_lider);

  if (!dni_lider || isNaN(dni_lider)) {
    return res.status(400).json({ error: "El parámetro 'dni_lider' es requerido y debe ser numérico." });
  }

  let { data, error } = await supabase.rpc('getagentespordnilider', {
    doc_lider: dni_lider
  });

  if (error) console.error(error);
  else return res.json(data);
});

// Obtener francos por agente
router.get("/francos", async (req, res) => {
  const doc = Number(req.query.dni_agente);

  if (!doc || isNaN(doc)) {
    return res.status(400).json({ error: "El parámetro 'dni_agente' es requerido y debe ser numérico." });
  }

  try {
    let { data, error } = await supabase
      .rpc('obtener_francos_multitabla', {
        doc_agente: doc
      });
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error("Error al obtener días franco:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Obtener feriados por agente
router.get("/feriado", async (req, res) => {
  const dni_agente = Number(req.query.dni_agente);

  if (!dni_agente || isNaN(dni_agente)) {
    return res.status(400).json({ error: "El parámetro 'dni_agente' es requerido y debe ser numérico." });
  }

  try {
    let { data, error } = await supabase.rpc('getfechassemanales', { doc: dni_agente });
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error("Error al obtener días franco:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Obtener rango por email
router.get("/email/rango",
  validateEmailRangoRequest,  // ✅ Validar email
  async (req, res) => {
    try {
      const email = req.validatedData.email;  // ✅ Email ya validado

      console.log(`📧 Obteniendo rango para email: ${email}`);

      let { data, error } = await supabase.rpc('getrango', { mail: email });

      if (error) {
        console.error("❌ Error en la consulta:", error);
        return res.status(500).json({ error: "Error al obtener datos" });
      }

      console.log("✅ Datos obtenidos:", data);
      res.json({ success: true, data: data });

    } catch (error) {
      console.error("❌ Error en el servidor:", error);
      res.status(500).json({ error: "Error en el servidor" });
    }
  }
);

// Obtener rol por email
router.get("/email/rol",
  validateEmailRangoRequest,  // ✅ Validar email (reutilizar middleware)
  async (req, res) => {
    try {
      const email = req.validatedData.email;  // ✅ Email ya validado

      console.log(`👤 Obteniendo rol para email: ${email}`);

      let { data, error } = await supabase.rpc('getrol', { mail: email });

      if (error) {
        console.error("❌ Error en la consulta:", error);
        return res.status(500).json({ error: "Error al obtener datos" });
      }

      console.log("✅ Datos obtenidos:", data);
      res.json({ success: true, data: data });

    } catch (error) {
      console.error("❌ Error en el servidor:", error);
      res.status(500).json({ error: "Error en el servidor" });
    }
  }
);

// Obtener equipo por email de agente
router.get("/traerEquipo", async (req, res) => {
  const email = req.query.email;
  console.log("entre a Traer equipo");

  let { data, error } = await supabase
    .rpc('get_liderpormailagente', {
      correo: email
    });

  if (error) console.error(error);
  else return res.json(data);
});

// Dar de baja un agente
router.get("/bajaAgente", async (req, res) => {
  const doc_agente = Number(req.query.dni);
  const f_baja = req.query.f_baja;
  const t_baja = req.query.t_baja;

  console.log("datos de baja", doc_agente, f_baja, t_baja);

  let { data, error } = await supabase
    .rpc('set_baja_agente', {
      f_baja: f_baja,
      doc_agente: doc_agente,
      t_baja: t_baja
    });

  if (error) console.error(error);
  else console.log(data);
});

module.exports = router;

// Registrar endpoints adicionales
registerFuncionesExtra(router);
