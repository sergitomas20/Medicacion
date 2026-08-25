# Mi Pauta

PWA móvil centrada exclusivamente en el seguimiento de **lorazepam + pregabalina**.

## Qué hace

- El plan no empieza hasta pulsar **Iniciar**.
- Calcula el escalón actual y el próximo cambio cada 5 días.
- Permite registrar cada toma real de lorazepam y pregabalina con hora y nota.
- Compara lorazepam real vs. pautado y marca los días en objetivo, por encima o por debajo.
- Incluye estadísticas de 7/14 días y recuento de cantidad extra sobre la pauta.
- Incluye un **índice orientativo de tolerancia 0–100** con animación y tendencia.

## Modelo orientativo de tolerancia

No existe una ecuación clínica validada capaz de medir la tolerancia real individual a benzodiacepinas solo con un historial de dosis. La app usa por tanto un modelo heurístico de **exposición adaptativa**, pensado para visualizar tendencias y motivar la reducción, no para decidir dosis.

El modelo mantiene dos estados exponenciales de adaptación:

- componente rápida: semivida adaptativa de 3,5 días;
- componente lenta: semivida adaptativa de 21 días;
- pesos: 42% rápida + 58% lenta;
- cada toma registrada aumenta ambos estados y, entre tomas, decaen exponencialmente;
- la exposición combinada se transforma a 0–100 mediante una curva de Hill (n=1,45; EC50 heurística=2,2).

El punto de partida está sembrado en 6 mg/día como estimación de exposición reciente alta y puede cambiarse en Ajustes. A medida que se acumulan registros propios, ese punto de partida pierde peso.

Referencias conceptuales:

- Vinkers CH, Olivier B. *Mechanisms Underlying Tolerance after Long-Term Benzodiazepine Use* (2012): https://pmc.ncbi.nlm.nih.gov/articles/PMC3321276/
- *Synaptic correlates of benzodiazepine tolerance* (2026): https://pmc.ncbi.nlm.nih.gov/articles/PMC13269140/
- DailyMed, lorazepam: https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=eb068a0f-5c0e-4218-b4c5-a0d0b1d362bd

**El índice no es una medición biológica y no se utiliza para calcular cuántos comprimidos producirían un efecto determinado.**

## Persistencia de datos

Cada cambio se guarda en paralelo en:

1. `localStorage`;
2. `IndexedDB`.

Esto protege frente a recargas, actualizaciones de la PWA y fallos de uno de los dos almacenes. Si se borran todos los datos de Safari/iOS, ambos pueden desaparecer. Por eso la app permite **exportar una copia JSON a Archivos/iCloud** y restaurarla después.

Una GitHub Page estática no puede escribir de vuelta al repositorio de forma segura sin incluir credenciales de GitHub en el cliente, por lo que la app no incrusta tokens ni contraseñas.

## Instalación en iPhone

Safari → Compartir → Añadir a pantalla de inicio.
