const { supabase } = require('../config/database');

async function registerFuncionesExtra(router) {
  router.get('/get_acceso_especial', async (req, res) => {
    try {
      const mail_lider = req.query.mail;
      const { data, error } = await supabase.rpc('get_acceso_especial', { user_mail: mail_lider });
      if (error) {
        console.error('Error en get_acceso_especial:', error);
        return res.status(500).json({ error: error.message });
      }
      res.json(data);
    } catch (err) {
      console.error('Excepción en get_acceso_especial:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerFuncionesExtra };
