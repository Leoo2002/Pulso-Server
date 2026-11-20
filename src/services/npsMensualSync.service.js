
const { bigquery } = require('../config/bigquery');
const { supabase } = require('../config/database');

const TABLA_BIGQUERY =
    'kn-ar-int-svc-prsnl-plans-prod.DEV_TELECOM_GOLD.NPS_mensual';

const FECHA_DESDE = '2026-09-01';
const FECHA_HASTA = '2026-10-01';

const LOTE = 500;

const FILTROS_PLIEGO = [
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

const QUERY = `
    SELECT
        LEGAJO,
        LIDER,
        JEFE,
        EMP_EMPLEADO,
        EMPLEADO_ID,
        FILTRO_PLIEGO,
        CANAL,
        MES,
        FECHA_MES,
        TOTAL_ENCUESTADOS,
        TOTAL_PROMOTORES,
        TOTAL_NEUTROS,
        TOTAL_DETRACTORES,
        TOTAL_CON_RESOLUCION,
        TOTAL_RESOLVIO,
        NPS_SCORE,
        TASA_RESOLUCION_PCT
    FROM \`${TABLA_BIGQUERY}\`
    WHERE
        FECHA_MES >= DATE(@fechaDesde)
        AND FECHA_MES < DATE(@fechaHasta)
        AND FILTRO_PLIEGO IN UNNEST(@filtrosPliego)
`;

function normalizarFecha(valor) {
    if (valor == null) return null;

    if (valor instanceof Date) {
        return valor.toISOString().slice(0, 10);
    }

    if (typeof valor === 'object' && valor.value) {
        return String(valor.value).slice(0, 10);
    }

    return String(valor).slice(0, 10);
}

function mapearRegistro(row) {
    return {
        legajo: row.LEGAJO,
        lider: row.LIDER,
        jefe: row.JEFE,
        emp_empleado: row.EMP_EMPLEADO,
        empleado_id: row.EMPLEADO_ID,
        filtro_pliego: row.FILTRO_PLIEGO,
        canal: row.CANAL,
        mes: row.MES,
        fecha_mes: normalizarFecha(row.FECHA_MES),
        total_encuestados: row.TOTAL_ENCUESTADOS,
        total_promotores: row.TOTAL_PROMOTORES,
        total_neutros: row.TOTAL_NEUTROS,
        total_detractores: row.TOTAL_DETRACTORES,
        total_con_resolucion: row.TOTAL_CON_RESOLUCION,
        total_resolvio: row.TOTAL_RESOLVIO,
        nps_score: row.NPS_SCORE,
        tasa_resolucion_pct: row.TASA_RESOLUCION_PCT
    };
}

async function sincronizarNpsMensual() {
    console.log('Iniciando sincronización de NPS mensual...');

    // 1. Verificar que la tabla destino esté vacía.
    const { count, error: errorConteo } = await supabase
        .schema('metricas_telecom')
        .from('nps_mensual')
        .select('id', { count: 'exact', head: true });

    if (errorConteo) {
        throw errorConteo;
    }

    if (count > 0) {
        throw new Error(
            `La tabla metricas_telecom.nps_mensual ya contiene ${count} registros. Se cancela la importación.`
        );
    }

    // 2. Consultar BigQuery.
    console.log('Consultando BigQuery...');

    const [rows] = await bigquery.query({
        query: QUERY,
        params: {
            fechaDesde: FECHA_DESDE,
            fechaHasta: FECHA_HASTA,
            filtrosPliego: FILTROS_PLIEGO
        },
        location: 'southamerica-east1'
    });

    console.log(`Registros recibidos de BigQuery: ${rows.length}`);

    // 3. Mapear registros.
    const registros = rows.map(mapearRegistro);

    // 4. Insertar en lotes de 500.
    let registrosInsertados = 0;

    for (let i = 0; i < registros.length; i += LOTE) {
        const lote = registros.slice(i, i + LOTE);

        const { error } = await supabase
            .schema('metricas_telecom')
            .from('nps_mensual')
            .insert(lote);

        if (error) {
            throw new Error(
                `Error insertando lote desde posición ${i}: ${error.message}. Insertados previamente: ${registrosInsertados}`
            );
        }

        registrosInsertados += lote.length;

        console.log(
            `Insertados ${registrosInsertados} / ${registros.length}`
        );
    }

    console.log('Sincronización de NPS mensual completada.');

    return {
        success: true,
        registrosConsultados: rows.length,
        registrosInsertados,
        fechaDesde: FECHA_DESDE,
        fechaHasta: FECHA_HASTA,
        filtrosAplicados: FILTROS_PLIEGO
    };
}

module.exports = { sincronizarNpsMensual };
