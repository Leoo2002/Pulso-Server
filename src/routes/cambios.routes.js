// Rutas para cambios de franco y horario
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const { validateFrancoExchange } = require('../middlewares/security-validation.middleware');

// Realizar cambio de franco
router.post("/cambio",
  validateFrancoExchange,  // ✅ Validar todos los campos (DNI, email, observaciones)
  async (req, res) => {
    try {
      // Datos ya validados por el middleware
      const {
        dni_agente1,
        dni_agente2,
        franco1,
        franco2,
        obs1,
        obs2,
        mail_lider
      } = req.validatedData;

      // Extraer campos adicionales del body (no validados por seguridad, pero sí por lógica)
      const {
        forzado,
        fechaAgente1,
        fechaAgente2,
        egresonuevo1,
        egresonuevo2,
        fecha_inicio
      } = req.body;

      console.log(`🔄 Cambio de franco: DNI1=${dni_agente1}, DNI2=${dni_agente2}, Líder=${mail_lider}`);

      // Validación de lógica de negocio
      if (dni_agente1 === dni_agente2) {
        return res.status(400).json({
          error: 'Validación fallida',
          errorMensaje: "No se puede intercambiar francos con el mismo agente.",
          errorLog: true
        });
      }

      let { data, error } = await supabase.rpc("intercambiar_francos_pruebas", {
        dni1: dni_agente1,
        dni2: dni_agente2,
        egresonuevo1,
        egresonuevo2,
        email_lider: mail_lider,
        fecha_ini: fecha_inicio,
        fechaagente1: fechaAgente1,
        fechaagente2: fechaAgente2,
        forzado,
        francooriginalagente1: franco1,
        francooriginalagente2: franco2,
        obs_agente1: obs1,
        obs_agente2: obs2,
        tipo_cambio: "franco",
      });

      if (error) {
        console.error("❌ Error en Supabase:", error);
        return res.status(500).json({ error: error.message });
      }

      console.log("✅ Cambio procesado exitosamente");
      return res.json({ success: true, data });

    } catch (error) {
      console.error("❌ Error al hacer cambio:", error);
      return res.status(500).json({ error: error.message });
    }
  }
);

// Validar cambio de franco
router.get("/validarCambio", async (req, res) => {
  try {
    console.log("Query para validación de franco:", req.query);

    const { dni_agente1, dni_agente2, franco1, franco2, estadoFranco1, estadoFranco2, isla1, isla2, horasDia1, horasDia2, fecha_inicio1, fecha_inicio2 } = req.query;
    console.log("la fecha ini que comparo es 1:", fecha_inicio1, "2:", fecha_inicio2);

    // Validación: No intercambiar con el mismo agente
    if (Number(dni_agente1) == Number(dni_agente2)) {
      return res.json({
        errorMensaje: "No se puede intercambiar francos con el mismo agente.",
        errorLog: true
      });
    }

    // Validación: Misma semana
    if (fecha_inicio1 != fecha_inicio2) {
      console.log(this.errorMensaje);
      return res.json({
        errorMensaje: "No se puede intercambiar entre semanas diferentes.",
        errorLog: true
      });
    }

    // Validación: No intercambiar licencias o vacaciones
    if (estadoFranco1 == "VAC" || estadoFranco2 == "VAC" || estadoFranco1 == "LIC" || estadoFranco2 == "LIC") {
      console.log(this.errorMensaje);
      return res.json({
        errorMensaje: "No se puede intercambiar licencias o vacaciones.",
        errorLog: true
      });
    }

    // Validación: Mismo día de franco
    if (franco1 == franco2) {
      return res.json({
        errorMensaje: `Los agentes tienen franco el mismo día: ${franco1}`,
        errorLog: true
      });
    }

    // Validación: Mismo tipo de contrato
    if (horasDia1 != horasDia2) {
      return res.json({
        errorMensaje: `Agentes con contratos incompatibles: ${horasDia1}:00 Hs/Día ---> ${horasDia2}:00 Hs/Día`,
        errorLog: true
      });
    }

    // Validación: Misma isla
    if (isla1 !== isla2) {
      return res.json({
        errorMensaje: `Agentes de diferentes islas: ${isla1} ---> ${isla2}`,
        errorLog: true
      });
    }

    return res.json({
      errorMensaje: "Validación exitosa. Puedes intercambiar francos.",
      errorLog: false
    });

  } catch (error) {
    return res.status(500).json({
      errorMensaje: "Error interno del servidor.",
      errorLog: true
    });
  }
});

