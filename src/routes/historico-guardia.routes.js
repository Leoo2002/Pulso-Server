// Rutas de histórico de guardia
const express = require('express');
const router = express.Router();
const { supabase, SUPABASE_URL, SUPABASE_KEY } = require('../config/database');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Endpoint para obtener guardia completa por líder
router.post("/historicoGuardiaPorLider", async (req, res) => {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_guardia_completa?`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept-Profile': 'registros_guardia',
        'Content-Profile': 'registros_guardia'
      },
      body: JSON.stringify({
        mail_lider: req.body.mail_lider,
        fecha_guardia: req.body.fecha_guardia
      })
    });

    const rawText = await response.text();
    console.log("🧾 Raw response body:", rawText);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      data = rawText;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error en Supabase",
        details: data
      });
    }

    return res.json(data);

  } catch (error) {
    console.error("Error en el handler:", error);
    res.status(500).json({ error: "Error interno del servidor", message: error.message });
  }
});

// Endpoint para obtener fechas de reportes
router.get("/fechasReportes", async (req, res) => {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_fechasreportes?`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept-Profile': 'registros_guardia',
        'Content-Profile': 'registros_guardia'
      },
    });

    const rawText = await response.text();
    console.log("🧾 FECHASREPORTE:", rawText);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      data = rawText;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error en Supabase",
        details: data
      });
    }
    console.log(res.json(data))
    return res.json(data);

  } catch (error) {
    console.error("Error en el handler:", error);
    res.status(500).json({ error: "Error interno del servidor", message: error.message });
  }
});

// Endpoint para obtener fechas de histórico de guardias
router.get("/getFechasHistoricoGuardias", async (req, res) => {
  const mail_lider = req.query.email;

  const { data, error } = await supabase
    .rpc('get_fechas_historico_guardias', {});

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

// Endpoint para obtener histórico de guardia
router.get("/getHistoricoGuardia", async (req, res) => {
  const mail_lider = req.query.email;
  const fecha = req.query.fecha;

  // Llamada RPC usando la función wrapper en public
  const { data, error } = await supabase
    .rpc('get_historico_guardia', {
      p_fecha: fecha
    });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }

  console.log('📅 Fecha recibida (ISO):', fecha);

  // Crear cliente de Supabase con el schema correcto
  const { createClient } = require('@supabase/supabase-js');
  const supabaseGuardia = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    { db: { schema: 'registros_guardia' } }
  );

  // Buscar el registro de guardia por fecha
  const { data: registroGuardia, error: errorRegistro } = await supabaseGuardia
    .from('guardias')
    .select('*')
    .eq('fecha', fecha)
    .limit(1)
    .single();

  console.log('🔍 Registro completo de guardias:', registroGuardia);

  let emailLider = '';

  if (registroGuardia && registroGuardia.lider) {
    const nombreLider = registroGuardia.lider;
    console.log('👤 Buscando email para líder:', nombreLider);

    // Buscar el email del líder en la tabla lideres del schema public
    const { data: liderData, error: errorLider } = await supabase
      .from('lideres')
      .select('email')
      .eq('nombre', nombreLider)
      .limit(1)
      .single();

    console.log('📧 Datos del líder encontrado:', liderData);
    console.log('❌ Error búsqueda líder:', errorLider);

    emailLider = liderData?.email || '';
  }
  
  console.log('✅ Mail líder final:', emailLider);

  // Retornar estructura { resultado: [...], mail_lider: "..." }
  return res.json({
    resultado: data,
    mail_lider: emailLider
  });
});

// Endpoint para guardar registro de guardia
router.post("/setRegistroGuardia", async (req, res) => {
  try {
    const jsonGuardia = req.body;
    console.log("📥 Datos recibidos:", jsonGuardia);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_reporte`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept-Profile': 'registros_guardia',
        'Content-Profile': 'registros_guardia'
      },
      body: JSON.stringify({
        datos: jsonGuardia
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(500).json({ error: errorData });
    }

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = null;
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error("Error al guardar registro:", error);
    return res.status(500).json({ error: error.message });
  }
});



module.exports = router;
