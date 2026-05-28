const fs = require('fs');
const xlsx = require('xlsx');
const multer = require('multer');
const { supabase, SUPABASE_URL, SUPABASE_KEY } = require('../config/database');
const ExcelJS = require("exceljs");

const configFCR = { headerRow: 1, tableName: 'datos_fcr', batchSize: 10 };
const configNPS = { headerRow: 1, tableName: 'datos_nps', batchSize: 1000 };
const configREL = { headerRow: 1, tableName: 'datos_rel', batchSize: 1000 };
const upload = multer({ dest: 'uploads/' });

const COLUMNASFCR = {
  agno: '2025',
  mes: 'noviembre',
  usuario: 'AGENTES_TECO',
  nombre: 'NOMINA1.NOMBRE',
  lider: 'NOMINA1.LIDER',
  jefe: 'NOMINA1.JEFE',
  gerente: 'NOMINA1.GERENTE',
  caso: 'codigo',
  fecha_iniciada: 'fecha_iniciada',
  fecha_ultima_actualizacion: 'fecha_ultima_actualizacion',
  fecha_ultimo_cierre: 'fecha_ultimo_cierre',
  cola: 'cola',
  etiquetas: 'etiquetas',
  etiqueta_importante: 'etiqueta_importante',
  recontacto_codigo: 'Recontacto_codigo',
  recontacto_fecha_iniciada: 'Recontacto_fecha_iniciada',
  recontacto_fecha_ultima_actualizacion: 'Recontacto_fecha_ultima_actualizacion',
  recontacto_fecha_ultimo_cierre: 'Recontacto_fecha_ultimo_cierre',
  recontacto_username: 'Recontacto_Username',
  recontacto_nombre: 'Recontacto_Nombre',
  recontacto_canalidad: 'Recontacto_CANALIDAD',
  recontacto_negocio: 'Recontacto_Negocio',
  recontacto_etiqueta_importante: 'Recontacto_Etiqueta_Importante',
  recontacto_etiquetas: 'Recontacto_Etiquetas',
  recontacto_tabulacion1: 'Recontacto_TABULACION1',
  recontacto_tabulacion2: 'Recontacto_TABULACION2',
  recontacto_tabulacion3: 'Recontacto_TABULACION3',
  recontacto_tabulacion4: 'Recontacto_TABULACION4',
  total_casos: 'TOTAL_CASOS',
  recall_7d: 'RECALL_7D',
  etiqueta1: 'ETIQUETA.1',
  etiqueta2: 'ETIQUETA.2',
  etiqueta3: 'ETIQUETA.3',
  etiqueta4: 'ETIQUETA.4',
};

const COLUMNASNPS = {
  fecha: 'Datos embebidos - FECHA (+00:00 GMT)',
  fecha_respuesta: 'FECHA RTA',
  usuario: 'AGENT_RP',
  nombre: 'NOMINA.NOMBRE',
  lider: 'NOMINA.LIDER',
  jefe: 'NOMINA.JEFE',
  gerente: 'NOMINA.GERENTE',
  caso: 'Datos embebidos - Codigo',
  negocio: 'Datos embebidos - NEGOCIO',
  subarea: 'NOMINA.SUBAREA',
  servicio: 'NOMINA.SERVICIO',
  canal: 'Datos embebidos - Tipos de Servicios',
  cola: 'Datos embebidos - Cola',
  etiqueta1: 'Datos embebidos - Etiqueta importante.1',
  etiqueta2: 'Datos embebidos - Etiqueta importante.2',
  etiqueta3: 'Datos embebidos - Etiqueta importante.3',
  etiqueta4: 'Datos embebidos - Etiqueta importante.4',
  nps: 21,
  nps_resultado: 20,
  encuesta: 'Q3 - ¿Cuál es el motivo de tu calificación?',
  detractor: 'DETRACTOR',
  neutro: 'NEUTRO',
  promotor: 'PROMOTOR',
  total_nps: 'TOTAL NPS',
  tiempo_respuesta: 'Q8_1 - Tiempo transcurrido desde que te contactaste hasta que te respondimos',
  cordialidad_agente: 'Q8_2 - Cordialidad del representante',
  total_cordialidad: 'Total Cord',
  insat_cord: 'INSAT CORD',
  insat_cord_enc: 'INSAT CORD ENC',
  claridad: 'Q8_3 - Claridad de la información suministrada por el representante',
  resolucion: 28,
  reso: 'RESO',
  reso_enc: 'RESO ENC'
};

