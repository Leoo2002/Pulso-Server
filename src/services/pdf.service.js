// Servicio para generar PDFs de registro de guardia
const PDFDocument = require('pdfkit');

const generarPDF = (datos) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40, size: 'A4' });

            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // Colores del tema
            const colorPrimario = '#3e0b91';
            const colorTarde = '#ffc107';
            const colorDemora = '#0d6efd';
            const colorAusente = '#dc3545';
            const colorMalCargado = '#198754'; 
            const marcaAguaColor = '#5602b9';

            let y = 50;

            // Aplica marca de agua en cada página
            const aplicarMarcaAgua = () => {
                // Marca de agua central (diagonal)
                doc.save();
                doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
                doc.fontSize(100).fillColor(marcaAguaColor).opacity(0.07);
                
                const textoMarcaAgua = 'PULSO';
                const anchoTextoMarcaAgua = doc.widthOfString(textoMarcaAgua);
                const altoTextoMarcaAgua = doc.currentLineHeight();
                
                doc.text(textoMarcaAgua, 
                    (doc.page.width / 2) - (anchoTextoMarcaAgua / 2), 
                    (doc.page.height / 2) - (altoTextoMarcaAgua / 2), {
                    lineBreak: false,
                });
                doc.restore();

                // Pie de página
                doc.save();
                doc.fontSize(12).fillColor(marcaAguaColor).opacity(1);
                
                const textoPiePagina = 'PULSO';
                const anchoTextoPie = doc.widthOfString(textoPiePagina);
                
                doc.text(textoPiePagina, 
                    (doc.page.width / 2) - (anchoTextoPie / 2), 
                    doc.page.height - 25, {
                    lineBreak: false,
                });
                doc.restore();

                doc.opacity(1);
            };

            // Información general del reporte
            const marginLeft = 15;
            doc.fontSize(22).fillColor(colorPrimario).font('Helvetica-Bold')
                .text('Información General', marginLeft, y);

            y = doc.y + 8;
            doc.strokeColor(colorPrimario).lineWidth(2).moveTo(marginLeft, y).lineTo(545, y).stroke();
            y += 25;

            // Datos del encabezado
            doc.font('Helvetica').fontSize(12).fillColor('#333');
            const lineHeight = 20;
            const formatearFecha = (fechaStr) => {
                if (!fechaStr) return '-';
                const [year, month, day] = fechaStr.split('-');
                return `${day}-${month}-${year}`;
            };
            doc.text(`Líder: ${datos.lider || '-'}`, marginLeft, y); y += lineHeight;
            doc.text(`Fecha: ${formatearFecha(datos.fecha)}`, marginLeft, y); y += lineHeight;
            doc.text(`Horario de ingreso: ${datos.horario || '-'}`, marginLeft, y); y += lineHeight;
            doc.text(`Desde: ${datos.desde || '-'}`, marginLeft, y);
            doc.text(`Hasta: ${datos.hasta || '-'}`, marginLeft + 90, y);
            y += 40;

            // Función para crear tablas de agentes
            const crearTabla = (titulo, color, agentes, columnaExtra) => {
                if (!agentes || agentes.length === 0) return y;

                const headers = ['Segmento', 'Nombre', 'DNI', 'Líder', columnaExtra.label, 'Observaciones'];
                const widths = [90, 130, 80, 110, 70, 90];
                const headerHeight = 25;
                const tituloHeight = 40;
                const bloqueInicial = tituloHeight + headerHeight;

                if (y + bloqueInicial > 740) {
                    aplicarMarcaAgua();
                    doc.addPage();
                    y = 50;
                }

                doc.fontSize(16).fillColor(color).font('Helvetica-Bold').text(titulo, marginLeft, y);
                y = doc.y + 5;
                doc.strokeColor(color).lineWidth(2).moveTo(marginLeft, y).lineTo(545, y).stroke();
                y += 15;

                let x = marginLeft;
                headers.forEach((h, i) => {
                    doc.rect(x, y, widths[i], headerHeight).fill(color).stroke();
                    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10)
                        .text(h, x + 4, y + 7, { width: widths[i] - 8, align: 'left' });
                    x += widths[i];
                });
                y += headerHeight;

                agentes.forEach((agente, idx) => {
                    let x = marginLeft;

                    const valores = [
                        agente.segmento || '-',
                        agente.nombre || '-',
                        agente.dni_agente?.toString() || '-',
                        agente.lider || '-',
                        columnaExtra.property === 'ausenteAviso'
                            ? (agente.aviso_ausente ? 'Con aviso' : 'Sin aviso')
                            : columnaExtra.property === 'horario'
                                ? (agente.hora_logueo || agente.ingreso || '-')
                                : (agente[columnaExtra.property] || '-'),
                        agente.obs_guardia || '-'
                    ];

                    const cellHeights = valores.map((val, i) =>
                        doc.heightOfString(val.toString(), { width: widths[i] - 4, align: 'left' }) + 8
                    );
                    const rowHeight = Math.max(...cellHeights);

                    if (y + rowHeight > 740) {
                        aplicarMarcaAgua();
                        doc.addPage();
                        y = 50;
                    }

                    valores.forEach((val, i) => {
                        doc.rect(x, y, widths[i], rowHeight)
                            .fill(idx % 2 === 0 ? '#f2f2f2' : '#ffffff')
                            .stroke();

                        doc.fillColor('#000').font('Helvetica').fontSize(9)
                            .text(val.toString(), x + 2, y + 4, {
                                width: widths[i] - 4,
                                align: 'left'
                            });

                        x += widths[i];
                    });

                    y += rowHeight;
                });

                y += 40;
                return y;
            };

            // Generar tablas por categoría
            if (datos.agentesTarde?.length) {
                y = crearTabla('Llegadas Tarde', colorTarde, datos.agentesTarde,
                    { label: 'Horario', property: 'horario' });
            }

            if (datos.agentesDemora?.length) {
                y = crearTabla('Demoras en Logueo', colorDemora, datos.agentesDemora, {
                    label: 'Horario',
                    property: 'horario'
                });
            }

            if (datos.agentesAusente?.length) {
                y = crearTabla('Ausentes', colorAusente, datos.agentesAusente,
                    { label: 'Aviso', property: 'ausenteAviso' });
            }

            if (datos.agentesMalCargado?.length) {
                y = crearTabla('Agentes Mal Cargados', colorMalCargado, datos.agentesMalCargado,
                    { label: 'Horario', property: 'horario' });
            }

            // Observaciones adicionales
            const tieneADH = datos.ADH && datos.ADH !== '-' && datos.ADH.trim() !== '';
            const tieneObs = datos.Obs && datos.Obs !== '-' && datos.Obs.trim() !== '';
            
            const espacioNecesario = 80;
            if (y + espacioNecesario > 740) {
                aplicarMarcaAgua();
                doc.addPage();
                y = 50;
            }

            doc.fontSize(16).fillColor(colorPrimario).font('Helvetica-Bold')
                .text('Observaciones Adicionales', marginLeft, y);

            y = doc.y + 5;
            doc.strokeColor(colorPrimario).lineWidth(2).moveTo(marginLeft, y).lineTo(545, y).stroke();
            y += 20;

            if (tieneADH) {
                if (datos.ADH === 'under') {
                    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ff0000');
                } else if (datos.ADH === 'ok') {
                    doc.font('Helvetica-Bold').fontSize(12).fillColor('#00cc00');
                } else {
                    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0000ff');
                }
                doc.text(`Adhesión: ${datos.ADH}`, marginLeft, y);
                y += 20;
            } else {
                doc.font('Helvetica').fontSize(12).fillColor('#666');
                doc.text('Adhesión: Sin información', marginLeft, y);
                y += 20;
            }

            if (tieneObs) {
                doc.font('Helvetica').fontSize(12).fillColor('#333');
                doc.text(`Observación: ${datos.Obs}`, marginLeft, y);
                y += 20;
            } else {
                doc.font('Helvetica').fontSize(12).fillColor('#666');
                doc.text('Observación: Sin información', marginLeft, y);
                y += 20;
            }

            y += 15;

            // Observaciones generales
            const tieneObsGeneral = datos.obsGeneral && datos.obsGeneral !== '-' && datos.obsGeneral.trim() !== '';
            const textoObsGeneral = tieneObsGeneral ? datos.obsGeneral : 'Sin información';
            
            const alturaTexto = doc.heightOfString(textoObsGeneral, {
                width: 500,
                align: 'left'
            });
            const espacioNecesarioGeneral = 60 + alturaTexto;
            
            if (y + espacioNecesarioGeneral > 740) {
                aplicarMarcaAgua();
                doc.addPage();
                y = 50;
            }

            doc.fontSize(16).fillColor(colorPrimario).font('Helvetica-Bold')
                .text('Observaciones Generales', marginLeft, y);

            y = doc.y + 5;
            doc.strokeColor(colorPrimario).lineWidth(2).moveTo(marginLeft, y).lineTo(545, y).stroke();
            y += 20;

            const colorTexto = tieneObsGeneral ? '#333' : '#666';
            doc.font('Helvetica').fontSize(12).fillColor(colorTexto);
            doc.text(textoObsGeneral, marginLeft, y, {
                width: 500,
                align: 'left'
            });

            aplicarMarcaAgua();
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

module.exports = generarPDF;