// Obtener horarios para cambio
router.get('/horarios', async (req, res) => {
  try {
    const { dni1, dia1, dni2, dia2 } = req.query;
    const fecha_ini = req.query.fecha_inicio;
    console.log("horario ingreso", req.query);

    if (!dni1 || !dia1 || !dni2 || !dia2) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    const { data, error } = await supabase
      .rpc('obtener_horarios_multitabla',
        {
          dni1: req.query.dni1,
          dia1: req.query.dia1,
          dni2: req.query.dni2,
          dia2: req.query.dia2,
          fecha_inicio: fecha_ini
        });

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Cambio de horario
router.post("/cambio-horario", async (req, res) => {
  const {
    dni_agente1,
    dni_agente2,
    franco1,
    franco2,
    obs1,
    obs2,
    forzado,
    mail_lider,
    fechaAgente1,
    fechaAgente2,
    egresonuevo1,
    egresonuevo2,
    fecha_inicio
  } = req.body;

  console.log("Datos recibidos en el body:", req.body);

  try {
    let { data, error } = await supabase
      .rpc("intercambiar_horarios2", {
        dni1: dni_agente1,
        dni2: dni_agente2,
        egresonuevo1: egresonuevo1,
        egresonuevo2: egresonuevo2,
        email_lider: mail_lider,
        fecha_ini: fecha_inicio,
        fechaagente1: fechaAgente1,
        fechaagente2: fechaAgente2,
        forzado: forzado,
        francooriginalagente1: franco1,
        francooriginalagente2: franco2,
        obs_agente1: obs1,
        obs_agente2: obs2,
        tipo_cambio: "horario"
      });

    if (error) {
      console.error("Error Supabase:", error);
      return res.status(500).json({ error });
    }

    console.log("Respuesta Supabase:", data);
    return res.json({ success: true, data });

  } catch (error) {
    console.error("Error al hacer cambio:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Validar cambio de horario
router.get("/validarCambioHorario", async (req, res) => {
  try {
    console.log("Query para validación de horario:", req.query);

    const { dni1, dni2, ingreso1, ingreso2, isla1, isla2, horasDia1, horasDia2 } = req.query;

    // Validación: No intercambiar con el mismo agente
    if (dni1 === dni2) {
      return res.json({
        errorMensaje: "No se puede intercambiar horarios con el mismo agente.",
        errorLog: true
      });
    }

    // Validación: No cambiar días no laborales
    if (ingreso1 === 'Feriado' || ingreso1 === 'Franco' || ingreso1 === 'VAC' || ingreso2 === 'LIC' || ingreso2 === 'Feriado' || ingreso2 === 'Franco' || ingreso2 === 'VAC' || ingreso2 === 'LIC') {
      return res.json({
        errorMensaje: `Estas intentando cambiar horario con un día no laboral. ${ingreso1} ---> ${ingreso2}`,
        errorLog: true
      });
    }

    // Validación: Mismo horario
    if (ingreso1 === ingreso2) {
      return res.json({
        errorMensaje: `Agentes con el mismo horario: ${ingreso1}Hs`,
        errorLog: true
      });
    }

    // Validación: Mismo contrato
    if (horasDia1 != horasDia2) {
      return res.json({
        errorMensaje: `Agentes con contratos incompatibles: ${horasDia1}:00 Hs/Día ---> ${horasDia2}:00 Hs/Día`,
        errorLog: true
      });
    }

    // Validación: Misma isla
    if (isla1 !== isla2) {
      return res.json({
        errorMensaje: `Agentes de diferentes islas: ${isla1} ---> ${isla2}`,
        errorLog: true
      });
    }

    return res.json({
      errorMensaje: "Validación exitosa. Puedes intercambiar francos.",
      errorLog: false
    });

  } catch (error) {
    return res.json({
      errorMensaje: "Error interno del servidor.",
      errorLog: true
    });
  }
});

// Obtener información de cambio de horario
router.get("/getInfoCambioHorario", async (req, res) => {
  const dni1 = Number(req.query.dni1);
  const dni2 = Number(req.query.dni2);
  const dia = req.query.dia;
  const fecha_ini = req.query.fecha_ini;

  console.log("Entre a info cambio horario con fecha ini", fecha_ini);

  if (!dni1 || isNaN(dni1) || !dni2 || isNaN(dni2)) {
    return res.status(400).json({ error: "Parámetros inválidos" });
  }

  let { data, error } = await supabase.rpc('fechassemanalesobs3', {
    dia_semana: dia,
    dni1: dni1,
    dni2: dni2,
    fecha_ini: fecha_ini,
  });

  if (error) console.error(error);
  else return res.json(data);
});

// Obtener horarios para validación
router.get("/Obtenerhorarios", async (req, res) => {
  const dni1 = Number(req.query.dni1);
  const dni2 = Number(req.query.dni2);
  const dia = req.query.dia;

  if (!dni1 || isNaN(dni1) || !dni2 || isNaN(dni2)) {
    return res.status(400).json({ error: "Parámetros inválidos" });
  }

  let { data, error } = await supabase.rpc('fechassemanalesobs3', {
    dia_semana: dia,
    dni1: dni1,
    dni2: dni2,
    fecha_ini: '2025-04-28'
  });

  if (error) console.error(error);
  else return res.json(data);
});

// Obtener información por DNI y día
router.get("/ObtenerInfo", async (req, res) => {
  const dni1 = Number(req.query.dni1);
  const dia = req.query.dia;
  const fecha_ini = req.query.fecha_ini;

  let { data, error } = await supabase.rpc('get_observacioneslider', {
    dia: dia,
    doc_agente: dni1,
    fecha_ini: fecha_ini
  });

  if (error) console.error(error);
  else return res.json(data);
});

// Obtener histórico de cambios
router.get("/historico", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc("get_historicocambios");

    if (error) {
      console.error("Error al obtener histórico:", error);
      return res.json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    console.error("Error en el servidor:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