const COLUMNASREL = {
  fecha: 'fecha',
  usuario: 'AGENTE RP',
  nombre: 'NOMINA1.NOMBRE',
  lider: 'NOMINA1.LIDER',
  jefe: 'NOMINA1.JEFE',
  sub_sitio: 'SUB_SITIO',
  casos_online: 'QCasosOnline',
  salientes: 'Salientes',
  cerrados: 'CasosCerradosxAgentes',
  transferidos: 'Transferidos',
  descartados: 'DescartadosPorAgente',
  chats_finalizados: 'Chats_finalizados',
  service_fan_service_brutos: 'SERVICE_FAN.SERVICE_BRUTOS',
  service_fan_service_neto: 'SERVICE_FAN.SERVICE_NETO',
  service_fan_service_neto_cumplido: 'SERVICE_FAN.SERVICE_NETO_CUMPLIDO',
  service_fan_escalamiento_fan: 'SERVICE_FAN.ESCALAMIENTO_FAN',
  services_open_caso_continuidad: 'DIARIOS_OPEN_SERVICES_MESACTUAL_000000000000.Q_CASO_CONTINUIDAD',
  services_open_caso_netos: 'DIARIOS_OPEN_SERVICES_MESACTUAL_000000000000.Q_CASO_NETOS',
  services_open_caso_totales: 'DIARIOS_OPEN_SERVICES_MESACTUAL_000000000000.Q_CASOS_TOTALES'
};

const COLUMNASRELDIARIA = {
  nombre: 'Propietario del caso',
  usuario: 'Alias del propietario del caso',
  hora: 'Fecha/Hora de apertura',
  service: 'Requiere Cita'
};

function obtenerValor(encabezados, fila, columna) {
  if (!encabezados || encabezados.length === 0) return null;
  if (typeof columna === 'number') return fila[columna] ?? null;

  const normalize = s => (s || '').toString().trim().toLowerCase();

  // Try exact match first
  let idx = encabezados.indexOf(columna);
  if (idx !== -1) return fila[idx] ?? null;

  // Try case-insensitive trimmed match
  const columnaNorm = normalize(columna);
  idx = encabezados.findIndex(h => normalize(h) === columnaNorm);
  if (idx !== -1) return fila[idx] ?? null;

  // Try includes (header contains target) and reverse (target contains header)
  idx = encabezados.findIndex(h => normalize(h).includes(columnaNorm));
  if (idx !== -1) return fila[idx] ?? null;

  idx = encabezados.findIndex(h => columnaNorm.includes(normalize(h)));
  if (idx !== -1) return fila[idx] ?? null;

  // Last resort: try matching by removing non-alphanumeric chars
  const simplify = s => (s || '').toString().replace(/[^a-z0-9]/gi, '').toLowerCase();
  const colSimple = simplify(columna);
  idx = encabezados.findIndex(h => simplify(h) === colSimple);
  if (idx !== -1) return fila[idx] ?? null;

  return null;
}

