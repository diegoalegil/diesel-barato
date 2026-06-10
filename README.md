# Diésel Barato · Tenerife 🌋

App web (PWA) que muestra **el diésel más barato de Tenerife ahora mismo**, con los precios oficiales que las estaciones comunican al Ministerio para la Transición Ecológica.

**▶︎ Úsala aquí: https://diegoalegil.github.io/diesel-barato/**

## Instalar en iPhone

1. Abre la URL en **Safari**.
2. Toca el botón de **Compartir** → **Añadir a pantalla de inicio**.
3. Listo: se abre a pantalla completa como una app más, con su icono.

## Qué hace

- Precios de **Diésel, Diésel Premium, Gasolina 95 y 98** en toda la isla, actualizados varias veces al día.
- Ordena por **más baratas** o **más cercanas** (con tu permiso de ubicación).
- **Mapa** con todas las gasolineras coloreadas de barata (verde) a cara (rojo).
- Ficha de cada estación con horario, estado (abierto/cerrado) y botones de **Apple Maps / Google Maps** para llegar.
- Funciona **sin conexión** con los últimos precios guardados.

## Datos

API pública del [Geoportal de Gasolineras](https://geoportalgasolineras.es/) (Ministerio para la Transición Ecológica), provincia de Santa Cruz de Tenerife, filtrada a la isla de Tenerife y a venta al público. Sin servidores propios: el navegador consulta la API directamente.

## Desarrollo

HTML/CSS/JS sin build. Para probar en local:

```bash
python3 -m http.server 8741
# → http://localhost:8741
```

El mapa usa [Leaflet](https://leafletjs.com/) con teselas de [CARTO](https://carto.com/) · © OpenStreetMap.
