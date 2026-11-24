# Selyh para VS Code

Check-ins de un toque en pausas naturales, tu carga frente a tu propio ritmo y pausas breves guiadas, sin salir del editor.

Selyh aparece **solo en pausas naturales**: después de un commit, al terminar una sesión de depuración o al volver tras 5 minutos sin actividad. Nunca mientras escribes, nunca en una ventana sin foco y nunca en tus horas de silencio.

## Qué hace

- **Check-in de un toque**: del 1 (tranquilo) al 5 (muy cargado), con una etiqueta opcional (reuniones, un bug, un plazo…). Si no hay conexión, se guarda y se envía solo después, sin duplicados.
- **Una pausa breve**: respiración o estiramiento guiado, aprobado por el equipo clínico. La barra corta del isotipo marca el ritmo de la respiración.
- **Escalas en tandas cortas**: PSS-10, OMS-5, PHQ-9 y GAD-7, de a tres preguntas. Cada respuesta se guarda al momento.
- **Ayuda primero**: si una respuesta lo indica, las líneas de ayuda aparecen de inmediato.
- **Sueño (opcional)**: tras tu primer check-in del día, si activas ese permiso (`Selyh: Permisos`).
- **Pausas sugeridas**: en una pausa natural, si tu carga viene en aumento, Selyh te *ofrece* una pausa breve (como máximo cada 2 horas y dentro del tope diario). Nunca se abre sola.
- **Mi estado**: tu carga frente a tu propio ritmo y los últimos días, sin salir del editor.
- **Modo foco y horas de silencio**: se guardan en tu cuenta y valen en todos tus dispositivos.

Todo está en la barra de estado (**Selyh**, abajo a la derecha) y en la paleta de comandos (`Selyh: …`).

## Privacidad

- **Check-ins**: solo tu respuesta del 1 al 5 y la etiqueta que elijas.
- **Señales del editor (opcional, apagadas por defecto)**: tres números por día, calculados en tu equipo: horas activas, minutos fuera de tu horario y la racha continua más larga. **Nunca** código, archivos, teclas, ventanas ni nombres de proyecto. `Selyh: Qué se envía hoy` te muestra exactamente lo que sale.
- La sesión se guarda en el almacén cifrado de VS Code. Con varias ventanas abiertas, la actividad se cuenta una sola vez (solo la ventana con foco).

## Primeros pasos

1. `Selyh: Vincular cuenta`: se abre la web de Selyh con un código; apruébalo y listo.
2. Elige qué compartir (puedes cambiarlo con `Selyh: Permisos`).
3. Sigue trabajando. Selyh aparecerá cuando tenga sentido.

## Configuración

| Ajuste | Por defecto | Para qué |
| --- | --- | --- |
| `selyh.workHours.start` / `.end` | `09:00` / `18:00` | Separar el trabajo fuera de horario |
| `selyh.workHours.weekends` | `false` | Si trabajas fines de semana |
| `selyh.apiUrl` | API de producción | Desarrollo local: `http://localhost:3000` |
| `selyh.webUrl` | `https://selyh.fun` | Web para vincular y abrir tu panel |

Selyh no reemplaza la atención profesional. Si necesitas ayuda ahora: **Línea 113, opción 5** (MINSA, gratis, 24 horas).

## Desarrollo

```bash
npm install
npm run watch        # compila al guardar; F5 abre una ventana de prueba con la extensión
npm test             # pruebas dentro de VS Code
npm run vsix         # genera selyh-<versión>.vsix
```

Código en `src/`: `extension.ts` (arranque, barra de estado, comandos), `flows.ts` (vincular, check-in, escalas, ayuda), `pause.ts` (pausa guiada), `scheduler.ts` (cuándo preguntar), `activity.ts` (señales del editor), `store.ts` (cola sin conexión y sincronización), `api.ts` (cliente de la API).