function normalizarFila(fila) {
  let mes = null;
  let agno = null;

  if (fila.mes) {
    const fecha = new Date(fila.mes);
    if (!isNaN(fecha.getTime())) {
      const nombresMeses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      mes = nombresMeses[fecha.getMonth()];
      agno = fecha.getFullYear();
    } else if (!isNaN(Number(fila.mes))) {
      const nombresMeses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      const numMes = parseInt(fila.mes, 10);
      mes = nombresMeses[numMes - 1] || null;
      agno = new Date().getFullYear();
    } else if (typeof fila.mes === 'string') {
      mes = fila.mes.trim().toLowerCase();
      agno = new Date().getFullYear();
    }
  }

  return {
    mes,
    agno,
    usuario: fila.usuario || null,
    nombre: fila.nombre || null,
    lider: fila.lider || null,
    jefe: fila.jefe || null,
    gerente: fila.gerente || null,
    caso: fila.caso ? Number(fila.caso) : null,
    fecha_iniciada: fila.fecha_iniciada ? new Date(fila.fecha_iniciada).toISOString().split('T')[0] : null,
    fecha_ultima_actualizacion: fila.fecha_ultima_actualizacion ? new Date(fila.fecha_ultima_actualizacion).toISOString().split('T')[0] : null,
    fecha_ultimo_cierre: fila.fecha_ultimo_cierre ? new Date(fila.fecha_ultimo_cierre).toISOString().split('T')[0] : null,
    cola: fila.cola || null,
    etiquetas: fila.etiquetas || null,
    etiqueta_importante: fila.etiqueta_importante || null,
    recontacto_codigo: fila.recontacto_codigo ? Number(fila.recontacto_codigo) : null,
    recontacto_fecha_iniciada: fila.recontacto_fecha_iniciada ? new Date(fila.recontacto_fecha_iniciada).toISOString().split('T')[0] : null,
    recontacto_fecha_ultima_actualizacion: fila.recontacto_fecha_ultima_actualizacion ? new Date(fila.recontacto_fecha_ultima_actualizacion).toISOString().split('T')[0] : null,
    recontacto_fecha_ultimo_cierre: fila.recontacto_fecha_ultimo_cierre ? new Date(fila.recontacto_fecha_ultimo_cierre).toISOString().split('T')[0] : null,
    recontacto_username: fila.recontacto_username || null,
    recontacto_nombre: fila.recontacto_nombre || null,
    recontacto_canalidad: fila.recontacto_canalidad || null,
    recontacto_negocio: fila.recontacto_negocio || null,
    recontacto_etiqueta_importante: fila.recontacto_etiqueta_importante || null,
    recontacto_etiquetas: fila.recontacto_etiquetas || null,
    recontacto_tabulacion1: fila.recontacto_tabulacion1 || null,
    recontacto_tabulacion2: fila.recontacto_tabulacion2 || null,
    recontacto_tabulacion3: fila.recontacto_tabulacion3 || null,
    recontacto_tabulacion4: fila.recontacto_tabulacion4 || null,
    total_casos: fila.total_casos ? Number(fila.total_casos) : 0,
    recall_7d: fila.recall_7d && !isNaN(fila.recall_7d) ? Number(fila.recall_7d) : 0,
    etiqueta1: fila.etiqueta1 || null,
    etiqueta2: fila.etiqueta2 || null,
    etiqueta3: fila.etiqueta3 || null,
    etiqueta4: fila.etiqueta4 || null,
  };
}

function extraerHora(valor) {
  if (valor == null) return null;

  // Caso Excel numérico (RAW)
  if (typeof valor === 'number') {
    const d = xlsx.SSF.parse_date_code(valor);
    if (!d) return null;

    const h = String(d.H).padStart(2, '0');
    const m = String(d.M).padStart(2, '0');
    return `${h}:${m}`;
  }

  // Caso string "9/1/2026, 0:38"
  if (typeof valor === 'string' && valor.includes(',')) {
    const hora = valor.split(',')[1].trim();
    const [h, m] = hora.split(':');
    return `${h.padStart(2, '0')}:${m}`;
  }

  // Caso string "0:38"
  if (typeof valor === 'string' && valor.includes(':')) {
    const [h, m] = valor.split(':');
    return `${h.padStart(2, '0')}:${m}`;
  }

  return null;
}



