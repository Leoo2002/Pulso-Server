# Estructura del Proyecto - Servidor

## 📁 Estructura de Carpetas

```
servidor/
├── src/
│   ├── config/           # Configuración de servicios externos
│   │   ├── database.js   # Configuración de Supabase
│   │   ├── cors.js       # Configuración de CORS
│   │   └── google-auth.js # Configuración de Google OAuth
│   │
│   ├── constants/        # Constantes de la aplicación
│   │   ├── excel-columns.js  # Columnas de archivos Excel
│   │   └── permissions.js    # Permisos y accesos por vista
│   │
│   ├── middlewares/      # Middlewares de Express
│   │   ├── auth.js       # Middleware de autenticación por rol
│   │   └── jwt-validation.js # Middleware de validación de JWT global
│   │
│   ├── routes/           # Definición de rutas
│   │   ├── auth.routes.js         # Rutas de autenticación
│   │   ├── agentes.routes.js      # Rutas de gestión de agentes
│   │   ├── cambios.routes.js      # Rutas de cambios de franco y horario
│   │   ├── programacion.routes.js # Rutas de programación y guardias
│   │   ├── nomina.routes.js       # Rutas de gestión de nómina
│   │   ├── metricas.routes.js     # Rutas de métricas y productividad
│   │   └── pdf.routes.js          # Rutas de generación de PDFs
│   │
│   ├── services/         # Lógica de negocio
│   │   ├── auth.service.js    # Servicio de autenticación
│   │   ├── pdf.service.js     # Servicio de generación de PDFs
│   │   └── historico-guardia.service.js # Servicio de histórico de guardias
│   │
│   └── utils/            # Funciones auxiliares
│       └── excel-helpers.js   # Helpers para procesamiento de Excel
│
├── server.js             # Archivo principal del servidor
├── package.json          # Dependencias del proyecto
└── .env                  # Variables de entorno
```

## 🔧 Módulos Principales

### Config
Contiene la configuración de servicios externos:
- **database.js**: Cliente de Supabase
- **cors.js**: Configuración de CORS
- **google-auth.js**: Cliente de Google OAuth

### Constants
Define las constantes utilizadas en la aplicación:
- **excel-columns.js**: Mapeo de columnas de archivos Excel
- **permissions.js**: Definición de permisos por vista y accesos especiales

### Middlewares
- **auth.js**: Valida que el usuario tenga los permisos necesarios para acceder a una ruta
- **jwt-validation.js**: Valida el token JWT en todas las rutas protegidas

### Routes
Organiza las rutas por funcionalidad:
- **auth.routes.js**: Login, logout, validación de acceso
- **agentes.routes.js**: Gestión de agentes, líderes, francos
- **cambios.routes.js**: Cambios de franco y horario
- **programacion.routes.js**: Carga y consulta de programaciones
- **nomina.routes.js**: Gestión de nómina
- **metricas.routes.js**: Métricas y productividad
- **pdf.routes.js**: Generación de reportes en PDF

### Services
Contiene la lógica de negocio:
- **auth.service.js**: Verificación de tokens de Google
- **pdf.service.js**: Generación de PDFs de registro de guardia
- **historico-guardia.service.js**: Gestión de histórico de guardias

### Utils
Funciones auxiliares reutilizables:
- **excel-helpers.js**: Funciones para procesar archivos Excel

## 🚀 Cómo Usar

### Instalación
```bash
npm install
```

### Desarrollo
```bash
npm run dev
```

### Producción
```bash
npm start
```

## 📝 Notas

- Todos los módulos utilizan `require()` para mantener compatibilidad con CommonJS
- Las rutas están organizadas por funcionalidad para facilitar el mantenimiento
- Los servicios encapsulan la lógica de negocio separada de las rutas
- La configuración está centralizada en la carpeta `config/`
