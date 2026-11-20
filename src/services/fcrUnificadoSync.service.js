
const { bigquery } = require('../config/bigquery');
const { supabase } = require('../config/database');

const TABLA_BIGQUERY =
    'kn-ar-int-svc-prsnl-plans-prod.DEV_TELECOM_GOLD.FCR_UNIFICADO';

const TABLA_SUPABASE = 'fcr_unificado';

const FECHA_DESDE = '2026-09-01';
const FECHA_HASTA = '2026-09-30';

const REGISTROS_ESPERADOS = 132925;
const LOTE = 500;

const FILTROS_PLIEGO_PERMITIDOS = [
 'SOPORTE DIGITAL',
    'SOPORTE ENTRETENIMIENTO',
    'SOPORTE CONECTIVIDAD',
    'SOPORTE MOVIL',
    'TECNICA',
    'TECNICA DIGITAL',
    'SMB CONVERGENTE ALTO VALOR',
    'VENTAS MOVIL IN FIJO',
    'VENTAS WHATSAPP HOGARES',
    'VENTAS CONVERGENTE FIJO',
    'VENTAS WHATSAPP MOVIL',
    'SMB MIGRA',
    'SOPORTE-RRSS',
    'RETENCION MOVIL',
    'RETENCION CONVERGENTE',
    'SMB CONVERGENTE',
    'SMB DIGITAL MIGRA',
    'WHATSAPP MOROSIDAD',
    'PERSONAL PAY LOGIN Y ONBOARDING',
    'SMB DEGRA',
    'SOPORTE-MOVIL',
    'PERSONAL PAY',
    'INTEGRAL AMBA',
    'ONBOARDING - WHATSAPP',
    'TECNICA',
    'SOPORTE-ENTRETENIMIENTO',
    'INDIVIDUOS TARJETA',
    'ONBOARDING',
    'INTERAL INTERIOR',
    'DEGRADADOS MONOPRODUCTO',
    'WHATSAPP CONVERGENTE',
    'TECNICA RRSS',
    'SMB RETENCION CRECIMIENTO',
    'WHATSAPP CUSTOMER HOGARES',
    'CUSTOMER HOGAR',
    'SMB MULTISKILL',
    'CUSTOMER ONBOARDING',
    'GGCC',
    'SOPORTE-INTERNET',
    'INDIVIDUOS ABONO FIJO',
    'WHATSAPP MOVIL',
    'CUSTOMER CONVERGENTE',
    'PERSONAL PAY CASH IN'
];

function normalizarFecha(fecha) {
    if (fecha == null) return null;

    if (typeof fecha === 'object' && fecha.value) {
        return fecha.value;
    }

    if (fecha instanceof Date) {
        return fecha.toISOString().slice(0, 10);
    }

    return String(fecha).slice(0, 10);
}

function normalizarFechaHora(fechaHora) {
    if (fechaHora == null) return null;

    if (typeof fechaHora === 'object' && fechaHora.value) {
        return fechaHora.value;
    }

    if (fechaHora instanceof Date) {
        return fechaHora.toISOString()
            .replace('T', ' ')
            .replace('Z', '');
    }

    return String(fechaHora).replace('T', ' ').replace('Z', '');
}