async function registerMetricas(router) {
  // Cargar FCR
  router.post("/cargarFCR", upload.single("file"), async (req, res) => {
    console.log("➡️ cargarFCR streaming");

    try {
      if (!req.file) {
        return res.status(400).json({ error: "No se recibió ningún archivo" });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);

      const sheet =
        workbook.getWorksheet("FCR_SOPORTE_DIGITAL") ||
        workbook.worksheets[0];

      if (!sheet) {
        return res.status(400).json({ error: "Hoja no encontrada" });
      }

      const headerRow = sheet.getRow(configFCR.headerRow);
      const encabezados = headerRow.values;

      const BATCH_SIZE = 50;
      let lote = [];
      let total = 0;

      const numericKeys = ["total_casos", "recall_7d"];

      for (let rowNumber = configFCR.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
        const row = sheet.getRow(rowNumber);

        const data = {
          mes: "Noviembre",
          agno: "2025",

          usuario: obtenerValor(encabezados, row.values, COLUMNASFCR.usuario),
          nombre: obtenerValor(encabezados, row.values, COLUMNASFCR.nombre),
          lider: obtenerValor(encabezados, row.values, COLUMNASFCR.lider),
          jefe: obtenerValor(encabezados, row.values, COLUMNASFCR.jefe),
          gerente: obtenerValor(encabezados, row.values, COLUMNASFCR.gerente),
          caso: obtenerValor(encabezados, row.values, COLUMNASFCR.caso),

          fecha_iniciada: obtenerValor(encabezados, row.values, COLUMNASFCR.fecha_iniciada),
          fecha_ultima_actualizacion: obtenerValor(encabezados, row.values, COLUMNASFCR.fecha_ultima_actualizacion),
          fecha_ultimo_cierre: obtenerValor(encabezados, row.values, COLUMNASFCR.fecha_ultimo_cierre),

          cola: obtenerValor(encabezados, row.values, COLUMNASFCR.cola),
          etiquetas: obtenerValor(encabezados, row.values, COLUMNASFCR.etiquetas),
          etiqueta_importante: obtenerValor(encabezados, row.values, COLUMNASFCR.etiqueta_importante),

          total_casos: obtenerValor(encabezados, row.values, COLUMNASFCR.total_casos),
          recall_7d: obtenerValor(encabezados, row.values, COLUMNASFCR.recall_7d),
        };

        if (!data.usuario) continue;

        numericKeys.forEach(k => {
          const v = data[k];
          const n = Number(String(v).replace(/,/g, ""));
          data[k] = isNaN(n) ? null : n;
        });

        lote.push(data);
        console.log("lote size:", lote);
        if (lote.length === BATCH_SIZE) {
          await supabase
            .schema("kpi")
            .from("datos_fcr")
            .upsert(lote, { returning: "minimal" });

          total += lote.length;
          lote.length = 0; // liberar RAM
        }
      }

      // insertar resto
      if (lote.length) {
        await supabase
          .schema("kpi")
          .from("datos_fcr")
          .upsert(lote, { returning: "minimal" });

        total += lote.length;
      }

      fs.unlinkSync(req.file.path);

      return res.json({
        mensaje: "Carga FCR OK (streaming)",
        total
      });

    } catch (err) {
      console.error("❌ cargarFCR:", err);
      return res.status(500).json({ error: err.message });
    }
  });


  // Cargar NPS
  router.post('/cargarNPS', upload.single('file'), async (req, res) => {
    console.log("entre a cargar NPS");
    try {
      if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

      const fileBuffer = fs.readFileSync(req.file.path);
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      const hoja = workbook.Sheets['DIGITAL'] || workbook.Sheets[workbook.SheetNames[0]];
      if (!hoja) return res.status(400).json({ error: 'No se encontró la hoja en el Excel' });

      const datos = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: false, dateNF: 'dd-mm-yyyy' });
      const encabezados = datos[configNPS.headerRow - 1];

      const datosHoja = datos.slice(configNPS.headerRow).map(fila => ({
        agno: '2025',
        mes: 'Noviembre',
        fecha: obtenerValor(encabezados, fila, COLUMNASNPS.fecha),
        fecha_respuesta: obtenerValor(encabezados, fila, COLUMNASNPS.fecha_respuesta),
        usuario: obtenerValor(encabezados, fila, COLUMNASNPS.usuario),
        nombre: obtenerValor(encabezados, fila, COLUMNASNPS.nombre),
        lider: obtenerValor(encabezados, fila, COLUMNASNPS.lider),
        jefe: obtenerValor(encabezados, fila, COLUMNASNPS.jefe),
        gerente: obtenerValor(encabezados, fila, COLUMNASNPS.gerente),
        caso: obtenerValor(encabezados, fila, COLUMNASNPS.caso),
        negocio: obtenerValor(encabezados, fila, COLUMNASNPS.negocio),
        subarea: obtenerValor(encabezados, fila, COLUMNASNPS.subarea),
        servicio: obtenerValor(encabezados, fila, COLUMNASNPS.servicio),
        canal: obtenerValor(encabezados, fila, COLUMNASNPS.canal),
        cola: obtenerValor(encabezados, fila, COLUMNASNPS.cola),
        etiqueta1: obtenerValor(encabezados, fila, COLUMNASNPS.etiqueta1),
        etiqueta2: obtenerValor(encabezados, fila, COLUMNASNPS.etiqueta2),
        etiqueta3: obtenerValor(encabezados, fila, COLUMNASNPS.etiqueta3),
        etiqueta4: obtenerValor(encabezados, fila, COLUMNASNPS.etiqueta4),
        nps: obtenerValor(encabezados, fila, COLUMNASNPS.nps),
        nps_resultado: obtenerValor(encabezados, fila, COLUMNASNPS.nps_resultado),
        encuesta: obtenerValor(encabezados, fila, COLUMNASNPS.encuesta),
        detractor: obtenerValor(encabezados, fila, COLUMNASNPS.detractor),
        neutro: obtenerValor(encabezados, fila, COLUMNASNPS.neutro),
        promotor: obtenerValor(encabezados, fila, COLUMNASNPS.promotor),
        total_nps: obtenerValor(encabezados, fila, COLUMNASNPS.total_nps),
        tiempo_respuesta: obtenerValor(encabezados, fila, COLUMNASNPS.tiempo_respuesta),
        cordialidad_agente: obtenerValor(encabezados, fila, COLUMNASNPS.cordialidad_agente),
        total_cordialidad: obtenerValor(encabezados, fila, COLUMNASNPS.total_cordialidad),
        insat_cord: obtenerValor(encabezados, fila, COLUMNASNPS.insat_cord),
        insat_cord_enc: obtenerValor(encabezados, fila, COLUMNASNPS.insat_cord_enc),
        claridad: obtenerValor(encabezados, fila, COLUMNASNPS.claridad),
        resolucion: obtenerValor(encabezados, fila, COLUMNASNPS.resolucion),
        reso: obtenerValor(encabezados, fila, COLUMNASNPS.reso),
        reso_enc: obtenerValor(encabezados, fila, COLUMNASNPS.reso_enc),
      })).filter(row => row.usuario);

      fs.unlinkSync(req.file.path);

      const datosFiltrados = datosHoja.filter(row => row.negocio === 'CABLE SOPORTE');

      if (datosFiltrados.length === 0) {
        return res.status(200).json({ mensaje: 'No hay datos con negocio = CABLE SOPORTE', total: 0 });
      }

      for (let i = 0; i < datosFiltrados.length; i += configREL.batchSize) {
        const lote = datosFiltrados.slice(i, i + configREL.batchSize);

        console.log("⬆ Insertando lote:", lote.length);

        // 1) Upsert usando schema (la forma correcta)
        let result = await supabase
          .schema("kpi")
          .from("datos_nps")
          .upsert(lote, { returning: "minimal" });

        if (result.error) {
          console.warn("⚠ Error primary schema():", result.error);

          // 2) Fallback: usando nombre completo de esquema
          result = await supabase
            .from("kpi.datos_nps")
            .upsert(lote, { returning: "minimal" });

          if (result.error) {
            console.error("❌ Falla en fallback:", result.error);
            return res.status(500).json({
              error: "Error insertando datos NPS",
              detalle: result.error
            });
          }
        }
      }

      return res.json({
        mensaje: "Carga NPS OK",
        total: datosFiltrados.length
      });

    } catch (error) {
      console.error("🚨 Error en cargarNPS:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Cargar REL
  router.post("/cargarREL", upload.single("file"), async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No se recibió ningún archivo" });

      const workbook = xlsx.read(fs.readFileSync(req.file.path), { type: "buffer" });
      const hoja = workbook.Sheets["Hoja1"] || workbook.Sheets[workbook.SheetNames[0]];

      if (!hoja) return res.status(400).json({ error: "Hoja no encontrada" });

      const datos = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: false });
      const encabezados = datos[0];

      const filas = datos.slice(1)
        .map(f => ({

          agno: "2025",
          mes: "Noviembre",

          fecha: obtenerValor(encabezados, f, COLUMNASREL.fecha),
          usuario: obtenerValor(encabezados, f, COLUMNASREL.usuario),
          nombre: obtenerValor(encabezados, f, COLUMNASREL.nombre),
          lider: obtenerValor(encabezados, f, COLUMNASREL.lider),
          jefe: obtenerValor(encabezados, f, COLUMNASREL.jefe),
          sub_sitio: obtenerValor(encabezados, f, COLUMNASREL.sub_sitio),

          casos_online: obtenerValor(encabezados, f, COLUMNASREL.casos_online),
          salientes: obtenerValor(encabezados, f, COLUMNASREL.salientes),
          cerrados: obtenerValor(encabezados, f, COLUMNASREL.cerrados),
          transferidos: obtenerValor(encabezados, f, COLUMNASREL.transferidos),
          descartados: obtenerValor(encabezados, f, COLUMNASREL.descartados),
          chats_finalizados: obtenerValor(encabezados, f, COLUMNASREL.chats_finalizados),

          service_fan_service_brutos: obtenerValor(encabezados, f, COLUMNASREL.service_fan_service_brutos),
          service_fan_service_neto: obtenerValor(encabezados, f, COLUMNASREL.service_fan_service_neto),
          service_fan_service_neto_cumplido: obtenerValor(encabezados, f, COLUMNASREL.service_fan_service_neto_cumplido),
          service_fan_escalamiento_fan: obtenerValor(encabezados, f, COLUMNASREL.service_fan_escalamiento_fan),

          services_open_caso_continuidad: obtenerValor(encabezados, f, COLUMNASREL.services_open_caso_continuidad),
          services_open_caso_netos: obtenerValor(encabezados, f, COLUMNASREL.services_open_caso_netos),
          services_open_caso_totales: obtenerValor(encabezados, f, COLUMNASREL.services_open_caso_totales),
        }))
        .filter(r => r.usuario);

      fs.unlinkSync(req.file.path);

      // --------------- NORMALIZACIÓN numérica ----------------
      const numericKeys = [
        "casos_online", "salientes", "cerrados", "transferidos", "descartados",
        "chats_finalizados", "service_fan_service_brutos", "service_fan_service_neto",
        "service_fan_service_neto_cumplido", "service_fan_escalamiento_fan",
        "services_open_caso_continuidad", "services_open_caso_netos", "services_open_caso_totales"
      ];

      const filasNormalizadas = filas.map(r => {
        const copy = { ...r };
        numericKeys.forEach(k => {
          const val = copy[k];
          if (val === null || val === undefined || val === "") {
            copy[k] = null;
          } else {
            const n = Number(String(val).replace(/,/g, ""));
            copy[k] = isNaN(n) ? null : n;
          }
        });
        return copy;
      });

      // --------------- INSERT POR LOTES ----------------
      for (let i = 0; i < filasNormalizadas.length; i += configREL.batchSize) {
        const lote = filasNormalizadas.slice(i, i + configREL.batchSize);

        console.log("⬆ Insertando lote:", lote.length);

        // 1) Upsert usando schema (la forma correcta)
        let result = await supabase
          .schema("kpi")
          .from("datos_resolucion")
          .upsert(lote, { returning: "minimal" });

        if (result.error) {
          console.warn("⚠ Error primary schema():", result.error);

          // 2) Fallback: usando nombre completo de esquema
          result = await supabase
            .from("kpi.datos_resolucion")
            .upsert(lote, { returning: "minimal" });

          if (result.error) {
            console.error("❌ Falla en fallback:", result.error);
            return res.status(500).json({
              error: "Error insertando datos REL",
              detalle: result.error
            });
          }
        }
      }

      return res.json({
        mensaje: "Carga REL OK",
        total: filasNormalizadas.length
      });

    } catch (error) {
      console.error("🚨 Error en cargarREL:", error);
      res.status(500).json({ error: error.message });
    }
  });



  router.get("/getRelDiaria", async (req, res) => {
    console.log("➡️ cargarRELDiaria");
    try {
      const { mail } = req.query;
      console.log(mail)
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_rel_por_mail?mail_agente=${encodeURIComponent(mail)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Accept-Profile': 'kpi',
          'Content-Profile': 'kpi'
        }
      });

      const rawText = await response.text();
      console.log("📊 REL RAW:", rawText);

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
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
      console.error("🔥 Error REL handler:", error);
      res.status(500).json({ error: "Error interno" });
    }
  });

  router.get("/getRelDiariaPorLider", async (req, res) => {
    console.log("➡️ cargarRELDiariaxLider");
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_rel_diaria_porlider`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Accept-Profile': 'kpi',
          'Content-Profile': 'kpi'
        }
      });

      const rawText = await response.text();
      console.log("📊 REL RAW:", rawText);

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
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
      console.error("🔥 Error REL handler:", error);
      res.status(500).json({ error: "Error interno" });
    }
  });


  function normalizarMesAgno(valor) {
    const nombresMeses = [
      "enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    ];

    if (!valor) return { mes: null, agno: null };

    // 1️⃣ Si ya es Date
    if (valor instanceof Date && !isNaN(valor)) {
      return {
        mes: nombresMeses[valor.getMonth()],
        agno: valor.getFullYear()
      };
    }

    // 2️⃣ Si viene como número de Excel (serial)
    if (typeof valor === "number") {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const fecha = new Date(excelEpoch.getTime() + valor * 86400000);
      return {
        mes: nombresMeses[fecha.getMonth()],
        agno: fecha.getFullYear()
      };
    }

    // 3️⃣ Si es string
    if (typeof valor === "string") {
      const limpio = valor.trim().toLowerCase();

      // 3a) Mes como texto ("noviembre")
      if (nombresMeses.includes(limpio)) {
        return {
          mes: limpio,
          agno: new Date().getFullYear()
        };
      }

      // 3b) Fecha separada por / o -
      const sep = limpio.includes("/") ? "/" : limpio.includes("-") ? "-" : null;

      if (sep) {
        const partes = limpio.split(sep).map(p => p.trim());

        // YYYY-MM-DD
        if (partes[0].length === 4) {
          const agno = Number(partes[0]);
          const mesNum = Number(partes[1]);
          return {
            mes: nombresMeses[mesNum - 1] || null,
            agno
          };
        }

        // DD/MM/YY o DD/MM/YYYY
        if (partes.length === 3) {
          let mesNum = Number(partes[1]);
          let agno = Number(partes[2]);

          if (agno < 100) agno += 2000;

          return {
            mes: nombresMeses[mesNum - 1] || null,
            agno
          };
        }
      }

      // 3c) Mes como número ("11")
      if (!isNaN(limpio)) {
        const mesNum = Number(limpio);
        return {
          mes: nombresMeses[mesNum - 1] || null,
          agno: new Date().getFullYear()
        };
      }
    }

    return { mes: null, agno: null };
  }

  router.post("/borrarRELDiaria", async (req, res) => {
       const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/vaciar_rel_diaria`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Accept-Profile': 'kpi',
            'Content-Profile': 'kpi'
          }
        }
      );

      const rawText = await response.text();
      console.log("🧹 TRUNCATE REL RAW:", rawText);

      if (!response.ok) {
        return res.status(response.status).json({
          error: "Error limpiando REL",
          details: rawText
        });
      }
    });

  router.post("/cargar_intervalo_rel", async (req, res) => {
  try {
    const { mail } = req.body;
    console.log("➡️ cargar_intervalo_rel:", mail);
    if (!mail) {
      return res.status(400).json({ error: "Mail requerido" });
    }

    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/cargar_rel_diaria`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Accept-Profile': 'kpi',
          'Content-Profile': 'kpi'
        },
        body: JSON.stringify({ mail })
      }
    );

    const texto = await resp.text();
    console.log("📌 Registro carga REL:", texto);

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: "Falló el registro de carga REL",
        detalle: texto
      });
    }

    return res.json({ ok: true });

  } catch (error) {
    console.error("🚨 Error cargar_intervalo_rel:", error);
    return res.status(500).json({ error: error.message });
  }
});

  router.get("/obtenerUltimoIntervaloRel", async (req, res) => {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/obtener_intervalo_rel_diaria`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Accept-Profile': 'kpi',
            'Content-Profile': 'kpi'
          }
        }
      );

      const rawText = await response.text();
      console.log("📌 Intervalo REL RAW:", rawText);

      if (!response.ok) {
        return res.status(response.status).json({
          error: "Error obteniendo intervalo REL",
          details: rawText
        });
      }

      const data = JSON.parse(rawText);

      // Supabase devuelve array siempre
      return res.json(data.length ? data[0] : null);

    } catch (error) {
      console.error("🚨 Error obtenerIntervaloREL:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  router.post("/cargarRELDiaria", upload.single('file'), async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "No se recibió ningún archivo" });
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/vaciar_rel_diaria`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Accept-Profile': 'kpi',
            'Content-Profile': 'kpi'
          }
        }
      );

      const rawText = await response.text();
      console.log("🧹 TRUNCATE REL RAW:", rawText);

      if (!response.ok) {
        return res.status(response.status).json({
          error: "Error limpiando REL",
          details: rawText
        });
      }


      const workbook = xlsx.read(fs.readFileSync(req.file.path), { type: "buffer" });
      const hoja = workbook.Sheets["Hoja1"] || workbook.Sheets[workbook.SheetNames[0]];

      if (!hoja) return res.status(400).json({ error: "Hoja no encontrada" });

      const datos = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: true });
      const encabezados = datos[0];

      const filas = datos.slice(1)
        .map(f => ({

          nombre: obtenerValor(encabezados, f, COLUMNASRELDIARIA.nombre),
          usuario: obtenerValor(encabezados, f, COLUMNASRELDIARIA.usuario),
          hora: extraerHora(
            obtenerValor(encabezados, f, COLUMNASRELDIARIA.hora)
          ),
          service: obtenerValor(encabezados, f, COLUMNASRELDIARIA.service),
        }))
        .filter(r => r.usuario);

      fs.unlinkSync(req.file.path);
      console.log(filas);


      // --------------- INSERT POR LOTES ----------------
      for (let i = 0; i < filas.length; i += configREL.batchSize) {
        const lote = filas.slice(i, i + configREL.batchSize);

        console.log("⬆ Insertando lote:", lote.length);

        // 1) Upsert usando schema (la forma correcta)
        let result = await supabase
          .schema("kpi")
          .from("rel_diaria_crudo")
          .insert(lote, { returning: "minimal" });

        if (result.error) {
          console.warn("⚠ Error primary schema():", result.error);

          // 2) Fallback: usando nombre completo de esquema
          result = await supabase
            .from("kpi.rel_diaria_crudo")
            .upsert(lote, { returning: "minimal" });

          if (result.error) {
            console.error("❌ Falla en fallback:", result.error);
            return res.status(500).json({
              error: "Error insertando datos REL",
              detalle: result.error
            });
          }
        }
      }

      return res.json({
        mensaje: "Carga REL OK",
        total: filas.length
      });

    } catch (error) {
      console.error("🚨 Error en cargarREL:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
module.exports = { registerMetricas };



