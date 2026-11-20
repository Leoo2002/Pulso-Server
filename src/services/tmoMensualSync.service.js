
const { bigquery } = require('../config/bigquery');
const { supabase } = require('../config/database');

const TABLA_BIGQUERY =
    'kn-ar-int-svc-prsnl-plans-prod.DEV_TELECOM_GOLD.TMO_mensual';

const FECHA_DESDE = '2026-09-01';
const FECHA_HASTA = '2026-09-30';

const REGISTROS_ESPERADOS = 840;
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

const QUERY = `
    SELECT
        LEGAJO,
        LIDER,
        JEFE,
        FILTRO_PLIEGO,
        mes,
        FECHA_MES,
        TOTAL_ATENDIDAS,
        TOTAL_SALIENTES,
        TOTAL_ACD_IN_SEG,
        TOTAL_HOLD_SEG,
        TOTAL_ACW_SEG,
        TOTAL_TALK_SALIENTE_SEG,
        TMO_SEG
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
        return valor.value.slice(0, 10);
    }

    return String(valor).slice(0, 10);
}

function mapearRegistro(row) {
    return {
        legajo: row.LEGAJO,
        lider: row.LIDER,
        jefe: row.JEFE,
        filtro_pliego: row.FILTRO_PLIEGO,
        mes: row.mes,
        fecha_mes: normalizarFecha(row.FECHA_MES),
        total_atendidas: row.TOTAL_ATENDIDAS,
        total_salientes: row.TOTAL_SALIENTES,
        total_acd_in_seg: row.TOTAL_ACD_IN_SEG,
        total_hold_seg: row.TOTAL_HOLD_SEG,
        total_acw_seg: row.TOTAL_ACW_SEG,
        total_talk_saliente_seg: row.TOTAL_TALK_SALIENTE_SEG,
        tmo_seg: row.TMO_SEG
    };
}

async function sincronizarTmoMensual() {
    console.log('Iniciando sincronización de TMO mensual...');

    // 1. Verificar que la tabla destino esté vacía.
    const { count, error: errorConteo } = await supabase
        .schema('metricas_telecom')
        .from('tmo_mensual')
        .select('id', { count: 'exact', head: true });

    if (errorConteo) {
        throw errorConteo;
    }

    if (count > 0) {
        throw new Error(
            `La tabla metricas_telecom.tmo_mensual ya contiene ${count} registros. Se cancela la importación.`
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

    console.log(`Registros consultados: ${rows.length}`);

    // 3. Validar la cantidad esperada.
    if (rows.length !== REGISTROS_ESPERADOS) {
        throw new Error(
            `Cantidad inesperada: se esperaban ${REGISTROS_ESPERADOS} registros y llegaron ${rows.length}. No se insertará nada.`
        );
    }

    // 4. Mapear registros.
    const registros = rows.map(mapearRegistro);

    // 5. Insertar en lotes.
    let registrosInsertados = 0;

    for (let i = 0; i < registros.length; i += LOTE) {
        const lote = registros.slice(i, i + LOTE);

        const { error } = await supabase
            .schema('metricas_telecom')
            .from('tmo_mensual')
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

    console.log('Sincronización de TMO mensual completada.');

    return {
        success: true,
        registrosConsultados: rows.length,
        registrosInsertados,
        fechaDesde: FECHA_DESDE,
        fechaHasta: FECHA_HASTA,
        filtrosAplicados: FILTROS_PLIEGO
    };
}

module.exports = { sincronizarTmoMensual };
