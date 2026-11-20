
const { bigquery } = require('../config/bigquery');
const { supabase } = require('../config/database');

const DATASET = 'DEV_TELECOM_GOLD';
const TABLA_ORIGEN = 'CxH';

const TABLA_DESTINO = 'cxh';
const ESQUEMA_DESTINO = 'metricas_telecom';

const LOCATION = 'southamerica-east1';

const FILTROS_PLIEGO_PERMITIDOS = [
    'ONBOARDING - WHATSAPP',
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
        fecha_plana: normalizarFecha(row.FECHA_PLANA),
        mes: row.MES ?? null,
        cola_plana: row.COLA_PLANA ?? null,
        tipo_yoizen: row.TIPO_YOIZEN ?? null,
        filtro_pliego: row.FILTRO_PLIEGO ?? null,

        casos_cerrados_plana: row.CASOS_CERRADOS_PLANA ?? null,
        totalworking: row.TotalWorking ?? null,
        totallogin: row.TotalLogin ?? null,
        tmnl: row.Tmnl ?? null,
        qcasosonline: row.QCasosOnline ?? null,

        finalizados_plana: row.FINALIZADOS_PLANA ?? null,
        descartados_plana: row.DESCARTADOS_PLANA ?? null,
        salientes_plana: row.SALIENTES_PLANA ?? null,
        transferidos_plana: row.TRANSFERIDOS_PLANA ?? null,
        casos_gestionados_plana: row.CASOS_GESTIONADOS_PLANA ?? null,

        sitio: row.SITIO ?? null,
        legajo: row.LEGAJO ?? null,
        agente: row.AGENTE ?? null,
        lider: row.LIDER ?? null,
        jefe: row.JEFE ?? null,
        empleado_id: row.EMPLEADO_ID ?? null
    };
}

async function sincronizarCxH({
    fechaDesde = '2026-09-01',
    fechaHasta = '2026-09-30',
    batchSize = 500
} = {}) {

    console.log('======================================');
    console.log('Iniciando importación de CxH diaria');
    console.log('======================================');

    console.log(`Período: ${fechaDesde} hasta ${fechaHasta}`);
    console.log('Filtros de pliego:', FILTROS_PLIEGO_PERMITIDOS);

    // 1. Verificar que la tabla destino esté vacía.
    // Evita duplicar registros si se ejecuta nuevamente.

    const { count, error: errorConteo } = await supabase
        .schema(ESQUEMA_DESTINO)
        .from(TABLA_DESTINO)
        .select('id', { count: 'exact', head: true });

    if (errorConteo) {
        console.error('Error consultando Supabase:', errorConteo);
        throw new Error('No se pudo verificar la tabla destino.');
    }

    if (count > 0) {
        throw new Error(
            `La tabla destino ya contiene ${count} registros. ` +
            'Se cancela la importación para evitar duplicados.'
        );
    }

    // 2. Consultar BigQuery.

    const query = `
        SELECT
            FECHA_PLANA,
            MES,
            COLA_PLANA,
            TIPO_YOIZEN,
            FILTRO_PLIEGO,
            CASOS_CERRADOS_PLANA,
            TotalWorking,
            TotalLogin,
            Tmnl,
            QCasosOnline,
            FINALIZADOS_PLANA,
            DESCARTADOS_PLANA,
            SALIENTES_PLANA,
            TRANSFERIDOS_PLANA,
            CASOS_GESTIONADOS_PLANA,
            SITIO,
            LEGAJO,
            AGENTE,
            LIDER,
            JEFE,
            EMPLEADO_ID
        FROM \`${DATASET}.${TABLA_ORIGEN}\`
        WHERE FECHA_PLANA >= DATE(@fechaDesde)
          AND FECHA_PLANA < DATE(@fechaHasta)
          AND FILTRO_PLIEGO IN UNNEST(@filtrosPliego)
    `;

    console.log('Consultando registros en BigQuery...');

    const [rows] = await bigquery.query({
        query,
        params: {
            fechaDesde,
            fechaHasta,
            filtrosPliego: FILTROS_PLIEGO_PERMITIDOS
        },
        location: LOCATION
    });

    console.log(`Registros obtenidos de BigQuery: ${rows.length}`);

    if (rows.length === 0) {
        console.log('No hay registros para importar.');

        return {
            obtenidos: 0,
            insertados: 0
        };
    }

    // 3. Transformar los registros al formato de Supabase.

    const registros = rows.map(mapearRegistro);

    // 4. Insertar por lotes.

    let insertados = 0;

    for (let i = 0; i < registros.length; i += batchSize) {
        const lote = registros.slice(i, i + batchSize);

        const { error } = await supabase
            .schema(ESQUEMA_DESTINO)
            .from(TABLA_DESTINO)
            .insert(lote);

        if (error) {
            console.error('Error insertando lote:', error);

            throw new Error(
                `Error insertando lote desde el registro ${i + 1}. ` +
                `Se habían insertado ${insertados} registros antes del error. ` +
                `Detalle: ${error.message}`
            );
        }

        insertados += lote.length;

        console.log(
            `Insertados ${insertados} de ${registros.length} registros.`
        );
    }

    console.log('======================================');
    console.log('Importación finalizada correctamente');
    console.log(`Obtenidos: ${rows.length}`);
    console.log(`Insertados: ${insertados}`);
    console.log('======================================');

    return {
        obtenidos: rows.length,
        insertados
    };
}


async function getCxHData(app) {
  app.get('/api/chxData', async (req, res) => {
    try {
      const { data, error } = await supabase.rpc('consultar_cxh', {
    servicio: 'ONBOARDING',
    fecha_desde: '2026-09-01',
    fecha_hasta: '2026-09-30',
    filtro_empleado_id: null,
    filtro_legajo: '',
    filtro_lider :'BANNON GORMAZ IVO SANTINO',
    filtro_canal: null
      });

      if (error) {
        console.error(error);
        return res.status(400).json({ error: error.message });
      }

      console.log(data);
      return res.json(data);
    } catch (error) {
      console.error('Error al obtener los datos de CxH:', error);
      return res.status(500).json({ error: 'Error al obtener los datos de CxH' });
    }
  });
}

module.exports = {
  getCxHData,
  sincronizarCxH
};
