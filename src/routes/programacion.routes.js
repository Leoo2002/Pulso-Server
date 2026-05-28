// Rutas para programación y guardias
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');
const xlsx = require("xlsx");
const { COLUMNAS, CONFIG_EXCEL } = require('../constants/excel-columns');
const { obtenerValor, obtenerHora } = require('../utils/excel-helpers');

// Obtener programación por líder
router.get("/obtenerprogra", async (req, res) => {
  const doc_lider = Number(req.query.dni_lider);
  const fecha_ini = req.query.fecha_ini;
  console.log("documento del lider", doc_lider);

  try {
    let { data, error } = await supabase
      .rpc('get_prograpordnilider', {
        doc_lider: doc_lider,
        fecha_ini: fecha_ini
      });
    if (error) console.error(error);
    else res.json(data);

  } catch (error) {
    console.error("Error en el servidor:", error);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Obtener día actual
router.get("/obtenerDiaActual", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_diasemana', {});

    if (error) {
      console.error("Error al obtener histórico:", error);
      return res.json({ error: error.message });
    }

    return res.json(data);
  } catch (error) {
    console.error("Error en el servidor:", error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener programación de lunes
router.get("/programacionLunes", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_programacionlunes');

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

router.get("/programacionMartes", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_programacionmartes');

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

// Obtener programación de jueves
router.get("/programacionJueves", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_programacionjueves');

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

// Obtener programación de viernes
router.get("/programacionViernes", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_programacionviernes');

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

// Obtener programación de sábado
router.get("/programacionSabado", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_programacionsabado');

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

// Obtener programación de domingo
router.get("/programacionDomingo", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('get_programaciondomingo');

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

// Set observaciones y estado de guardia
router.get("/ObsyEstadoGuardia", async (req, res) => {
  console.log("ObsyEstadoGuardia params:", req.query);
  const dia = req.query.dia;
  const doc_agente = Number(req.query.doc_agente);
  const obs = req.query.obs;
  const state = req.query.state;
  const hora = req.query.horaIngreso;
  // Convertir string a boolean
  const aviso = req.query.ausenteAviso === 'true';

  console.log("Datos a guardar:", { dia, doc_agente, obs, state, hora, aviso });

  try {
    const { data, error } = await supabase.rpc('set_obsyestadoguardia', {
      dia: dia,
      doc_agente: doc_agente,
      obs: obs,
      state: state,
      hora: hora,
      aviso: aviso
    });

    if (error) {
      console.error("Error al cargar:", error);
      return res.json({ error: error.message });
    }

    console.log("Guardado exitoso para", doc_agente);
    res.json(data);
  } catch (error) {
    console.error("Error en el servidor:", error);
    res.status(500).json({ error: error.message });
  }
});

// Guardar observaciones generales
router.post('/guardarObsGeneral', async (req, res) => {
  const agentes = req.body;

  try {
    for (const agente of agentes) {
      const { doc_agente, obs, state, dia, horaIngreso, ausenteAviso } = agente;

      const { data, error } = await supabase
        .rpc('set_obsandestadoguardia', {
          dia: dia,
          doc_agente: doc_agente,
          obs: obs,
          state: state,
          hora: horaIngreso,
          aviso: ausenteAviso
        });

      if (error) {
        throw error;
      }
    }

    res.status(200).json({ message: "Observaciones guardadas correctamente." });
  } catch (error) {
    console.error("Error al guardar observaciones:", error);
    res.status(500).json({ message: "Error al guardar observaciones." });
  }
});

// Set observaciones del líder
router.get('/setObservaciones', async (req, res) => {
  try {
    const { fecha, dniAgente, lun, mar, mie, jue, vie, sab, dom } = req.query;

    const { data, error } = await supabase
      .rpc('set_observacioneslider', {
        doc_agente: req.query.dniAgente,
        fecha: req.query.fecha,
        lun: req.query.lun,
        mar: req.query.mar,
        mie: req.query.mie,
        jue: req.query.jue,
        vie: req.query.vie,
        sab: req.query.sab,
        dom: req.query.dom
      });

    if (error) {
      throw error;
    }

    res.json({ success: true, message: 'Observaciones actualizadas correctamente', data });
  } catch (error) {
    console.error('Error al actualizar observaciones:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar observaciones', error });
  }
});

// Descargar programación
router.get("/descargarProgra", async (req, res) => {
  const fecha_ini = req.query.fecha_ini;
  console.log("entre a descargar progra", fecha_ini);

  let { data, error } = await supabase
    .rpc('descargar_programacion2', {
      fecha_ini: fecha_ini
    });

  if (error) console.error(error);
  else {
    res.json(data);
  }
});

// Obtener inicio de semana actual
router.get("/inicioSemanaActual", async (req, res) => {
  let { data, error } = await supabase
    .rpc('get_iniciosemanaactual');
  if (error) console.error(error);
  else res.json(data);
});

// Cargar programación desde archivo Excel
router.post("/cargarProgra", async (req, res) => {
  const { filePath } = req.body;
  const fecha_ini = req.query.fecha_ini;
  console.log(fecha_ini);

  if (!filePath) {
    return res.status(400).json({ error: "filePath es requerido" });
  }

  try {
    // Descargar el archivo desde Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('programacion')
      .download(filePath);

    if (downloadError) throw downloadError;

    // Leer el Excel
    const fileBuffer = await fileData.arrayBuffer();
    const workbook = xlsx.read(fileBuffer);

    // Procesar cada hoja
    let datosParaSubir = [];
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const datos = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
      const encabezados = datos[CONFIG_EXCEL.headerRow];

      const datosHoja = datos.slice(CONFIG_EXCEL.headerRow + 1)
        .map(fila => ({
          dni_progra: obtenerValor(encabezados, fila, COLUMNAS.DNI) + fecha_ini.replaceAll('-', ''),
          dni_agente: obtenerValor(encabezados, fila, COLUMNAS.DNI),
          lunes: obtenerValor(encabezados, fila, COLUMNAS.LUNES) === '1' ? obtenerHora(encabezados, fila, COLUMNAS.INGRESO_LUNES) : obtenerValor(encabezados, fila, COLUMNAS.LUNES),
          martes: obtenerValor(encabezados, fila, COLUMNAS.MARTES) === '1' ? obtenerHora(encabezados, fila, COLUMNAS.INGRESO_MARTES) : obtenerValor(encabezados, fila, COLUMNAS.MARTES),
          miercoles: obtenerValor(encabezados, fila, COLUMNAS.MIERCOLES) === '1' ? obtenerHora(encabezados, fila, COLUMNAS.INGRESO_MIERCOLES) : obtenerValor(encabezados, fila, COLUMNAS.MIERCOLES),
          jueves: obtenerValor(encabezados, fila, COLUMNAS.JUEVES) === '1' ? obtenerHora(encabezados, fila, COLUMNAS.INGRESO_JUEVES) : obtenerValor(encabezados, fila, COLUMNAS.JUEVES),
          viernes: obtenerValor(encabezados, fila, COLUMNAS.VIERNES) === '1' ? obtenerHora(encabezados, fila, COLUMNAS.INGRESO_VIERNES) : obtenerValor(encabezados, fila, COLUMNAS.VIERNES),
          sabado: obtenerValor(encabezados, fila, COLUMNAS.SABADO) === '1' ? obtenerHora(encabezados, fila, COLUMNAS.INGRESO_SABADO) : obtenerValor(encabezados, fila, COLUMNAS.SABADO),
          domingo: obtenerValor(encabezados, fila, COLUMNAS.DOMINGO) === '1' ? obtenerHora(encabezados, fila, COLUMNAS.INGRESO_DOMINGO) : obtenerValor(encabezados, fila, COLUMNAS.DOMINGO),
          blunes: obtenerValor(encabezados, fila, COLUMNAS.BREAK_LUNES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.BREAK_LUNES) : obtenerValor(encabezados, fila, COLUMNAS.BREAK_LUNES),
          bmartes: obtenerValor(encabezados, fila, COLUMNAS.BREAK_MARTES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.BREAK_MARTES) : obtenerValor(encabezados, fila, COLUMNAS.BREAK_MARTES),
          bmiercoles: obtenerValor(encabezados, fila, COLUMNAS.BREAK_MIERCOLES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.BREAK_MIERCOLES) : obtenerValor(encabezados, fila, COLUMNAS.BREAK_MIERCOLES),
          bjueves: obtenerValor(encabezados, fila, COLUMNAS.BREAK_JUEVES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.BREAK_JUEVES) : obtenerValor(encabezados, fila, COLUMNAS.BREAK_JUEVES),
          bviernes: obtenerValor(encabezados, fila, COLUMNAS.BREAK_VIERNES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.BREAK_VIERNES) : obtenerValor(encabezados, fila, COLUMNAS.BREAK_VIERNES),
          bsabado: obtenerValor(encabezados, fila, COLUMNAS.BREAK_SABADO) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.BREAK_SABADO) : obtenerValor(encabezados, fila, COLUMNAS.BREAK_SABADO),
          bdomingo: obtenerValor(encabezados, fila, COLUMNAS.BREAK_DOMINGO) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.BREAK_DOMINGO) : obtenerValor(encabezados, fila, COLUMNAS.BREAK_DOMINGO),
          agenda_lunes: obtenerValor(encabezados, fila, COLUMNAS.AGENDA_LUNES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.AGENDA_LUNES) : obtenerValor(encabezados, fila, COLUMNAS.AGENDA_LUNES),
          agenda_martes: obtenerValor(encabezados, fila, COLUMNAS.AGENDA_MARTES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.AGENDA_MARTES) : obtenerValor(encabezados, fila, COLUMNAS.AGENDA_MARTES),
          agenda_miercoles: obtenerValor(encabezados, fila, COLUMNAS.AGENDA_MIERCOLES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.AGENDA_MIERCOLES) : obtenerValor(encabezados, fila, COLUMNAS.AGENDA_MIERCOLES),
          agenda_jueves: obtenerValor(encabezados, fila, COLUMNAS.AGENDA_JUEVES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.AGENDA_JUEVES) : obtenerValor(encabezados, fila, COLUMNAS.AGENDA_JUEVES),
          agenda_viernes: obtenerValor(encabezados, fila, COLUMNAS.AGENDA_VIERNES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.AGENDA_VIERNES) : obtenerValor(encabezados, fila, COLUMNAS.AGENDA_VIERNES),
          agenda_sabado: obtenerValor(encabezados, fila, COLUMNAS.AGENDA_SABADO) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.AGENDA_SABADO) : obtenerValor(encabezados, fila, COLUMNAS.AGENDA_SABADO),
          agenda_domingo: obtenerValor(encabezados, fila, COLUMNAS.AGENDA_DOMINGO) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.AGENDA_DOMINGO) : obtenerValor(encabezados, fila, COLUMNAS.AGENDA_DOMINGO),
          training_lunes: obtenerValor(encabezados, fila, COLUMNAS.TRAINING_LUNES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.TRAINING_LUNES) : obtenerValor(encabezados, fila, COLUMNAS.TRAINING_LUNES),
          training_martes: obtenerValor(encabezados, fila, COLUMNAS.TRAINING_MARTES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.TRAINING_MARTES) : obtenerValor(encabezados, fila, COLUMNAS.TRAINING_MARTES),
          training_miercoles: obtenerValor(encabezados, fila, COLUMNAS.TRAINING_MIERCOLES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.TRAINING_MIERCOLES) : obtenerValor(encabezados, fila, COLUMNAS.TRAINING_MIERCOLES),
          training_jueves: obtenerValor(encabezados, fila, COLUMNAS.TRAINING_JUEVES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.TRAINING_JUEVES) : obtenerValor(encabezados, fila, COLUMNAS.TRAINING_JUEVES),
          training_viernes: obtenerValor(encabezados, fila, COLUMNAS.TRAINING_VIERNES) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.TRAINING_VIERNES) : obtenerValor(encabezados, fila, COLUMNAS.TRAINING_VIERNES),
          training_sabado: obtenerValor(encabezados, fila, COLUMNAS.TRAINING_SABADO) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.TRAINING_SABADO) : obtenerValor(encabezados, fila, COLUMNAS.TRAINING_SABADO),
          training_domingo: obtenerValor(encabezados, fila, COLUMNAS.TRAINING_DOMINGO) != '-' ? obtenerHora(encabezados, fila, COLUMNAS.TRAINING_DOMINGO) : obtenerValor(encabezados, fila, COLUMNAS.TRAINING_DOMINGO),
          fecha_inicio: fecha_ini
        }))
        .filter(row => row.dni_agente);

      datosParaSubir = datosParaSubir.concat(datosHoja);
    });

    // Subir a Supabase en lotes
    for (let i = 0; i < datosParaSubir.length; i += CONFIG_EXCEL.batchSize) {
      const lote = datosParaSubir.slice(i, i + CONFIG_EXCEL.batchSize);
      const { error: insertError } = await supabase
        .from(CONFIG_EXCEL.tableName)
        .upsert(lote);

      if (insertError) {
        console.error("Error insertando lote:", insertError.code);
        throw insertError;
      }
    }

    res.status(200).json({
      success: true,
      rowsInserted: datosParaSubir.length
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json(error.code);
  }
});

// Obtener fechas de inicio disponibles
router.get("/traerFechaIni", async (req, res) => {
  try {
    let { data, error } = await supabase
      .rpc('get_fechasinicio');
    if (error) console.error(error);
    res.json(data);

  } catch (error) {
    console.error("Error:", error);
  }
});

module.exports = router;
