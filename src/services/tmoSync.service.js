
const { bigquery } = require('../config/bigquery');
const { supabase } = require('../config/database');

const TABLA_BIGQUERY =
    'kn-ar-int-svc-prsnl-plans-prod.DEV_TELECOM_GOLD.TMO';

const FECHA_DESDE = '2026-09-01';
const FECHA_HASTA = '2026-09-30';

const REGISTROS_ESPERADOS = 310186;
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
        FECHA,
        MES_DATOS,
        FILTRO_PLIEGO,
        LEGAJO,
        AGENTE,
        LIDER,
        JEFE,
        ATENDIDAS,
        SALIENTES,
        ACD_IN,
        HOLD_AUX,
        ACW_IN,
        TALK_SALIENTE,
        TMO_SEG,
        EMPLEADO_ID
    FROM \`${TABLA_BIGQUERY}\`
    WHERE
        FECHA >= DATE(@fechaDesde)
        AND FECHA < DATE(@fechaHasta)
        AND FILTRO_PLIEGO IN UNNEST(@filtrosPliego)
`;

function normalizarFecha(valor) {
    if (valor == null) return null;

    if (typeof valor === 'string') {
        return valor.slice(0, 10);
    }

    if (valor.value) {
        return valor.value.slice(0, 10);
    }

    return String(valor).slice(0, 10);
}

function mapearRegistro(row) {
    return {
        fecha: normalizarFecha(row.FECHA),
        mes_datos: normalizarFecha(row.MES_DATOS),
        filtro_pliego: row.FILTRO_PLIEGO,
        legajo: row.LEGAJO,
        agente: row.AGENTE,
        lider: row.LIDER,
        jefe: row.JEFE,
        atendidas: row.ATENDIDAS,
        salientes: row.SALIENTES,
        acd_in: row.ACD_IN,
        hold_aux: row.HOLD_AUX,
        acw_in: row.ACW_IN,
        talk_saliente: row.TALK_SALIENTE,
        tmo_seg: row.TMO_SEG,
        empleado_id: row.EMPLEADO_ID
    };
}

async function sincronizarTmo() {
    console.log('Iniciando sincronización de TMO...');

    // 1. Verificar que la tabla destino esté vacía.
    const { count, error: errorConteo } = await supabase
        .schema('metricas_telecom')
        .from('tmo')
        .select('id', { count: 'exact', head: true });

    if (errorConteo) {
        throw errorConteo;
    }

    if (count > 0) {
        throw new Error(
            `La tabla metricas_telecom.tmo ya contiene ${count} registros. Se cancela la importación.`
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

    // 3. Validar cantidad esperada.
    if (rows.length !== REGISTROS_ESPERADOS) {
        throw new Error(
            `Cantidad inesperada: se esperaban ${REGISTROS_ESPERADOS} registros y llegaron ${rows.length}. No se insertará nada.`
        );
    }

    // 4. Mapear registros.
    const registros = rows.map(mapearRegistro);

    // 5. Insertar en lotes de 500.
    let registrosInsertados = 0;

    for (let i = 0; i < registros.length; i += LOTE) {
        const lote = registros.slice(i, i + LOTE);

        const { error } = await supabase
            .schema('metricas_telecom')
            .from('tmo')
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

    console.log('Sincronización de TMO completada.');

    return {
        success: true,
        registrosConsultados: rows.length,
        registrosInsertados,
        fechaDesde: FECHA_DESDE,
        fechaHasta: FECHA_HASTA,
        filtrosAplicados: FILTROS_PLIEGO
    };
}

async function getTMOData(app) {
  app.get('/api/TMOData', async (req, res) => {
    try {
      const { data, error } = await supabase.rpc('consultar_tmo', {
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
      console.error('Error al obtener los datos de TMO:', error);
      return res.status(500).json({ error: 'Error al obtener los datos de TMO' });
    }
  });
}

module.exports = {
  getTMOData
};
