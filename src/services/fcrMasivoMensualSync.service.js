
const { bigquery } = require('../config/bigquery');
const { supabase } = require('../config/database');

const TABLA_BIGQUERY =
    'kn-ar-int-svc-prsnl-plans-prod.DEV_TELECOM_GOLD.FCR_MASIVO_mensual';

const TABLA_SUPABASE = 'fcr_masivo_mensual';

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

const LOTE = 500;

function normalizarFecha(fecha) {
    if (fecha == null) return null;

    // BigQuery puede devolver DATE como objeto con propiedad value.
    if (typeof fecha === 'object' && fecha.value) {
        return fecha.value;
    }

    if (fecha instanceof Date) {
        return fecha.toISOString().slice(0, 10);
    }

    return String(fecha).slice(0, 10);
}

async function sincronizarFcrMasivoMensual({
    fechaDesde = '2026-09-01',
    fechaHasta = '2026-09-30',
} = {}) {
    console.log('Iniciando sincronización FCR Masivo mensual...');

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
            MES,
            FILTRO_PLIEGO,
            FECHA_MES,
            LEGAJO,
            LIDER,
            JEFE,
            FCRM_ATENDIDOS,
            FCRM_RECONTACTOS,
            FCRM_PCT,
            EMP_EMPLEADO
        FROM \`${TABLA_BIGQUERY}\`
        WHERE FECHA_MES >= DATE(@fechaDesde)
          AND FECHA_MES < DATE(@fechaHasta)
          AND FILTRO_PLIEGO IN UNNEST(@filtrosPliego)
    `;

    const [filas] = await bigquery.query({
        query: consulta,
        location: 'southamerica-east1',
        params: {
            fechaDesde,
            fechaHasta,
            filtrosPliego: FILTROS_PLIEGO_PERMITIDOS
        }
    });

    console.log(`BigQuery devolvió ${filas.length} registros.`);

    if (filas.length === 0) {
        return {
            success: true,
            registrosConsultados: 0,
            registrosInsertados: 0,
            mensaje: 'No se encontraron registros para importar.'
        };
    }

    // 3. Adaptar los nombres de columnas al esquema de Supabase.
    const registros = filas.map(fila => ({
        mes: fila.MES ?? null,
        filtro_pliego: fila.FILTRO_PLIEGO ?? null,
        fecha_mes: normalizarFecha(fila.FECHA_MES),
        legajo: fila.LEGAJO ?? null,
        lider: fila.LIDER ?? null,
        jefe: fila.JEFE ?? null,
        fcrm_atendidos: fila.FCRM_ATENDIDOS ?? null,
        fcrm_recontactos: fila.FCRM_RECONTACTOS ?? null,
        fcrm_pct: fila.FCRM_PCT ?? null,
        emp_empleado: fila.EMP_EMPLEADO ?? null
    }));

    // 4. Insertar en Supabase por lotes.
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
                error.message
            );
        }

        registrosInsertados += loteActual.length;

        console.log(
            `Insertados ${registrosInsertados} de ${registros.length} registros.`
        );
    }

    console.log('Sincronización FCR Masivo mensual finalizada.');

    return {
        success: true,
        registrosConsultados: filas.length,
        registrosInsertados,
        fechaDesde,
        fechaHasta,
        filtrosAplicados: FILTROS_PLIEGO_PERMITIDOS
    };
}

module.exports = {
    sincronizarFcrMasivoMensual
};