async function sincronizarFcrUnificado() {
    console.log('Iniciando sincronización FCR Unificado...');

    // 1. Verificar que la tabla destino esté vacía.
    const { count, error: errorConteo } = await supabase
        .schema('metricas_telecom')
        .from(TABLA_SUPABASE)
        .select('id', { count: 'exact', head: true });

    if (errorConteo) {
        throw new Error(
            `Error verificando tabla destino: ${errorConteo.message}`
        );
    }

    if (count > 0) {
        throw new Error(
            `La tabla ${TABLA_SUPABASE} ya contiene ${count} registros. ` +
            'Se cancela la importación para evitar duplicados.'
        );
    }

    // 2. Consultar BigQuery.
    const consulta = `
        SELECT
            FECHA,
            MES,
            SEMANA,
            CANAL,
            FILTRO_PLIEGO,
            AGENTE_RP,
            TAB1,
            TAB2,
            TAB3,
            TAB4,
            ETIQUETA_IMPORTANTE,
            TAB1_RECONTACTO,
            TAB2_RECONTACTO,
            TAB3_RECONTACTO,
            TAB4_RECONTACTO,
            FECHA_RECONTACTO,
            TOTAL_INTERACCIONES,
            TOTAL_RECALL_EFFECTIVO,
            FCR_PCT,
            LEGAJO,
            AGENTE,
            LIDER,
            JEFE,
            EMPLEADO_ID
        FROM \`${TABLA_BIGQUERY}\`
        WHERE FECHA >= DATE(@fechaDesde)
          AND FECHA < DATE(@fechaHasta)
          AND FILTRO_PLIEGO IN UNNEST(@filtrosPliego)
    `;

    const [filas] = await bigquery.query({
        query: consulta,
        location: 'southamerica-east1',
        params: {
            fechaDesde: FECHA_DESDE,
            fechaHasta: FECHA_HASTA,
            filtrosPliego: FILTROS_PLIEGO_PERMITIDOS
        }
    });

    console.log(`BigQuery devolvió ${filas.length} registros.`);



    // 4. Adaptar las columnas al esquema de Supabase.
    const registros = filas.map(fila => ({
        fecha: normalizarFecha(fila.FECHA),
        mes: fila.MES ?? null,
        semana: fila.SEMANA ?? null,
        canal: fila.CANAL ?? null,
        filtro_pliego: fila.FILTRO_PLIEGO ?? null,
        agente_rp: fila.AGENTE_RP ?? null,

        tab1: fila.TAB1 ?? null,
        tab2: fila.TAB2 ?? null,
        tab3: fila.TAB3 ?? null,
        tab4: fila.TAB4 ?? null,
        etiqueta_importante: fila.ETIQUETA_IMPORTANTE ?? null,

        tab1_recontacto: fila.TAB1_RECONTACTO ?? null,
        tab2_recontacto: fila.TAB2_RECONTACTO ?? null,
        tab3_recontacto: fila.TAB3_RECONTACTO ?? null,
        tab4_recontacto: fila.TAB4_RECONTACTO ?? null,

        fecha_recontacto: normalizarFechaHora(
            fila.FECHA_RECONTACTO
        ),

        total_interacciones: fila.TOTAL_INTERACCIONES ?? null,
        total_recall_effectivo: fila.TOTAL_RECALL_EFFECTIVO ?? null,
        fcr_pct: fila.FCR_PCT ?? null,

        legajo: fila.LEGAJO ?? null,
        agente: fila.AGENTE ?? null,
        lider: fila.LIDER ?? null,
        jefe: fila.JEFE ?? null,
        empleado_id: fila.EMPLEADO_ID ?? null
    }));

    // 5. Insertar por lotes.
    let registrosInsertados = 0;

    for (let i = 0; i < registros.length; i += LOTE) {
        const loteActual = registros.slice(i, i + LOTE);

        const { error } = await supabase
            .schema('metricas_telecom')
            .from(TABLA_SUPABASE)
            .insert(loteActual);

        if (error) {
            throw new Error(
                `Error insertando lote desde el registro ${i + 1}: ` +
                error.message +
                `. Se habían insertado ${registrosInsertados} registros.`
            );
        }

        registrosInsertados += loteActual.length;

        console.log(
            `Insertados ${registrosInsertados} de ${registros.length} registros.`
        );
    }

    console.log('Sincronización FCR Unificado finalizada.');

    return {
        success: true,
        registrosConsultados: filas.length,
        registrosInsertados,
        fechaDesde: FECHA_DESDE,
        fechaHasta: FECHA_HASTA,
        filtrosAplicados: FILTROS_PLIEGO_PERMITIDOS
    };
}

async function getFCRData(app) {
  app.get('/api/fcrData', async (req, res) => {
    try {
      const { data, error } = await supabase.rpc('consultar_fcr', {
    filtro_servicio: 'SOPORTE',
    fecha_desde: '2026-09-01',
    fecha_hasta: '2026-09-30',
    filtro_empleado_id: null,
    filtro_legajo: null,
    filtro_lider: null,
    filtro_canal: null
      });

      if (error) {
        console.error(error);
        return res.status(400).json({ error: error.message });
      }

      console.log(data);
      return res.json(data);
    } catch (error) {
      console.error('Error al obtener los datos de FCR:', error);
      return res.status(500).json({ error: 'Error al obtener los datos de FCR' });
    }
  });
}

module.exports = {
  getFCRData
};