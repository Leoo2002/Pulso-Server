// Rutas para generación de PDFs
const express = require('express');
const router = express.Router();
const generarPDF = require('../services/pdf.service');

// Generar PDF de registro de guardia
router.post("/pdf", async (req, res) => {
  try {
    const datos = req.body;
    console.log('Generando PDF con:', {
      tarde: datos.agentesTarde?.length,
      demora: datos.agentesDemora?.length,
      ausente: datos.agentesAusente?.length
    });

    const pdfBuffer = await generarPDF(datos);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=registro-guardia.pdf");
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error al generar PDF:", error);
    res.status(500).json({ error: "Error al generar PDF: " + error.message });
  }
});

module.exports = router;
