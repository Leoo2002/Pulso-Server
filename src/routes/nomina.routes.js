// Rutas para gestión de nómina
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const validateInput = require('../validators/input.validator');

router.post('/obtenerUsuariosNomina', async (req, res) => {
  const mail = typeof req.body?.mail === 'string' ? req.body.mail.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 254) {
    return res.status(400).json({ error: 'Ingresá un mail válido.' });
  }

  try {
    const { data, error } = await supabase.rpc('obtener_usuarios_nomina', {
      p_mail: mail
    });

    if (error) {
      console.error('Error al obtener usuario y segmentos de nómina por mail:', error);
      return res.status(500).json({ error: 'No se pudieron obtener los datos de nómina.' });
    }

    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile || typeof profile !== 'object' || Object.keys(profile).length === 0) {
      return res.status(404).json({ error: 'No se encontraron datos de nómina para ese mail.' });
    }
    if (!Object.prototype.hasOwnProperty.call(profile, 'usuario')
      || !Object.prototype.hasOwnProperty.call(profile, 'rango')
      || !Array.isArray(profile.segmentos)) {
      console.error('La función obtener_usuarios_nomina no devolvió usuario, rango y segmentos.');
      return res.status(502).json({ error: 'La respuesta de nómina no contiene los datos esperados.' });
    }
    if (profile.segmentos.some((segment) => !segment || typeof segment.segmento !== 'string')) {
      console.error('La función obtener_usuarios_nomina devolvió un segmento inválido.');
      return res.status(502).json({ error: 'La respuesta de nómina contiene segmentos inválidos.' });
    }

    return res.json({
      usuario: profile.usuario,
      rango: profile.rango,
      segmentos: profile.segmentos.map((segment) => ({ segmento: segment.segmento }))
    });
  } catch (error) {
    console.error('Error inesperado al obtener usuario y segmentos de nómina por mail:', error);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.post('/obtenerHerramientasUsuario', async (req, res) => {
  const mail = typeof req.body?.mail === 'string' ? req.body.mail.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 254) {
    return res.status(400).json({ error: 'Ingresá un mail válido.' });
  }

  try {
    const { data, error } = await supabase.rpc('obtener_herramientas_usuario', {
      p_mail: mail
    });

    if (error) {
      console.error('Error al obtener herramientas asignadas por mail:', error);
      return res.status(500).json({ error: 'No se pudieron obtener las herramientas asignadas.' });
    }
    if (!Array.isArray(data) || data.some((tool) =>
      !tool || typeof tool.nombre !== 'string'
      || !['string', 'number'].includes(typeof tool.id_herramienta)
    )) {
      console.error('La función obtener_herramientas_usuario devolvió una lista inválida.');
      return res.status(502).json({ error: 'La respuesta de herramientas no tiene el formato esperado.' });
    }

    return res.json(data.map(({ id_herramienta, nombre }) => ({ id_herramienta, nombre })));
  } catch (error) {
    console.error('Error inesperado al obtener herramientas asignadas por mail:', error);
    return res.status(500).json({ error: 'No se pudieron obtener las herramientas asignadas.' });
  }
});

// Obtener nómina por líder
router.get("/nominaPorlider", async (req, res) => {
  try {
    const doc_lider = req.query.doc_lider;

    // ✅ Validar que sea un DNI válido
    const dniValidation = validateInput.validateDNI(doc_lider);
    if (!dniValidation.isValid) {
      return res.status(400).json({
        error: 'DNI inválido',
        details: dniValidation.error
      });
    }

    console.log(`📋 Obteniendo nómina para líder: ${dniValidation.value}`);

    let { data, error } = await supabase.rpc('get_nominacompletaporlider', {
      doc_lider: dniValidation.value
    });

    if (error) {
      console.error("❌ Error en Supabase:", error);
      return res.status(500).json({ error: "Error al obtener nómina" });
    }

    console.log(`✅ Nómina obtenida: ${data?.length || 0} registros`);
    return res.json({ success: true, count: data?.length || 0, data: data || [] });

  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(500).json({ error: "Error en el servidor" });
  }
});

// Corregir nómina
router.post('/corregirNomina', async (req, res) => {
  const agentes = req.body;

  try {
    for (const agente of agentes) {
      const { segmento, doc_agente, doc_agenteN, usuario, nombre, lider, ingreso, contrato, estado, jefe, mail } = agente;
      console.log("agentes", agente);

      const { data, error } = await supabase
        .rpc('corregir_nomina2', {
          contrato_agente: contrato,
          dni_original: doc_agente,
          doc_agente: doc_agenteN,
          estado_agente: estado,
          hora_ingreso: ingreso,
          jefe_agente: jefe,
          mail_lider: process.env.DEFAULT_MAIL_LIDER || "",
          nombre_agente: nombre,
          segmento_agente: segmento,
          superior_agente: lider,
          usuario_agente: usuario
        });

      if (error) {
        throw error;
      }
    }

    res.status(200).json({ message: "Nómina corregida correctamente." });

  } catch (error) {
    console.error("Error al guardar observaciones:", error);
    res.status(500).json({ message: "Error al guardar observaciones." });
  }
});

// Obtener líderes para nómina
router.get("/LideresNomina", async (req, res) => {
  let { data, error } = await supabase
    .rpc('get_lideres');
  if (error) console.error(error);
  else return res.json(data);
});

// Obtener segmentos para nómina
router.get("/ServicioNomina", async (req, res) => {
  console.log("entre a getlideresNomina");
  let { data, error } = await supabase
    .rpc('get_segmentos');
  if (error) console.error(error);
  else return res.json(data);
});

// Obtener contratos para nómina
router.get("/ContratosNomina", async (req, res) => {
  let { data, error } = await supabase
    .rpc('get_contratos');
  if (error) console.error(error);
  else return res.json(data);
});

// Obtener jefes para nómina
router.get("/JefesNomina", async (req, res) => {
  let { data, error } = await supabase
    .rpc('get_jefes');
  if (error) console.error(error);
  else return res.json(data);
});

module.exports = router;
