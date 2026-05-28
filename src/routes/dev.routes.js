const express = require('express');
const router = express.Router();
const { supabase } = require('../config/database');

const RPC_PERMITIDAS = ['generar_fin_de_semana', 'set_historicofindesemana'];

router.post('/dev/ejecutar-rpc', async (req, res) => {
  const { rpcName } = req.body;

  if (!rpcName) {
    return res.status(400).json({ error: 'Se requiere el nombre de la función RPC' });
  }

  if (!RPC_PERMITIDAS.includes(rpcName)) {
    return res.status(403).json({ error: 'Función RPC no autorizada' });
  }

  try {
    const { data, error } = await supabase.rpc(rpcName);

    if (error) {
      console.error(`Error ejecutando RPC ${rpcName}:`, error);
      return res.status(500).json({ error: error.message });
    }

    console.log(`RPC ${rpcName} ejecutada exitosamente`);
    return res.json({ success: true, data });
  } catch (error) {
    console.error(`Error en endpoint dev/ejecutar-rpc:`, error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
