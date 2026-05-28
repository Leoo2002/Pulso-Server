const { supabase } = require("../config/database");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function historicoGuardiaPorLider(app) {
  app.post("/api/historicoGuardiaPorLider", async (req, res) => {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_guardia_completa?`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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
}

async function fechasReportes(app) {
  app.get("/api/fechasReportes", async (req, res) => {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_fechasreportes?`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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
    }
  });
}

async function getFechasHistoricoGuardias(app) {
  app.get("/api/getFechasHistoricoGuardias", async (req, res) => {
    const mail_lider = req.query.email;

    const { data, error } = await supabase
      .rpc('get_fechas_historico_guardias', {});

    if (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    }

    return res.json(data);
  });
}

async function getHistoricoGuardia(app) {
  app.get("/api/getHistoricoGuardia", async (req, res) => {
    const fecha = req.query.fecha;

    console.log('📅 Fecha recibida:', fecha);

    // Primero buscar en la tabla guardias quién hizo la guardia ese día
    console.log('🔍 Buscando líder de guardia en tabla guardias...');
    
    const { createClient } = require('@supabase/supabase-js');
    const supabaseGuardia = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { db: { schema: 'registros_guardia' } }
    );

    // Obtener los registros de guardia para esa fecha (ordenar por id descendente para tomar el más reciente)
    const { data: registrosGuardia, error: errorRegistros } = await supabaseGuardia
      .from('guardias')
      .select('*')
      .eq('fecha', fecha)
      .order('id_guardia', { ascending: false });

    console.log(`🔍 Se encontraron ${registrosGuardia?.length || 0} registros de guardia para la fecha ${fecha}`);
    
    if (registrosGuardia && registrosGuardia.length > 1) {
      console.warn('⚠️ MÚLTIPLES REGISTROS ENCONTRADOS:', registrosGuardia.map(r => ({ 
        id_guardia: r.id_guardia,
        lider: r.lider, 
        desde: r.desde, 
        hasta: r.hasta 
      })));
    }

    let emailLider = '';
    let nombreLiderGuardia = '';

    // Tomar el primer registro (el más reciente por id_guardia)
    if (registrosGuardia && registrosGuardia.length > 0) {
      const registroGuardia = registrosGuardia[0];
      nombreLiderGuardia = registroGuardia.lider;
      
      console.log('🔍 Registro de guardia seleccionado:', registroGuardia);
      console.log('👤 Líder de guardia del día:', nombreLiderGuardia);

      // Buscar el email del líder en la tabla lideres
      const { data: liderData, error: errorLider } = await supabase
        .from('lideres')
        .select('email')
        .eq('nombre', nombreLiderGuardia)
        .limit(1)
        .single();

      if (errorLider) {
        console.log('❌ Error búsqueda líder:', errorLider);
      } else {
        console.log('📧 Email del líder encontrado:', liderData);
        emailLider = liderData?.email || '';
      }
    }

    // Llamada RPC usando la función wrapper en public
    const { data, error } = await supabase
      .rpc('get_historico_guardia', {
        p_fecha: fecha
      });
 
    if (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    }

    console.log('📊 Datos del RPC (total registros):', data?.length);
    
    console.log('✅ Mail líder final:', emailLider);

    // Retornar estructura { resultado: [...], mail_lider: "..." }
    return res.json({
      resultado: data,
      mail_lider: emailLider
    });
  });
}

async function setRegistroGuardia(app) {
  app.post("/api/setRegistroGuardia", async (req, res) => {
    try {
      const jsonGuardia = req.body;

      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_reporte`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Accept-Profile': 'registros_guardia',
          'Content-Profile': 'registros_guardia'
        },
        body: JSON.stringify({
          datos: jsonGuardia
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(500).json({ error: errorText });
      }

      return res.status(200).json({ ok: true });

    } catch (error) {
      console.error("Error en setRegistroGuardia:", error.message);
      return res.status(500).json({ error: error.message });
    }
  });
}

  async function getGuardiasDelDia(app) {
  app.get("/api/getGuardiasDelDia", async (req, res) => {
    const fecha = req.query.fecha;

    console.log('📅 Obteniendo todas las guardias del día:', fecha);

    const { createClient } = require('@supabase/supabase-js');
    const supabaseGuardia = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      { db: { schema: 'registros_guardia' } }
    );

    // Obtener todas las guardias de la fecha
    const { data: registrosGuardia, error: errorRegistros } = await supabaseGuardia
      .from('guardias')
      .select('id_guardia, lider, fecha, desde, hasta, horario, ADH, OBS, obsGeneral')
      .eq('fecha', fecha)
      .order('id_guardia', { ascending: false });

    if (errorRegistros) {
      console.error('❌ Error al obtener guardias:', errorRegistros);
      return res.status(500).json({ error: errorRegistros.message });
    }

    console.log(`✅ Se encontraron ${registrosGuardia?.length || 0} guardias para la fecha ${fecha}`);

    if (!registrosGuardia || registrosGuardia.length === 0) {
      return res.json([]);
    }

    // Buscar los emails de cada líder
    const guardiasConEmail = await Promise.all(
      registrosGuardia.map(async (guardia) => {
        const { data: liderData, error: errorLider } = await supabase
          .from('lideres')
          .select('email')
          .eq('nombre', guardia.lider)
          .limit(1)
          .single();

        if (errorLider) {
          console.warn(`⚠️ No se encontró email para el líder: ${guardia.lider}`);
        }

        return {
          id_guardia: guardia.id_guardia,
          lider: guardia.lider,
          mail_lider: liderData?.email || '',
          desde: guardia.desde,
          hasta: guardia.hasta,
          horario: guardia.horario
        };
      })
    );

    console.log('📋 Guardias con emails:', guardiasConEmail);

    return res.json(guardiasConEmail);
  });
}

module.exports = {
  historicoGuardiaPorLider,
  fechasReportes,
  getFechasHistoricoGuardias,
  getHistoricoGuardia,
  setRegistroGuardia,
  getGuardiasDelDia
};