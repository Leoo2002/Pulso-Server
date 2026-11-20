
const { bigquery } = require('../config/bigquery');
const { supabase } = require('../config/database');

const DATASET = 'DEV_TELECOM_GOLD';
const TABLA_ORIGEN = 'CxH_mensual';
const TABLA_DESTINO = 'cxh_mensual';
const ESQUEMA_DESTINO = 'metricas_telecom';

const LOCATION = 'southamerica-east1';


const COLAS_PERMITIDAS = [
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


function normalizarFecha(valor) {
    if (!valor) return null;
    return valor.value ?? valor;
}

function mapearRegistro(row) {
    return {
        legajo: row.LEGAJO ?? null,
        lider: row.LIDER ?? null,
        jefe: row.JEFE ?? null,
        sitio: row.SITIO ?? null,
        filtro_pliego: row.FILTRO_PLIEGO ?? null,
        cola_plana: row.COLA_PLANA ?? null,
        tipo_yoizen: row.TIPO_YOIZEN ?? null,
        mes: row.MES ?? null,
        fecha_mes: normalizarFecha(row.FECHA_MES),

        total_casos_cerrados: row.TOTAL_CASOS_CERRADOS ?? null,
        total_working_seg: row.TOTAL_WORKING_SEG ?? null,
        total_login_seg: row.TOTAL_LOGIN_SEG ?? null,
        total_tmnl_seg: row.TOTAL_TMNL_SEG ?? null,
        total_qcasos_online: row.TOTAL_QCASOS_ONLINE ?? null,
        total_transferidos: row.TOTAL_TRANSFERIDOS ?? null,
        total_descartados: row.TOTAL_DESCARTADOS ?? null,
        total_chats_finalizados: row.TOTAL_CHATS_FINALIZADOS ?? null,
        total_salientes: row.TOTAL_SALIENTES ?? null,
        total_casos_gestionados: row.TOTAL_CASOS_GESTIONADOS ?? null,

        gxh: row.GXH ?? null,
        casos_finalizados: row.CASOS_FINALIZADOS ?? null,
        cxh: row.CXH ?? null,
        pct_casos_cerrados: row.PCT_CASOS_CERRADOS ?? null,
        hs_total_working: row.HS_TOTAL_WORKING ?? null,
        tmo_caso_cerrado_seg: row.TMO_CASO_CERRADO_SEG ?? null,
        tmo_caso_gestionado_seg: row.TMO_CASO_GESTIONADO_SEG ?? null,
        tiempo_por_caso_seg: row.TIEMPO_POR_CASO_SEG ?? null,
        casos_por_hora: row.CASOS_POR_HORA ?? null
    };
}

async function sincronizarCxHMensual({
    fechaDesde = '2026-09-01',
    fechaHasta = '2026-09-30',
    batchSize = 500
} = {}) {
    console.log('Iniciando importación de CxH mensual...');
    console.log(`Período: ${fechaDesde} hasta ${fechaHasta}`);

    // 1. Verificar que la tabla destino esté vacía.
    const { count, error: errorConteo } = await supabase
        .schema(ESQUEMA_DESTINO)
        .from(TABLA_DESTINO)
        .select('id', { count: 'exact', head: true });

if (errorConteo) {
    console.error('Error completo de Supabase:', errorConteo);
    console.error('Detalles:', {
        message: errorConteo.message,
        code: errorConteo.code,
        details: errorConteo.details,
        hint: errorConteo.hint
    });

    throw new Error('Error consultando Supabase. Revisar detalles anteriores.');
}

    if (count > 0) {
        throw new Error(
            `La tabla destino ya contiene ${count} registros. ` +
            'Se cancela la importación para evitar duplicados.'
        );
    }

    // 2. Consultar BigQuery.
const query = `
    SELECT *
    FROM \`${DATASET}.${TABLA_ORIGEN}\`
    WHERE FECHA_MES >= DATE(@fechaDesde)
      AND FECHA_MES < DATE(@fechaHasta)
      AND COLA_PLANA IN UNNEST(@colas)
`;
    const [rows] = await bigquery.query({
        query,
params: {
    fechaDesde,
    fechaHasta,
    colas: COLAS_PERMITIDAS
},
        location: LOCATION
    });

    console.log(`Registros obtenidos de BigQuery: ${rows.length}`);

    if (rows.length === 0) {
        console.log('No hay registros para importar.');
        return { obtenidos: 0, insertados: 0 };
    }

    // 3. Mapear los registros.
    const registros = rows.map(mapearRegistro);

    // 4. Insertar en lotes.
    let insertados = 0;

    for (let i = 0; i < registros.length; i += batchSize) {
        const lote = registros.slice(i, i + batchSize);

        const { error } = await supabase
            .schema(ESQUEMA_DESTINO)
            .from(TABLA_DESTINO)
            .insert(lote);

        if (error) {
            throw new Error(
                `Error insertando lote desde el registro ${i + 1}: ${error.message}. ` +
                `Se habían insertado ${insertados} registros antes del error.`
            );
        }

        insertados += lote.length;

        console.log(
            `Insertados ${insertados} de ${registros.length} registros.`
        );
    }

    console.log('Importación finalizada correctamente.');

    return {
        obtenidos: rows.length,
        insertados
    };
}

module.exports = {
    sincronizarCxHMensual
};
