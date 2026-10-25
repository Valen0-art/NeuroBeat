
import asyncio
import csv
import json
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from threading import Lock

import websockets
from pynput import keyboard, mouse

# CONFIGURACIÓN
INTERVALO_MOVIMIENTO = 0.100
INTERVALO_SCROLL = 0.300
PUERTO = 8765

actividad_total = 0
ultimo_movimiento = 0.0
ultimo_scroll = 0.0
candado = Lock()

# ARCHIVO DE RESULTADOS
CAMPOS = [
    "fecha_hora",
    "sesion",
    "tipo",
    "secuencia",
    "eventos",
    "intervalo_muestra_ms",
    "rtt_confirmacion_ms",
    "procesamiento_js_ms",
    "fase",
    "estado",
    "cancion",
    "detalle"
]

RUTA_CSV = (
    Path(__file__).resolve().parent
    / "neurobeat_metricas.csv"
)


def registrar(
    sesion,
    tipo,
    secuencia="",
    eventos="",
    intervalo="",
    rtt="",
    procesamiento="",
    fase="",
    estado="",
    cancion="",
    detalle=""
):
    nueva = (
        not RUTA_CSV.exists()
        or RUTA_CSV.stat().st_size == 0
    )

    with RUTA_CSV.open(
        "a",
        newline="",
        encoding="utf-8-sig"
    ) as archivo:

        writer = csv.writer(archivo)

        if nueva:
            writer.writerow(CAMPOS)

        writer.writerow([
            datetime.now().isoformat(
                timespec="milliseconds"
            ),
            sesion,
            tipo,
            secuencia,
            eventos,
            intervalo,
            rtt,
            procesamiento,
            fase,
            estado,
            cancion,
            detalle
        ])

        archivo.flush()


# CAPTURA DE CLICS
def on_click(x, y, button, pressed):
    global actividad_total

    if pressed:
        with candado:
            actividad_total += 1


# CAPTURA DE MOVIMIENTO
def on_move(x, y):
    global actividad_total
    global ultimo_movimiento

    ahora = time.monotonic()

    with candado:
        if (
            ahora - ultimo_movimiento
            >= INTERVALO_MOVIMIENTO
        ):
            actividad_total += 1
            ultimo_movimiento = ahora


# CAPTURA DE SCROLL
def on_scroll(x, y, dx, dy):
    global actividad_total
    global ultimo_scroll

    ahora = time.monotonic()

    with candado:
        if (
            ahora - ultimo_scroll
            >= INTERVALO_SCROLL
        ):
            actividad_total += 1
            ultimo_scroll = ahora


# CAPTURA DE TECLADO
def on_press(key):
    global actividad_total

    with candado:
        actividad_total += 1


# ENVÍO DE DATOS
async def enviar_datos(
    websocket,
    sesion,
    pendientes
):
    global actividad_total

    secuencia = 0
    anterior = time.monotonic()

    while True:

        await asyncio.sleep(1)

        ahora = time.monotonic()

        intervalo = round(
            (ahora - anterior) * 1000,
            2
        )

        anterior = ahora

        with candado:
            eventos = actividad_total
            actividad_total = 0

        secuencia += 1

        paquete = {
            "tipo": "actividad",
            "seq": secuencia,
            "neural": eventos
        }

        pendientes[secuencia] = (
            time.perf_counter()
        )

        await websocket.send(
            json.dumps(paquete)
        )

        registrar(
            sesion,
            "envio",
            secuencia,
            eventos,
            intervalo
        )

        print(
            f">>> Muestra {secuencia}: "
            f"{eventos} eventos / "
            f"{intervalo} ms"
        )

        # DETECTAR CONFIRMACIONES PENDIENTES
        for viejo in list(pendientes):

            if viejo <= secuencia - 10:

                pendientes.pop(viejo)

                registrar(
                    sesion,
                    "sin_confirmacion",
                    viejo,
                    detalle=(
                        "No llegó confirmación "
                        "dentro de 10 muestras"
                    )
                )


# RECEPCIÓN DE CONFIRMACIONES
async def recibir_confirmaciones(
    websocket,
    sesion,
    pendientes
):

    async for mensaje in websocket:

        try:

            datos = json.loads(mensaje)

            if datos.get("tipo") != "ack":
                continue

            seq = int(datos["seq"])

            inicio = pendientes.pop(
                seq,
                None
            )

            if inicio is None:
                continue

            rtt = round(
                (
                    time.perf_counter()
                    - inicio
                ) * 1000,
                3
            )

            procesado = datos.get(
                "procesamiento_ms",
                ""
            )

            registrar(
                sesion,
                "confirmacion",
                seq,
                rtt=rtt,
                procesamiento=procesado,
                fase=datos.get("fase", ""),
                estado=datos.get("estado", ""),
                cancion=datos.get("cancion", "")
            )

            print(
                f">>> ACK {seq}: "
                f"ida y vuelta {rtt} ms; "
                f"JS {procesado} ms"
            )

        except (
            ValueError,
            KeyError,
            TypeError
        ) as error:

            print(
                f">>> Mensaje ignorado: {error}"
            )


# ADMINISTRACIÓN DE CONEXIONES
async def manejar_conexion(websocket):

    sesion = uuid.uuid4().hex[:12]
    pendientes = {}

    registrar(
        sesion,
        "conexion",
        detalle="Interfaz conectada"
    )

    print(
        f">>> Interfaz conectada; "
        f"sesión {sesion}"
    )

    envio = asyncio.create_task(
        enviar_datos(
            websocket,
            sesion,
            pendientes
        )
    )

    recepcion = asyncio.create_task(
        recibir_confirmaciones(
            websocket,
            sesion,
            pendientes
        )
    )

    try:

        terminadas, restantes = (
            await asyncio.wait(
                [envio, recepcion],
                return_when=(
                    asyncio.FIRST_COMPLETED
                )
            )
        )

        for tarea in restantes:
            tarea.cancel()

        await asyncio.gather(
            *restantes,
            return_exceptions=True
        )

        for tarea in terminadas:

            try:
                await tarea

            except (
                websockets.exceptions.ConnectionClosed
            ):
                pass

    finally:

        for seq in pendientes:

            registrar(
                sesion,
                "sin_confirmacion",
                seq,
                detalle=(
                    "Conexión finalizada sin ACK"
                )
            )

        registrar(
            sesion,
            "desconexion",
            detalle="Interfaz desconectada"
        )

        print(
            ">>> Interfaz desconectada; "
            "motor permanece disponible"
        )


# SERVIDOR WEBSOCKET
async def main():

    monitor_mouse = mouse.Listener(
        on_move=on_move,
        on_click=on_click,
        on_scroll=on_scroll
    )

    monitor_teclado = keyboard.Listener(
        on_press=on_press
    )

    monitor_mouse.start()
    monitor_teclado.start()

    print("--------------------------------")
    print(" MOTOR NEUROBEAT - MODO MEDICIÓN")
    print(
        f" WebSocket: ws://localhost:{PUERTO}"
    )
    print(
        f" Archivo de resultados: {RUTA_CSV}"
    )
    print(
        " Solo cuenta eventos; NO registra "
        "teclas ni posiciones"
    )
    print("--------------------------------")

    try:

        async with websockets.serve(
            manejar_conexion,
            "localhost",
            PUERTO
        ):
            await asyncio.Future()

    finally:
        monitor_mouse.stop()
        monitor_teclado.stop()


# INICIO DEL MOTOR
if __name__ == "__main__":

    try:
        asyncio.run(main())

    except KeyboardInterrupt:
        print(
            "\nMotor NeuroBeat detenido."
        )
        sys.exit(0)
