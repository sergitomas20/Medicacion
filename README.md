# Mi Pauta

PWA móvil centrada exclusivamente en el seguimiento de **lorazepam + pregabalina**.

## Qué hace

- El plan no empieza hasta pulsar **Iniciar**.
- Calcula el escalón actual y el próximo cambio cada 5 días.
- Permite registrar cada toma real de lorazepam y pregabalina con hora y nota.
- Compara lorazepam real vs. pautado y marca los días en objetivo, por encima o por debajo.
- Incluye estadísticas de 7/14 días y recuento de cantidad extra sobre la pauta.
- Incluye un **índice orientativo de tolerancia 0–100** con animación y tendencia.

## Modelo orientativo de tolerancia v2.2

No existe una ecuación clínica validada que mida la tolerancia individual a benzodiacepinas solo desde un historial de dosis. La app usa un modelo **farmacocinético + adaptativo** para visualizar tendencia, no para decidir dosis.

### Capa farmacocinética

Cada toma real se integra según su hora usando:

- biodisponibilidad oral aproximada: 90 %;
- Tmax objetivo: ~2 h;
- semivida de eliminación: ~12 h;
- absorción de primer orden (`ka` derivada de Tmax y `ke`);
- compartimento de efecto con semivida de equilibrado ~0,43 h;
- integración temporal cada 15 minutos.

Esto hace que la app ya no trate igual una cantidad tomada de golpe que la misma cantidad repartida: primero reconstruye una curva relativa de exposición plasmática y de exposición CNS.

### Capa adaptativa

La exposición del compartimento de efecto se transforma de forma sigmoide y alimenta dos memorias:

- componente rápida: semivida adaptativa heurística de 3,5 días;
- componente lenta: semivida adaptativa heurística de 21 días;
- pesos: 42 % rápida + 58 % lenta.

El punto de partida se reconstruye con 90 días virtuales usando la media previa configurada, repartida en tres tomas al día. Con 6 mg/día el modelo queda aproximadamente alrededor de 81/100. Después del inicio, las horas y cantidades registradas van sustituyendo esa historia previa.

Los parámetros farmacocinéticos están anclados a datos publicados. Las velocidades de neuroadaptación siguen siendo **heurísticas**, porque la tolerancia a benzodiacepinas es heterogénea y no existe un modelo humano validado que convierta el consumo individual en un porcentaje biológico exacto.

Referencias conceptuales:

- DailyMed, lorazepam: biodisponibilidad ~90 %, Tmax ~2 h y semivida plasmática media ~12 h: https://dailymed.nlm.nih.gov/
- Mandema et al., modelo PK/PD de lorazepam con compartimento de efecto: https://pubmed.ncbi.nlm.nih.gov/2348383/
- Blin et al., análisis PK/PD oral de lorazepam: https://pubmed.ncbi.nlm.nih.gov/11307041/
- Vinkers & Olivier, mecanismos de tolerancia a benzodiacepinas: https://pmc.ncbi.nlm.nih.gov/articles/PMC3321276/
- *Synaptic correlates of benzodiazepine tolerance* (2026): https://pmc.ncbi.nlm.nih.gov/articles/PMC13269140/

**El índice no es una medición biológica y no se utiliza para calcular cuántos comprimidos producirían un efecto determinado.**

## Persistencia de datos

Cada cambio se guarda en paralelo en:

1. `localStorage`;
2. `IndexedDB`.

Esto protege frente a recargas, actualizaciones de la PWA y fallos de uno de los dos almacenes. Si se borran todos los datos de Safari/iOS, ambos pueden desaparecer. Por eso la app permite **exportar una copia JSON a Archivos/iCloud** y restaurarla después.

Una GitHub Page estática no puede escribir de vuelta al repositorio de forma segura sin incluir credenciales de GitHub en el cliente, por lo que la app no incrusta tokens ni contraseñas.

## Instalación en iPhone

Safari → Compartir → Añadir a pantalla de inicio.
