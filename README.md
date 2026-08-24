# Mi Pauta

PWA móvil para visualizar y registrar de forma sencilla una pauta prescrita de medicación.

## Enfoque
- Pantalla principal centrada en la toma actual.
- Cuenta atrás hasta el siguiente escalón de la pauta.
- Seguimiento local de tomas realizadas.
- Visualización del plan completo sin saturar la pantalla principal.
- Las fases futuras que no tienen distribución por toma confirmada se mantienen bloqueadas como “pendientes”: la app no inventa qué dosis corresponde por la mañana, mediodía o noche.
- La sertralina queda pendiente hasta resolver la discrepancia de 100/200 mg entre documentos.

## Privacidad
Los datos de seguimiento se guardan en `localStorage` del dispositivo. No hay backend ni envío de datos.

## Instalación en iPhone
Abrir la web en Safari → Compartir → Añadir a pantalla de inicio.
