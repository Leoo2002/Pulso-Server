
const { bigquery } = require('../config/bigquery');
const { supabase } = require('../config/database');

const TABLA_BIGQUERY =
    'kn-ar-int-svc-prsnl-plans-prod.DEV_TELECOM_GOLD.NPS';

const TABLA_SUPABASE = 'nps';

const FECHA_DESDE = '2026-09-01';
const FECHA_HASTA = '2026-09-30';

const REGISTROS_ESPERADOS = 4963;
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

async function sincronizarNps() {
    console.log('Iniciando sincronización NPS...');

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
            Legajo,
            ENCUESTA,
            TABULACION1,
            TABULACION2,
            TABULACION3,
            TABULACION4,
            CANAL,
            FILTRO_PLIEGO,
            COLUMNA_TOTAL,
            COLUMNA_PROM,
            COLUMNA_NEUT,
            COLUMNA_DET,
            RESO_ENC,
            RESOL_NUM,
            ES_CIERRE
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

    // 3. Validar la cantidad antes de insertar.
    if (filas.length !== REGISTROS_ESPERADOS) {
        throw new Error(
            `La cantidad de registros no coincide. ` +
            `Esperados: ${REGISTROS_ESPERADOS}. ` +
            `Recibidos: ${filas.length}. No se insertó ningún registro.`
        );
    }

    // 4. Adaptar las columnas al esquema de Supabase.
    const registros = filas.map(fila => ({
        fecha: normalizarFecha(fila.FECHA),
        mes: fila.MES ?? null,
        semana: fila.SEMANA ?? null,
        legajo: fila.Legajo ?? null,
        encuesta: fila.ENCUESTA ?? null,

        tabulacion1: fila.TABULACION1 ?? null,
        tabulacion2: fila.TABULACION2 ?? null,
        tabulacion3: fila.TABULACION3 ?? null,
        tabulacion4: fila.TABULACION4 ?? null,

        canal: fila.CANAL ?? null,
        filtro_pliego: fila.FILTRO_PLIEGO ?? null,

        columna_total: fila.COLUMNA_TOTAL ?? null,
        columna_prom: fila.COLUMNA_PROM ?? null,
        columna_neut: fila.COLUMNA_NEUT ?? null,
        columna_det: fila.COLUMNA_DET ?? null,

        reso_enc: fila.RESO_ENC ?? null,
        resol_num: fila.RESOL_NUM ?? null,

        es_cierre: fila.ES_CIERRE ?? null
    }));

    // 5. Insertar en Supabase por lotes.
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
                `${error.message}. ` +
                `Se habían insertado ${registrosInsertados} registros.`
            );
        }

        registrosInsertados += loteActual.length;

        console.log(
            `Insertados ${registrosInsertados} de ${registros.length} registros.`
        );
    }

    console.log('Sincronización NPS finalizada.');

    return {
        success: true,
        registrosConsultados: filas.length,
        registrosInsertados,
        fechaDesde: FECHA_DESDE,
        fechaHasta: FECHA_HASTA,
        filtrosAplicados: FILTROS_PLIEGO_PERMITIDOS
    };
}

module.exports = {
    sincronizarNps
};
