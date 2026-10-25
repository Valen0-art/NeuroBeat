// FONDO ANIMADO

const canvas = document.getElementById("neural-canvas");
const ctx = canvas.getContext("2d");

let particlesArray = [];

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener("resize", resize);
resize();

class Particle {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.speedX = (Math.random() - 0.5) * 0.5;
        this.speedY = (Math.random() - 0.5) * 0.5;
    }

    update() {
        this.x += this.speedX;
        this.y += this.speedY;

        if (this.x > canvas.width || this.x < 0) {
            this.speedX *= -1;
        }

        if (this.y > canvas.height || this.y < 0) {
            this.speedY *= -1;
        }
    }

    draw() {
        ctx.fillStyle = "rgba(0, 242, 255, 0.4)";
        ctx.beginPath();
        ctx.arc(this.x, this.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function init() {
    particlesArray = [];

    for (let i = 0; i < 80; i++) {
        particlesArray.push(new Particle());
    }
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particlesArray.forEach(p => {
        p.update();
        p.draw();
    });

    requestAnimationFrame(animate);
}

init();
animate();

// ==========================================
// VARIABLES GENERALES
// ==========================================

const playlist = [
    "Canción 1.mp3",
    "Canción 2.mp3",
    "Canción 3.mp3"
];

const nombresCanciones = [
    "Canción 1",
    "Canción 2",
    "Canción 3"
];

let currentTrack = 0;
let socket = null;
let conectado = false;

let faseCalibracion = true;
let temporizador = null;
let ultimoEstado = "Esperando";

// VARIABLES DE CALIBRACIÓN

const DURACION_CALIBRACION = 30;

// Muestras de eventos recibidas durante la calibración
let muestrasCalibracion = [];

// Referencia individual de actividad
let actividadReferencia = null;

// Indica si la calibración fue válida
let calibracionPersonalizada = false;

// Límites calculados
let limiteBajo = 4;
let limiteAlto = 12;

// ==========================================
// ELEMENTOS HTML
// ==========================================

const audio = document.getElementById("audioPlayer");
const counter = document.getElementById("counter");
const statusText = document.getElementById("status-text");
const statusDot = document.querySelector(".status-dot");
const startBtn = document.getElementById("startBtn");
const trackName = document.getElementById("track-name");

// ==========================================
// FUNCIONES DE CALIBRACIÓN
// ==========================================

// CALCULAR MEDIANA

function calcularMediana(valores) {

    if (valores.length === 0) {
        return 0;
    }

    const ordenados = [...valores].sort(
        (a, b) => a - b
    );

    const centro = Math.floor(
        ordenados.length / 2
    );

    if (ordenados.length % 2 === 0) {
        return (
            ordenados[centro - 1] +
            ordenados[centro]
        ) / 2;
    }

    return ordenados[centro];
}


// REINICIAR CALIBRACIÓN

function reiniciarCalibracion() {

    faseCalibracion = true;

    muestrasCalibracion = [];

    actividadReferencia = null;

    calibracionPersonalizada = false;

    limiteBajo = 4;
    limiteAlto = 12;

    ultimoEstado = "Observación inicial";
}


// FINALIZAR CALIBRACIÓN

function finalizarCalibracion() {

    const referencia = calcularMediana(
        muestrasCalibracion
    );

    actividadReferencia = referencia;

    // Se requieren muestras suficientes y
    // una actividad de referencia mínima.

    if (
        muestrasCalibracion.length >= 20 &&
        referencia >= 2
    ) {

        calibracionPersonalizada = true;

        limiteBajo = referencia * 0.60;

        limiteAlto = referencia * 1.40;

        console.log(
            ">>> Calibración personalizada completada"
        );

        console.log(
            ">>> Muestras:",
            muestrasCalibracion.length
        );

        console.log(
            ">>> Referencia:",
            referencia,
            "eventos por muestra"
        );

        console.log(
            ">>> Límite bajo:",
            limiteBajo
        );

        console.log(
            ">>> Límite alto:",
            limiteAlto
        );

        ultimoEstado =
            "Calibración personalizada completada";

    } else {

        // Si la actividad inicial fue insuficiente,
        // se mantienen los rangos originales.

        calibracionPersonalizada = false;

        limiteBajo = 4;
        limiteAlto = 12;

        ultimoEstado =
            "Calibración insuficiente: rangos fijos";

        console.warn(
            ">>> Calibración insuficiente."
        );

        console.warn(
            ">>> Se utilizarán rangos fijos."
        );
    }

    faseCalibracion = false;

    statusText.innerText = "SISTEMA ACTIVO";

    statusDot.style.backgroundColor = "#00ff88";

    console.log(
        ">>> Inicio de adaptación musical"
    );
}


// ==========================================
// ESTADO DE CONEXIÓN
// ==========================================

function cambiarInterfazConectada(estado) {

    startBtn.innerText = estado
        ? "DESVINCULAR ESCRITORIO"
        : "VINCULAR ESCRITORIO";

    startBtn.style.color = estado
        ? "#ff5555"
        : "#00f2ff";

    startBtn.style.borderColor = estado
        ? "#ff5555"
        : "#00f2ff";

    statusText.innerText = estado
        ? "Estado: Sistema vinculado"
        : "Estado: Sistema desvinculado";

    statusDot.style.backgroundColor = estado
        ? "#00ff88"
        : "#ff4444";
}


// ==========================================
// CONEXIÓN WEBSOCKET
// ==========================================

function conectar() {

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    statusText.innerText =
        "Estado: Conectando...";

    statusDot.style.backgroundColor =
        "#ffcc00";

    const conexion = new WebSocket(
        "ws://localhost:8765"
    );

    socket = conexion;

    conexion.onopen = () => {

        if (socket !== conexion) return;

        conectado = true;

        reiniciarCalibracion();

        cambiarInterfazConectada(true);

        iniciarMusica();
        iniciarCronometro();

        console.log(
            ">>> Motor NeuroBeat conectado"
        );
    };


    // RECIBIR EVENTOS DEL MOTOR PYTHON

    conexion.onmessage = (event) => {

        if (socket !== conexion) return;

        const inicio = performance.now();

        try {

            const datos = JSON.parse(event.data);

            if (
                datos.tipo !== "actividad" ||
                !Number.isFinite(Number(datos.neural))
            ) {
                return;
            }

            const actividad = Number(datos.neural);

            counter.innerText = actividad;

            if (faseCalibracion) {

                // Guardar actividad inicial

                muestrasCalibracion.push(actividad);

                ultimoEstado = "Observación inicial";

            } else {

                evaluarEstado(actividad);
            }

            // MEDIR TIEMPO DE PROCESAMIENTO

            const tiempoProcesamiento = Number(
                (
                    performance.now() - inicio
                ).toFixed(3)
            );

            // CONFIRMACIÓN PARA EL CSV EN PYTHON

            if (
                conexion.readyState === WebSocket.OPEN
            ) {

                conexion.send(
                    JSON.stringify({
                        tipo: "ack",
                        seq: datos.seq,
                        procesamiento_ms:
                            tiempoProcesamiento,
                        fase: faseCalibracion
                            ? "observacion"
                            : "evaluacion",
                        estado: ultimoEstado,
                        cancion:
                            nombresCanciones[currentTrack]
                    })
                );
            }

            console.log(
                `>>> Muestra ${datos.seq}: ` +
                `${actividad} eventos; ` +
                `JS ${tiempoProcesamiento} ms`
            );

        } catch (error) {

            console.error(
                ">>> Error procesando datos:",
                error
            );
        }
    };


    // DESCONEXIÓN

    conexion.onclose = () => {

        if (socket !== conexion) return;

        socket = null;
        conectado = false;

        limpiarCronometro();

        audio.pause();

        counter.innerText = "0";

        cambiarInterfazConectada(false);

        console.log(
            ">>> Motor NeuroBeat desconectado"
        );
    };


    // ERROR DE CONEXIÓN

    conexion.onerror = () => {

        if (socket !== conexion) return;

        statusText.innerText =
            "Estado: Motor no disponible";

        statusDot.style.backgroundColor =
            "#ff4444";

        console.error(
            ">>> No se pudo conectar con Python"
        );
    };
}


// ==========================================
// DESCONEXIÓN MANUAL
// ==========================================

function limpiarCronometro() {

    if (temporizador !== null) {
        clearInterval(temporizador);
        temporizador = null;
    }
}


function desconectar() {

    conectado = false;

    limpiarCronometro();

    if (socket) {

        const anterior = socket;
        socket = null;

        anterior.close();
    }

    audio.pause();

    counter.innerText = "0";

    cambiarInterfazConectada(false);
}


startBtn.onclick = () => {

    if (conectado) {
        desconectar();
    } else {
        conectar();
    }
};


// ==========================================
// REPRODUCCIÓN MUSICAL
// ==========================================

function iniciarMusica() {

    currentTrack = 0;

    reproducirCancion(currentTrack);
}


function reproducirCancion(indice) {

    if (!conectado) return;

    currentTrack = indice;

    audio.src = playlist[currentTrack];

    trackName.innerText =
        nombresCanciones[currentTrack];

    audio.volume = 1.0;

    audio.play().catch(error => {

        console.warn(
            ">>> Error al reproducir audio:",
            error
        );
    });
}


function cambiarCancion(indice) {

    if (
        !conectado ||
        indice === currentTrack
    ) {
        return;
    }

    reproducirCancion(indice);
}


audio.onended = () => {

    if (conectado) {

        reproducirCancion(
            (currentTrack + 1) % playlist.length
        );
    }
};


// ==========================================
// EVALUACIÓN DE ACTIVIDAD
// ==========================================

function evaluarEstado(valor) {

    // SIN INTERACCIÓN

    if (valor === 0) {

        ultimoEstado = "Baja interacción";

        statusText.innerText =
            "ESTADO: BAJA INTERACCIÓN";

        statusDot.style.backgroundColor =
            "#ff4444";

        cambiarCancion(0);
    }

    // ACTIVIDAD BAJA

    else if (
        calibracionPersonalizada
            ? valor < limiteBajo
            : valor <= 4
    ) {

        ultimoEstado = "Actividad baja";

        statusText.innerText =
            "ESTADO: ACTIVIDAD BAJA";

        statusDot.style.backgroundColor =
            "#ff9900";

        cambiarCancion(1);
    }

    // ACTIVIDAD NORMAL

    else if (
        calibracionPersonalizada
            ? valor <= limiteAlto
            : valor <= 12
    ) {

        ultimoEstado = "Actividad normal";

        statusText.innerText =
            "ESTADO: ACTIVIDAD NORMAL";

        statusDot.style.backgroundColor =
            "#00ff88";

        cambiarCancion(0);
    }

    // ACTIVIDAD ALTA

    else {

        ultimoEstado = "Actividad alta";

        statusText.innerText =
            "ESTADO: ACTIVIDAD ALTA";

        statusDot.style.backgroundColor =
            "#00d4ff";

        cambiarCancion(2);
    }
}


// ==========================================
// CALIBRACIÓN INICIAL - 30 SEGUNDOS
// ==========================================

function iniciarCronometro() {

    limpiarCronometro();

    let tiempoRestante = DURACION_CALIBRACION;

    faseCalibracion = true;

    statusText.innerText =
        `CALIBRANDO ACTIVIDAD: ${tiempoRestante}s`;

    statusDot.style.backgroundColor = "#ffcc00";

    temporizador = setInterval(() => {

        if (!conectado) {

            limpiarCronometro();
            return;
        }

        tiempoRestante--;

        if (tiempoRestante <= 0) {

            limpiarCronometro();

            finalizarCalibracion();

        } else {

            statusText.innerText =
                `CALIBRANDO ACTIVIDAD: ${tiempoRestante}s`;
        }

    }, 1000);
}


// ==========================================
// CIERRE
// ==========================================

window.addEventListener(
    "beforeunload",
    () => {

        if (socket) {
            socket.close();
        }
    }
);
