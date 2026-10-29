// Configuración de CORS del servidor
const corsOptions = {
  origin: [
    process.env.FRONTEND_URL,
    'https://pulso-arg.netlify.app',
    'http://localhost:4200',
    'http://localhost:3000'
  ],  
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

module.exports = corsOptions;
