-- Base de datos v9 de ejemplo (generada con server/db.mjs de la v9 y seed/): la usa test/migraciones.test.mjs.
PRAGMA foreign_keys = OFF;
BEGIN;
CREATE TABLE categorias (
    id      TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL UNIQUE,
    orden   INTEGER NOT NULL,
    origen  TEXT NOT NULL DEFAULT 'seed' CHECK (origen IN ('seed', 'ia', 'usuario')),          -- quién manda en la fila: seed/ solo actualiza las que siguen siendo 'seed'
    color   TEXT NOT NULL DEFAULT '#C9C6DA' CHECK (color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]')  -- color de la categoría (pegatinas y fondos teñidos; el mismo en claro y en noche)
  );
INSERT INTO "categorias" VALUES ('micro','Microcontroladores',1,'seed','#7CC4FF');
INSERT INTO "categorias" VALUES ('sensor','Sensores',2,'seed','#6FD08C');
INSERT INTO "categorias" VALUES ('entrada','Pulsadores y mandos',3,'seed','#FFD23F');
INSERT INTO "categorias" VALUES ('pantalla','Pantallas y LED',4,'seed','#B48CFF');
INSERT INTO "categorias" VALUES ('actuador','Motores y sonido',5,'seed','#FF9F4A');
INSERT INTO "categorias" VALUES ('comunicacion','Comunicación',6,'seed','#FF8FB8');
INSERT INTO "categorias" VALUES ('modulo','Módulos y placas',7,'seed','#9FD8D0');
INSERT INTO "categorias" VALUES ('alimentacion','Alimentación',8,'seed','#FF8A80');
INSERT INTO "categorias" VALUES ('semi','Semiconductores',9,'seed','#A9B4FF');
INSERT INTO "categorias" VALUES ('pasivo','Pasivos',10,'seed','#D9C2A0');
INSERT INTO "categorias" VALUES ('conector','Conectores y cables',11,'seed','#E9C9A0');
INSERT INTO "categorias" VALUES ('montaje','Tornillería y montaje',12,'seed','#BFC6CF');
INSERT INTO "categorias" VALUES ('herramienta','Herramientas',13,'seed','#F2B880');
INSERT INTO "categorias" VALUES ('otro','Otros',14,'seed','#C9C6DA');
CREATE TABLE funciones_pin (
    id      TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL UNIQUE,
    color_claro   TEXT NOT NULL CHECK (color_claro GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),    -- sobre fondo claro (hoja de datos)
    color_oscuro  TEXT NOT NULL CHECK (color_oscuro GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),   -- sobre fondo oscuro (modo noche)
    tachado INTEGER NOT NULL DEFAULT 0 CHECK (tachado IN (0, 1)),
    orden   INTEGER NOT NULL
  );
INSERT INTO "funciones_pin" VALUES ('vcc','Alimentación','#d63c3c','#e8736b',0,1);
INSERT INTO "funciones_pin" VALUES ('gnd','Masa','#6f6d66','#8f8d86',0,2);
INSERT INTO "funciones_pin" VALUES ('bus','Bus (I2C, SPI, UART, I2S)','#2a73b8','#5fa8e3',0,3);
INSERT INTO "funciones_pin" VALUES ('dig','Señal digital','#1b8a52','#4fc58a',0,4);
INSERT INTO "funciones_pin" VALUES ('ana','Analógico','#b97800','#e0a542',0,5);
INSERT INTO "funciones_pin" VALUES ('otro','Otros','#6b5cc4','#a597ef',0,6);
INSERT INTO "funciones_pin" VALUES ('no','No usar','#b5b2a8','#4d4c48',1,7);
CREATE TABLE ajustes (                    -- preferencias de la aplicación (no del navegador)
    clave  TEXT PRIMARY KEY,
    valor  TEXT NOT NULL,
    CHECK (clave <> 'tema' OR valor IN ('auto', 'claro', 'noche'))
  );
INSERT INTO "ajustes" VALUES ('tema','auto');
INSERT INTO "ajustes" VALUES ('vista_inventario','lista');
INSERT INTO "ajustes" VALUES ('ia_razonar','poco');
INSERT INTO "ajustes" VALUES ('idioma','en');
CREATE TABLE dificultades (
    nivel   INTEGER PRIMARY KEY CHECK (nivel BETWEEN 1 AND 5),
    nombre  TEXT NOT NULL UNIQUE
  );
INSERT INTO "dificultades" VALUES (1,'fácil');
INSERT INTO "dificultades" VALUES (2,'media');
INSERT INTO "dificultades" VALUES (3,'difícil');
CREATE TABLE tipos (
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    categoria_id  TEXT NOT NULL REFERENCES categorias(id) ON UPDATE CASCADE,
    resumen       TEXT,
    voltaje       TEXT,
    usos          TEXT,          -- textos largos guardados pero no mostrados (decisión del usuario, 03/11/2026)
    conexion      TEXT,
    advertencias  TEXT,
    origen        TEXT NOT NULL DEFAULT 'seed' CHECK (origen IN ('seed', 'ia', 'usuario')),
    revisado      INTEGER NOT NULL DEFAULT 1 CHECK (revisado IN (0, 1)),  -- 0 = ficha de la IA aún sin comprobar
    archivado     INTEGER NOT NULL DEFAULT 0 CHECK (archivado IN (0, 1))  -- 1 = oculto (no sale en el glosario ni al elegir tipo)
  );
INSERT INTO "tipos" VALUES ('esp32-wroom-devkit','ESP32-WROOM-32 DevKit (38 pines)','micro','El ESP32 clásico: Wi-Fi, Bluetooth, dos núcleos. El caballo de batalla para casi todo.','3,3 V en los pines · 5 V por USB o VIN','Sensores Wi-Fi, Home Assistant (ESPHome), control de motores, pantallas…',NULL,'Las entradas analógicas de ADC2 no funcionan con el Wi-Fi encendido: usa ADC1 (GPIO32–39). Ningún pin aguanta 5 V.','seed',1,0);
INSERT INTO "tipos" VALUES ('hc-sr04','HC-SR04 (ultrasonidos)','sensor','Mide distancias de 2 cm a ~4 m con un pitido de ultrasonidos y su eco (como un murciélago).','5 V',NULL,'Distancia (cm) = duración del pulso Echo (µs) / 58.','Echo sale a 5 V: al ESP32 pásalo por un divisor (1 kΩ + 2 kΩ) para bajarlo a 3,3 V. Falla con superficies blandas o muy inclinadas.','seed',1,0);
INSERT INTO "tipos" VALUES ('vl53l0x','VL53L0X (distancia láser)','sensor','Mide distancia con un láser invisible y el tiempo que tarda en volver (ToF). Hasta ~1,2–2 m, muy preciso y pequeño.','3–5 V (lleva regulador)',NULL,NULL,'Si tiene una película protectora en el sensor, quítala. La luz solar fuerte lo ciega.','seed',1,0);
INSERT INTO "tipos" VALUES ('hc-sr501','HC-SR501 (movimiento PIR)','sensor','Detecta personas o animales que se mueven por el calor que desprenden. Alcance ~3–7 m.','5–20 V de alimentación · salida de 3,3 V (apta para ESP32)',NULL,'Dos potenciómetros: sensibilidad (distancia) y tiempo que mantiene la salida en HIGH (3 s a 5 min). Puente H = redispara mientras haya movimiento.','Tarda ~1 minuto en estabilizarse tras encenderlo: al principio da falsas detecciones. No ve a través del cristal.','seed',1,0);
INSERT INTO "tipos" VALUES ('ens160-aht21','ENS160 + AHT21 (calidad del aire)','sensor','Dos sensores en una placa: el ENS160 estima la calidad del aire (CO₂ equivalente, compuestos orgánicos volátiles, índice AQI) y el AHT21 mide temperatura y humedad.','VIN 5 V o pin 3V3',NULL,NULL,'El CO₂ es una ESTIMACIÓN a partir de otros gases, no un CO₂ real. Necesita ~1 h la primera vez y unos minutos en cada arranque. Pasa la temperatura y humedad del AHT21 al ENS160 para que sea más preciso.','seed',1,0);
INSERT INTO "tipos" VALUES ('oled-ssd1306','OLED 0,96" 128×64 (SSD1306)','pantalla','Pantalla pequeña monocromo muy nítida y de bajo consumo, perfecta para mostrar datos.','3,3–5 V',NULL,'Librería Adafruit SSD1306 o U8g2. Comparte el bus I2C con otros sensores sin problema.','Comprueba el orden de los pines: hay modelos con VCC y GND al revés. Una imagen fija durante meses se queda marcada.','seed',1,0);
INSERT INTO "tipos" VALUES ('tm1637-4dig','Display de 4 dígitos TM1637','pantalla','Cuatro dígitos de 7 segmentos con dos puntos y su controlador: solo necesita dos cables de datos.','3,3–5 V','Relojes, temporizadores, contadores, mostrar una distancia o una temperatura.','Librería TM1637Display.',NULL,'seed',1,0);
INSERT INTO "tipos" VALUES ('led-ws2812-8','8 LED RGB direccionables (WS2812)','pantalla','Ocho LED de color que se controlan uno a uno con un solo cable de datos.','5 V (datos de 3,3 V suelen funcionar)',NULL,'Librería Adafruit NeoPixel o FastLED. Un condensador de 470 µF en la alimentación y una resistencia de 330 Ω en DIN ayudan.','A brillo máximo en blanco, cada LED gasta ~60 mA: 8 LED ≈ 0,5 A. No los alimentes desde el pin 3,3 V.','seed',1,0);
INSERT INTO "tipos" VALUES ('buzzer-activo','Zumbador activo','actuador','Pita solo con darle corriente (lleva su oscilador dentro). Un tono fijo.','3,3–5 V',NULL,'Pata larga (+) al GPIO o mejor a un transistor; pata corta a GND.','Cómo distinguirlo: el activo tiene la parte de abajo tapada (resina negra) y suele traer pegatina; si le das 5 V pita solo.','seed',1,0);
INSERT INTO "tipos" VALUES ('buzzer-pasivo','Zumbador pasivo','actuador','Necesita que le mandes la frecuencia (PWM): así puede tocar notas y melodías.','3,3–5 V',NULL,'En el ESP32: tone(pin, frecuencia) o ledcWriteTone(). Mejor con un transistor si quieres más volumen.','Con corriente continua no suena (solo un clic). Por debajo se ve la placa verde.','seed',1,0);
INSERT INTO "tipos" VALUES ('servo-sg90','Micro servo SG90','actuador','Motor pequeño que va a un ángulo concreto (0–180°) y se queda ahí.','5 V (~4,8–6 V)',NULL,'Librería ESP32Servo. Pulso de 0,5 ms ≈ 0° y 2,5 ms ≈ 180°.','Al moverse da picos de corriente: aliméntalo con 5 V aparte (no del 3,3 V) y une las masas. Los engranajes son de plástico: no lo fuerces con la mano.','seed',1,0);
INSERT INTO "tipos" VALUES ('led','LED de colores (5 mm)','semi','El indicador más básico. Solo deja pasar la corriente en un sentido.','Rojo/amarillo ~2 V · verde/azul/blanco ~3 V · 10–20 mA',NULL,'Pata larga (+, ánodo) al GPIO a través de una resistencia de 220–330 Ω; pata corta (−, lado plano) a GND.','Sin resistencia se funde (o daña el pin).','seed',1,0);
INSERT INTO "tipos" VALUES ('resistencia','Resistencias','pasivo','Limitan la corriente: para LED, divisores de tensión, pull-up/pull-down.',NULL,NULL,'Las que más se usan: 220 Ω (LED), 1 kΩ (base de transistor), 10 kΩ (pull-up, pulsadores), 1 k + 2 k (bajar 5 V a 3,3 V).','Código de colores (4 bandas): marrón 1, rojo 2, naranja 3, amarillo 4, verde 5, azul 6, violeta 7, gris 8, blanco 9, negro 0. Ej.: rojo-rojo-marrón = 220 Ω. Si dudas, mídela con el polímetro.','seed',1,0);
INSERT INTO "tipos" VALUES ('cable-dupont','Cables dupont','conector','Cables con conector para protoboard y pines: macho-macho, macho-hembra y hembra-hembra.',NULL,NULL,NULL,'Usa colores con criterio: rojo = alimentación, negro = GND. Un cable flojo es la causa nº 1 de «no funciona».','seed',1,0);
INSERT INTO "tipos" VALUES ('protoboard-830','Protoboard de 830 puntos','conector','Placa para montar circuitos sin soldar.',NULL,NULL,'Las columnas de 5 agujeros están unidas entre sí; las líneas largas roja (+) y azul (−) de los lados recorren toda la placa.','En muchas protoboards de 830 las líneas laterales están cortadas a la mitad: une las dos mitades con un cable o compruébalo con el polímetro.','seed',1,0);
INSERT INTO "tipos" VALUES ('pulsador-12x12','Pulsador 12×12 mm','entrada','Pulsador grande con capuchón de color intercambiable. Muy cómodo para paneles.',NULL,NULL,'Una pata al GPIO y la diagonal opuesta a GND; en el código, pinMode(pin, INPUT_PULLUP): pulsado = LOW.','Las 4 patas están unidas de dos en dos: si «siempre está pulsado», gíralo 90°. Rebotes: ignora cambios de menos de ~20 ms.','seed',1,0);
INSERT INTO "tipos" VALUES ('joystick','Joystick analógico','entrada','Dos potenciómetros (eje X e Y) y un pulsador al apretar la palanca.','3,3–5 V (en ESP32, aliméntalo a 3,3 V)',NULL,NULL,'En reposo no da exactamente la mitad: calibra el centro y deja una zona muerta. En ESP32 usa pines ADC1.','seed',1,0);
INSERT INTO "tipos" VALUES ('potenciometro-b10k','Potenciómetro B10K','entrada','Resistencia de 10 kΩ que varías girando. «B» = lineal.',NULL,'Control de volumen, brillo, velocidad, ajustar un umbral.','Patas de los extremos a 3,3 V y GND; la central (cursor) a un pin analógico.',NULL,'seed',1,0);
CREATE TABLE tipo_alias (
    tipo_id  TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    alias    TEXT NOT NULL,
    PRIMARY KEY (tipo_id, alias)
  ) WITHOUT ROWID;
INSERT INTO "tipo_alias" VALUES ('buzzer-activo','buzzer');
INSERT INTO "tipo_alias" VALUES ('buzzer-activo','pitido');
INSERT INTO "tipo_alias" VALUES ('buzzer-pasivo','buzzer pasivo');
INSERT INTO "tipo_alias" VALUES ('buzzer-pasivo','frecuencia variable');
INSERT INTO "tipo_alias" VALUES ('cable-dupont','cables puente');
INSERT INTO "tipo_alias" VALUES ('cable-dupont','jumpers');
INSERT INTO "tipo_alias" VALUES ('ens160-aht21','CO2');
INSERT INTO "tipo_alias" VALUES ('ens160-aht21','TVOC');
INSERT INTO "tipo_alias" VALUES ('ens160-aht21','humedad');
INSERT INTO "tipo_alias" VALUES ('ens160-aht21','temperatura');
INSERT INTO "tipo_alias" VALUES ('esp32-wroom-devkit','ESP32 DevKitC');
INSERT INTO "tipo_alias" VALUES ('esp32-wroom-devkit','NodeMCU-32S');
INSERT INTO "tipo_alias" VALUES ('hc-sr04','distancia');
INSERT INTO "tipo_alias" VALUES ('hc-sr04','sonar');
INSERT INTO "tipo_alias" VALUES ('hc-sr501','PIR');
INSERT INTO "tipo_alias" VALUES ('hc-sr501','presencia');
INSERT INTO "tipo_alias" VALUES ('joystick','KY-023');
INSERT INTO "tipo_alias" VALUES ('joystick','palanca');
INSERT INTO "tipo_alias" VALUES ('led','diodo LED');
INSERT INTO "tipo_alias" VALUES ('led-ws2812-8','Freenove 8 RGB LED Module');
INSERT INTO "tipo_alias" VALUES ('led-ws2812-8','NeoPixel');
INSERT INTO "tipo_alias" VALUES ('led-ws2812-8','WS2812B');
INSERT INTO "tipo_alias" VALUES ('oled-ssd1306','OLED');
INSERT INTO "tipo_alias" VALUES ('oled-ssd1306','SSD1306');
INSERT INTO "tipo_alias" VALUES ('potenciometro-b10k','pot');
INSERT INTO "tipo_alias" VALUES ('potenciometro-b10k','resistencia variable');
INSERT INTO "tipo_alias" VALUES ('protoboard-830','breadboard');
INSERT INTO "tipo_alias" VALUES ('protoboard-830','placa de pruebas');
INSERT INTO "tipo_alias" VALUES ('pulsador-12x12','botón');
INSERT INTO "tipo_alias" VALUES ('pulsador-12x12','tactile switch');
INSERT INTO "tipo_alias" VALUES ('resistencia','resistor');
INSERT INTO "tipo_alias" VALUES ('servo-sg90','SG90');
INSERT INTO "tipo_alias" VALUES ('servo-sg90','servo');
INSERT INTO "tipo_alias" VALUES ('tm1637-4dig','4 digit display');
INSERT INTO "tipo_alias" VALUES ('tm1637-4dig','reloj');
INSERT INTO "tipo_alias" VALUES ('vl53l0x','ToF');
INSERT INTO "tipo_alias" VALUES ('vl53l0x','VL53L0/1XV2');
CREATE TABLE tipo_interfaces (
    tipo_id   TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden     INTEGER NOT NULL,
    interfaz  TEXT NOT NULL,
    PRIMARY KEY (tipo_id, orden)
  ) WITHOUT ROWID;
INSERT INTO "tipo_interfaces" VALUES ('buzzer-activo',1,'1 pin digital (encender/apagar)');
INSERT INTO "tipo_interfaces" VALUES ('buzzer-pasivo',1,'1 pin PWM');
INSERT INTO "tipo_interfaces" VALUES ('ens160-aht21',1,'I2C (ENS160 en 0x53, AHT21 en 0x38)');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',1,'Wi-Fi');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',2,'Bluetooth');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',3,'I2C');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',4,'SPI');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',5,'I2S');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',6,'UART');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',7,'ADC');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',8,'DAC');
INSERT INTO "tipo_interfaces" VALUES ('esp32-wroom-devkit',9,'Táctil');
INSERT INTO "tipo_interfaces" VALUES ('hc-sr04',1,'2 pines digitales (Trig, Echo)');
INSERT INTO "tipo_interfaces" VALUES ('hc-sr501',1,'1 pin digital');
INSERT INTO "tipo_interfaces" VALUES ('joystick',1,'2 analógicos + 1 digital');
INSERT INTO "tipo_interfaces" VALUES ('led',1,'1 pin digital o PWM (brillo)');
INSERT INTO "tipo_interfaces" VALUES ('led-ws2812-8',1,'1 pin digital (DIN)');
INSERT INTO "tipo_interfaces" VALUES ('oled-ssd1306',1,'I2C (0x3C, a veces 0x3D)');
INSERT INTO "tipo_interfaces" VALUES ('potenciometro-b10k',1,'1 pin analógico');
INSERT INTO "tipo_interfaces" VALUES ('pulsador-12x12',1,'1 pin digital');
INSERT INTO "tipo_interfaces" VALUES ('servo-sg90',1,'1 pin PWM (50 Hz)');
INSERT INTO "tipo_interfaces" VALUES ('tm1637-4dig',1,'2 pines (CLK, DIO)');
INSERT INTO "tipo_interfaces" VALUES ('tm1637-4dig',2,'protocolo propio');
INSERT INTO "tipo_interfaces" VALUES ('vl53l0x',1,'I2C (dirección 0x29)');
CREATE TABLE tipo_pines (
    tipo_id     TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden       INTEGER NOT NULL,
    pin         TEXT NOT NULL,
    uso         TEXT NOT NULL,
    funcion_id  TEXT NOT NULL REFERENCES funciones_pin(id) ON UPDATE CASCADE,
    nota        TEXT,          -- lo que hay que saber de ese pin además de su uso («También: UART2 RX», «solo entrada») (v8)
    PRIMARY KEY (tipo_id, orden)
  ) WITHOUT ROWID;
INSERT INTO "tipo_pines" VALUES ('buzzer-activo',1,'+ (pata larga)','GPIO o transistor','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('buzzer-activo',2,'−','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('buzzer-pasivo',1,'+','PWM (tone)','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('buzzer-pasivo',2,'−','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('ens160-aht21',1,'VIN','5 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('ens160-aht21',2,'3V3','3,3 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('ens160-aht21',3,'GND','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('ens160-aht21',4,'SCL','I2C reloj','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('ens160-aht21',5,'SDA','I2C datos','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('ens160-aht21',6,'ADD','Dirección del ENS160','otro',NULL);
INSERT INTO "tipo_pines" VALUES ('ens160-aht21',7,'INT','Interrupción','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('ens160-aht21',8,'CS','Solo modo SPI','no',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',1,'3V3','Salida 3,3 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',2,'VIN','Entrada 5 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',3,'GND','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',4,'GPIO 21','I2C SDA','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',5,'GPIO 22','I2C SCL','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',6,'GPIO 23','SPI MOSI','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',7,'GPIO 19','SPI MISO','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',8,'GPIO 18','SPI SCK','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',9,'GPIO 5','SPI CS','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',10,'GPIO 16','UART2 RX','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',11,'GPIO 17','UART2 TX','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',12,'GPIO 32','Analógico (ADC1)','ana',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',13,'GPIO 33','Analógico (ADC1)','ana',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',14,'GPIO 34','Analógico (ADC1)','ana','También: Solo entrada');
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',15,'GPIO 35','Analógico (ADC1)','ana','También: Solo entrada');
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',16,'GPIO 36','Analógico (ADC1)','ana','También: Solo entrada');
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',17,'GPIO 37','Analógico (ADC1)','ana','También: Solo entrada');
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',18,'GPIO 38','Analógico (ADC1)','ana','También: Solo entrada');
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',19,'GPIO 39','Analógico (ADC1)','ana','También: Solo entrada');
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',20,'GPIO 25','Salida analógica (DAC)','ana',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',21,'GPIO 26','Salida analógica (DAC)','ana',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',22,'GPIO 0','Arranque, con cuidado','otro',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',23,'GPIO 2','Arranque, con cuidado','otro',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',24,'GPIO 12','Arranque, con cuidado','otro',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',25,'GPIO 15','Arranque, con cuidado','otro',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',26,'GPIO 6','Flash, no usar','no',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',27,'GPIO 7','Flash, no usar','no',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',28,'GPIO 8','Flash, no usar','no',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',29,'GPIO 9','Flash, no usar','no',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',30,'GPIO 10','Flash, no usar','no',NULL);
INSERT INTO "tipo_pines" VALUES ('esp32-wroom-devkit',31,'GPIO 11','Flash, no usar','no',NULL);
INSERT INTO "tipo_pines" VALUES ('hc-sr04',1,'Vcc','5 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('hc-sr04',2,'Trig','Disparo (pulso 10 µs)','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('hc-sr04',3,'Echo','Eco, sale a 5 V: divisor','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('hc-sr04',4,'Gnd','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('hc-sr501',1,'VCC','5–20 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('hc-sr501',2,'OUT','HIGH al detectar (3,3 V)','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('hc-sr501',3,'GND','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('joystick',1,'+5V','3,3 V con ESP32','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('joystick',2,'GND','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('joystick',3,'VRx','Eje X','ana',NULL);
INSERT INTO "tipo_pines" VALUES ('joystick',4,'VRy','Eje Y','ana',NULL);
INSERT INTO "tipo_pines" VALUES ('joystick',5,'SW','Pulsador (PULLUP)','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('led',1,'Pata larga (+)','GPIO con 220–330 Ω','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('led',2,'Pata corta (−)','Masa (lado plano)','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('led-ws2812-8',1,'VCC','5 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('led-ws2812-8',2,'GND','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('led-ws2812-8',3,'DIN','Datos (con 330 Ω)','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('led-ws2812-8',4,'DOUT','Encadenar más LED','otro',NULL);
INSERT INTO "tipo_pines" VALUES ('oled-ssd1306',1,'VCC','3,3–5 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('oled-ssd1306',2,'GND','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('oled-ssd1306',3,'SCL','I2C reloj','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('oled-ssd1306',4,'SDA','I2C datos','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('potenciometro-b10k',1,'Extremo 1','3,3 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('potenciometro-b10k',2,'Centro','Pin analógico','ana',NULL);
INSERT INTO "tipo_pines" VALUES ('potenciometro-b10k',3,'Extremo 2','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('protoboard-830',1,'Línea roja (+)','Alimentación a lo largo','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('protoboard-830',2,'Línea azul (−)','Masa a lo largo','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('protoboard-830',3,'Columnas de 5','Unidas entre sí','otro',NULL);
INSERT INTO "tipo_pines" VALUES ('pulsador-12x12',1,'Una pata','GPIO (INPUT_PULLUP)','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('pulsador-12x12',2,'Pata en diagonal','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('servo-sg90',1,'Rojo','5 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('servo-sg90',2,'Marrón','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('servo-sg90',3,'Naranja','Señal PWM','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('tm1637-4dig',1,'VCC','3,3–5 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('tm1637-4dig',2,'GND','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('tm1637-4dig',3,'CLK','Reloj','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('tm1637-4dig',4,'DIO','Datos','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('vl53l0x',1,'VIN','3–5 V','vcc',NULL);
INSERT INTO "tipo_pines" VALUES ('vl53l0x',2,'GND','Masa','gnd',NULL);
INSERT INTO "tipo_pines" VALUES ('vl53l0x',3,'SCL','I2C reloj','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('vl53l0x',4,'SDA','I2C datos','bus',NULL);
INSERT INTO "tipo_pines" VALUES ('vl53l0x',5,'GPIO1','Interrupción','dig',NULL);
INSERT INTO "tipo_pines" VALUES ('vl53l0x',6,'XSHUT','Apagar / cambiar dirección','dig',NULL);
CREATE TABLE ubicaciones (
    id      INTEGER PRIMARY KEY,
    nombre  TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(nombre)) > 0)
  );
INSERT INTO "ubicaciones" VALUES (1,'Cajón 1');
INSERT INTO "ubicaciones" VALUES (2,'Cajita 2');
INSERT INTO "ubicaciones" VALUES (3,'Cajita 3');
CREATE TABLE componentes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
    tipo_id       TEXT REFERENCES tipos(id) ON DELETE SET NULL ON UPDATE CASCADE,
    cantidad      INTEGER CHECK (cantidad IS NULL OR cantidad >= 0),     -- NULL = sin contar
    varios        INTEGER NOT NULL DEFAULT 0 CHECK (varios IN (0, 1)),  -- 1 = «hay muchos»
    ubicacion_id  INTEGER REFERENCES ubicaciones(id) ON DELETE SET NULL,
    notas         TEXT NOT NULL DEFAULT '',
    revisar       INTEGER NOT NULL DEFAULT 0 CHECK (revisar IN (0, 1)),
    foto          TEXT UNIQUE,                                           -- fichero en data/fotos
    creado        TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado   TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (varios = 0 OR cantidad IS NULL)
  );
INSERT INTO "componentes" VALUES (1,'ESP32-WROOM-32 DevKit (ejemplo)','esp32-wroom-devkit',3,0,1,'Pieza de ejemplo: bórrala cuando añadas las tuyas.',0,NULL,'2026-11-24 21:57:13','2026-11-24 21:57:13');
INSERT INTO "componentes" VALUES (2,'Protoboard de 830 puntos (ejemplo)','protoboard-830',1,0,1,'Pieza de ejemplo: bórrala cuando añadas las tuyas.',0,NULL,'2026-11-24 21:57:13','2026-11-24 21:57:13');
INSERT INTO "componentes" VALUES (3,'Cables dupont (ejemplo)','cable-dupont',NULL,1,1,'Pieza de ejemplo: bórrala cuando añadas las tuyas.',0,NULL,'2026-11-24 21:57:13','2026-11-24 21:57:13');
INSERT INTO "componentes" VALUES (4,'LEDs de 5 mm surtidos (ejemplo)','led',NULL,1,2,'Pieza de ejemplo: bórrala cuando añadas las tuyas.',0,NULL,'2026-11-24 21:57:13','2026-11-24 21:57:13');
INSERT INTO "componentes" VALUES (5,'Resistencias surtidas (ejemplo)','resistencia',NULL,1,2,'Pieza de ejemplo: bórrala cuando añadas las tuyas.',0,NULL,'2026-11-24 21:57:13','2026-11-24 21:57:13');
INSERT INTO "componentes" VALUES (6,'HC-SR04 (ejemplo)','hc-sr04',2,0,3,'Pieza de ejemplo: bórrala cuando añadas las tuyas.',0,NULL,'2026-11-24 21:57:13','2026-11-24 21:57:13');
CREATE TABLE proyectos (
    id          TEXT PRIMARY KEY,
    nombre      TEXT NOT NULL,
    dificultad  INTEGER NOT NULL DEFAULT 1 REFERENCES dificultades(nivel),
    tiempo      TEXT,
    resumen     TEXT,
    origen      TEXT NOT NULL DEFAULT 'seed' CHECK (origen IN ('seed', 'ia', 'usuario')),          -- seed/ solo actualiza los que siguen siendo 'seed' (v8)
    estado      TEXT NOT NULL DEFAULT 'idea' CHECK (estado IN ('idea', 'en_marcha', 'pausa', 'terminado'))  -- lo pone el usuario; seed/ nunca lo toca
  );
INSERT INTO "proyectos" VALUES ('monitor-aire','Monitor de calidad del aire',1,'1–2 h','Muestra en la OLED el CO₂ estimado, los compuestos volátiles, la temperatura y la humedad de la habitación. Opcional: mandarlo a Home Assistant con ESPHome.','seed','idea');
INSERT INTO "proyectos" VALUES ('alarma-pir','Alarma de movimiento con sirena',1,'1 h','Si el PIR detecta a alguien, los LED se ponen rojos y suena el zumbador. Con un pulsador la armas y desarmas.','seed','idea');
INSERT INTO "proyectos" VALUES ('sensor-aparcamiento','Sensor de aparcamiento',1,'1 h','Mide la distancia y la muestra en el display de 4 dígitos; el zumbador pita más rápido cuanto más cerca estás, como en los coches.','seed','idea');
INSERT INTO "proyectos" VALUES ('pan-joystick','Torreta con joystick y láser de distancia',2,'2 h','Mueves el servo con el joystick y el VL53L0X montado encima mide a lo que apuntas; la distancia sale en la OLED. Base para un radar.','seed','idea');
CREATE TABLE proyecto_material (
    id           INTEGER PRIMARY KEY,
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden        INTEGER NOT NULL,
    cantidad     INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    opcional     INTEGER NOT NULL DEFAULT 0 CHECK (opcional IN (0, 1)),
    nota         TEXT,
    UNIQUE (proyecto_id, orden)
  );
INSERT INTO "proyecto_material" VALUES (1,'monitor-aire',1,1,0,'o cualquier ESP32');
INSERT INTO "proyecto_material" VALUES (2,'monitor-aire',2,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (3,'monitor-aire',3,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (4,'monitor-aire',4,1,1,'semáforo verde/ámbar/rojo');
INSERT INTO "proyecto_material" VALUES (5,'monitor-aire',5,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (6,'monitor-aire',6,8,0,NULL);
INSERT INTO "proyecto_material" VALUES (7,'alarma-pir',1,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (8,'alarma-pir',2,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (9,'alarma-pir',3,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (10,'alarma-pir',4,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (11,'alarma-pir',5,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (12,'alarma-pir',6,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (13,'alarma-pir',7,8,0,NULL);
INSERT INTO "proyecto_material" VALUES (14,'sensor-aparcamiento',1,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (15,'sensor-aparcamiento',2,1,0,'HC-SR04 para >1 m, VL53L0X para precisión cerca');
INSERT INTO "proyecto_material" VALUES (16,'sensor-aparcamiento',3,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (17,'sensor-aparcamiento',4,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (18,'sensor-aparcamiento',5,2,0,'1 kΩ + 2 kΩ para el Echo');
INSERT INTO "proyecto_material" VALUES (19,'sensor-aparcamiento',6,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (20,'sensor-aparcamiento',7,10,0,NULL);
INSERT INTO "proyecto_material" VALUES (21,'pan-joystick',1,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (22,'pan-joystick',2,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (23,'pan-joystick',3,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (24,'pan-joystick',4,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (25,'pan-joystick',5,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (26,'pan-joystick',6,1,0,NULL);
INSERT INTO "proyecto_material" VALUES (27,'pan-joystick',7,12,0,NULL);
CREATE TABLE material_opciones (          -- un hueco de material admite varios tipos («ESP32-WROOM o S3»)
    material_id  INTEGER NOT NULL REFERENCES proyecto_material(id) ON DELETE CASCADE,
    tipo_id      TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (material_id, tipo_id)
  ) WITHOUT ROWID;
INSERT INTO "material_opciones" VALUES (9,'buzzer-activo');
INSERT INTO "material_opciones" VALUES (17,'buzzer-pasivo');
INSERT INTO "material_opciones" VALUES (6,'cable-dupont');
INSERT INTO "material_opciones" VALUES (13,'cable-dupont');
INSERT INTO "material_opciones" VALUES (20,'cable-dupont');
INSERT INTO "material_opciones" VALUES (27,'cable-dupont');
INSERT INTO "material_opciones" VALUES (2,'ens160-aht21');
INSERT INTO "material_opciones" VALUES (1,'esp32-wroom-devkit');
INSERT INTO "material_opciones" VALUES (7,'esp32-wroom-devkit');
INSERT INTO "material_opciones" VALUES (14,'esp32-wroom-devkit');
INSERT INTO "material_opciones" VALUES (21,'esp32-wroom-devkit');
INSERT INTO "material_opciones" VALUES (15,'hc-sr04');
INSERT INTO "material_opciones" VALUES (8,'hc-sr501');
INSERT INTO "material_opciones" VALUES (22,'joystick');
INSERT INTO "material_opciones" VALUES (4,'led-ws2812-8');
INSERT INTO "material_opciones" VALUES (10,'led-ws2812-8');
INSERT INTO "material_opciones" VALUES (3,'oled-ssd1306');
INSERT INTO "material_opciones" VALUES (25,'oled-ssd1306');
INSERT INTO "material_opciones" VALUES (5,'protoboard-830');
INSERT INTO "material_opciones" VALUES (12,'protoboard-830');
INSERT INTO "material_opciones" VALUES (19,'protoboard-830');
INSERT INTO "material_opciones" VALUES (26,'protoboard-830');
INSERT INTO "material_opciones" VALUES (11,'pulsador-12x12');
INSERT INTO "material_opciones" VALUES (18,'resistencia');
INSERT INTO "material_opciones" VALUES (23,'servo-sg90');
INSERT INTO "material_opciones" VALUES (16,'tm1637-4dig');
INSERT INTO "material_opciones" VALUES (15,'vl53l0x');
INSERT INTO "material_opciones" VALUES (24,'vl53l0x');
CREATE TABLE proyecto_conexiones (
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden        INTEGER NOT NULL,
    desde        TEXT NOT NULL,
    hasta        TEXT NOT NULL,
    nota         TEXT,
    PRIMARY KEY (proyecto_id, orden)
  ) WITHOUT ROWID;
INSERT INTO "proyecto_conexiones" VALUES ('alarma-pir',1,'PIR VCC','5V (VIN)',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('alarma-pir',2,'PIR OUT','GPIO27',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('alarma-pir',3,'Zumbador +','GPIO26','mejor con un transistor');
INSERT INTO "proyecto_conexiones" VALUES ('alarma-pir',4,'WS2812 DIN','GPIO4',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('alarma-pir',5,'WS2812 VCC','5V',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('alarma-pir',6,'Pulsador','GPIO25 ↔ GND','INPUT_PULLUP');
INSERT INTO "proyecto_conexiones" VALUES ('monitor-aire',1,'ENS160 VIN','ESP32 3V3',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('monitor-aire',2,'ENS160 GND','GND',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('monitor-aire',3,'ENS160 SDA','GPIO21','bus I2C compartido');
INSERT INTO "proyecto_conexiones" VALUES ('monitor-aire',4,'ENS160 SCL','GPIO22',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('monitor-aire',5,'OLED SDA / SCL','GPIO21 / GPIO22','mismo bus');
INSERT INTO "proyecto_conexiones" VALUES ('monitor-aire',6,'OLED VCC / GND','3V3 / GND',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('monitor-aire',7,'WS2812 DIN','GPIO4','opcional');
INSERT INTO "proyecto_conexiones" VALUES ('pan-joystick',1,'Joystick VRx','GPIO34',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('pan-joystick',2,'Joystick SW','GPIO25','INPUT_PULLUP');
INSERT INTO "proyecto_conexiones" VALUES ('pan-joystick',3,'Joystick +','3V3',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('pan-joystick',4,'Servo señal','GPIO13',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('pan-joystick',5,'Servo rojo','5V',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('pan-joystick',6,'VL53L0X + OLED','I2C GPIO21 / 22',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('sensor-aparcamiento',1,'HC-SR04 Vcc','5V',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('sensor-aparcamiento',2,'HC-SR04 Trig','GPIO5',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('sensor-aparcamiento',3,'HC-SR04 Echo','GPIO18','a través del divisor 1 k / 2 k');
INSERT INTO "proyecto_conexiones" VALUES ('sensor-aparcamiento',4,'TM1637 CLK / DIO','GPIO22 / GPIO21',NULL);
INSERT INTO "proyecto_conexiones" VALUES ('sensor-aparcamiento',5,'Zumbador pasivo','GPIO26',NULL);
CREATE TABLE proyecto_pasos (
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden        INTEGER NOT NULL,
    texto        TEXT NOT NULL,
    PRIMARY KEY (proyecto_id, orden)
  ) WITHOUT ROWID;
INSERT INTO "proyecto_pasos" VALUES ('alarma-pir',1,'Ajusta el potenciómetro de tiempo del PIR al mínimo y el puente en H.');
INSERT INTO "proyecto_pasos" VALUES ('alarma-pir',2,'Programa tres estados: desarmada (verde), armando 10 s (ámbar parpadeando), armada (apagado).');
INSERT INTO "proyecto_pasos" VALUES ('alarma-pir',3,'Con la alarma armada, si OUT = HIGH: rojo + zumbador hasta pulsar el botón.');
INSERT INTO "proyecto_pasos" VALUES ('alarma-pir',4,'Extra: aviso al móvil por Telegram o Home Assistant.');
INSERT INTO "proyecto_pasos" VALUES ('monitor-aire',1,'Monta los dos módulos I2C en paralelo (SDA con SDA, SCL con SCL).');
INSERT INTO "proyecto_pasos" VALUES ('monitor-aire',2,'Escanea el bus I2C: deben salir 0x38 (AHT21), 0x53 (ENS160) y 0x3C (OLED).');
INSERT INTO "proyecto_pasos" VALUES ('monitor-aire',3,'Lee el AHT21 y pásale la temperatura y humedad al ENS160 antes de cada lectura.');
INSERT INTO "proyecto_pasos" VALUES ('monitor-aire',4,'Muestra los valores en la OLED; espera ~3 min tras encender antes de fiarte del CO₂.');
INSERT INTO "proyecto_pasos" VALUES ('monitor-aire',5,'Extra: con ESPHome aparece solo en Home Assistant.');
INSERT INTO "proyecto_pasos" VALUES ('pan-joystick',1,'Lee el eje X y conviértelo en ángulo (0–180°) con zona muerta en el centro.');
INSERT INTO "proyecto_pasos" VALUES ('pan-joystick',2,'Pega el VL53L0X al brazo del servo.');
INSERT INTO "proyecto_pasos" VALUES ('pan-joystick',3,'Muestra ángulo y distancia en la OLED.');
INSERT INTO "proyecto_pasos" VALUES ('pan-joystick',4,'Modo radar al pulsar: barrido automático dibujando los puntos en la OLED.');
INSERT INTO "proyecto_pasos" VALUES ('sensor-aparcamiento',1,'Haz el divisor para que Echo llegue a 3,3 V.');
INSERT INTO "proyecto_pasos" VALUES ('sensor-aparcamiento',2,'Mide 5 veces y quédate con la mediana para quitar lecturas raras.');
INSERT INTO "proyecto_pasos" VALUES ('sensor-aparcamiento',3,'Muestra los cm en el display.');
INSERT INTO "proyecto_pasos" VALUES ('sensor-aparcamiento',4,'Pitido: intervalo = distancia × 10 ms; continuo por debajo de 10 cm.');
CREATE TABLE historial (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    componente_id      INTEGER REFERENCES componentes(id) ON DELETE SET NULL,
    componente_nombre  TEXT NOT NULL,
    accion             TEXT NOT NULL CHECK (accion IN ('alta', 'stock', 'baja')),
    antes              TEXT,
    despues            TEXT,
    fecha              TEXT NOT NULL DEFAULT (datetime('now'))
  );
INSERT INTO "historial" VALUES (1,1,'ESP32-WROOM-32 DevKit (ejemplo)','stock','1','3','2026-11-24 21:57:13');
CREATE TABLE tipo_datos (                 -- ficha técnica extendida: «Corriente máx.» → «20 mA», «Dirección I2C» → «0x3C»
    tipo_id  TEXT NOT NULL REFERENCES tipos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orden    INTEGER NOT NULL,
    clave    TEXT NOT NULL CHECK (length(trim(clave)) > 0),
    valor    TEXT NOT NULL,
    PRIMARY KEY (tipo_id, clave)
  ) WITHOUT ROWID;
CREATE TABLE componente_datos (           -- lo que cambia de una pieza a otra del mismo tipo: «Valor» → «220 Ω»
    componente_id  INTEGER NOT NULL REFERENCES componentes(id) ON DELETE CASCADE,
    orden          INTEGER NOT NULL,
    clave          TEXT NOT NULL CHECK (length(trim(clave)) > 0),
    valor          TEXT NOT NULL,
    PRIMARY KEY (componente_id, clave)
  ) WITHOUT ROWID;
CREATE TABLE ia_tareas (                  -- cada llamada al modelo: lo que se le pidió, lo que propuso y qué se hizo
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    clase          TEXT NOT NULL CHECK (clase IN ('alta', 'revisar', 'detectar', 'reorganizar')),
    estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'propuesta', 'aplicada', 'descartada', 'error')),
    entrada        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(entrada)),
    propuesta      TEXT CHECK (propuesta IS NULL OR json_valid(propuesta)),
    componente_id  INTEGER REFERENCES componentes(id) ON DELETE SET NULL,   -- la pieza creada (alta) o revisada
    modelo         TEXT,
    error          TEXT,
    creada         TEXT NOT NULL DEFAULT (datetime('now')),
    actualizada    TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE ia_config (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    clave        TEXT CHECK (clave IS NULL OR (length(clave) BETWEEN 16 AND 300 AND clave NOT GLOB '*[ 	]*')),
    modelo       TEXT CHECK (modelo IS NULL OR (length(modelo) BETWEEN 1 AND 80 AND modelo GLOB '[a-z0-9]*' AND modelo NOT GLOB '*[^a-z0-9.-]*')),
    actualizado  TEXT NOT NULL DEFAULT (datetime('now'))
  );
INSERT INTO "ia_config" VALUES (1,NULL,NULL,'2026-11-24 21:57:13');
CREATE TABLE catalogo_quitados (
    clase      TEXT NOT NULL CHECK (clase IN ('tipo', 'categoria', 'proyecto')),
    id         TEXT NOT NULL,
    reemplazo  TEXT,
    fecha      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (clase, id)
  ) WITHOUT ROWID;
CREATE TABLE auditoria (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha      TEXT NOT NULL DEFAULT (datetime('now')),
    quien      TEXT NOT NULL CHECK (quien IN ('usuario', 'ia', 'sistema')),
    accion     TEXT NOT NULL,                 -- «pieza.editar», «tipo.fusionar», «ia.aplicar», «copia.restaurar»…
    objeto     TEXT NOT NULL CHECK (objeto IN ('pieza', 'tipo', 'categoria', 'sitio', 'ia', 'copia', 'ajustes', 'proyecto')),
    objeto_id  TEXT,                          -- id de la pieza, del tipo… (puede que ya no exista)
    nombre     TEXT,                          -- su nombre en ese momento
    resumen    TEXT NOT NULL,                 -- frase que se lee en la web
    detalle    TEXT CHECK (detalle IS NULL OR json_valid(detalle)),   -- {cambios: [{campo, antes, despues}], …}
    modelo     TEXT                           -- si lo hizo la IA: con qué modelo
  );
CREATE TABLE proyecto_notas (             -- bitácora: cómo avanza, con foto opcional
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    texto        TEXT NOT NULL DEFAULT '',
    foto         TEXT UNIQUE,
    fecha        TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (length(trim(texto)) > 0 OR foto IS NOT NULL)
  );
CREATE TABLE proyecto_tareas (            -- tablero: por hacer, en curso, hecho
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    texto        TEXT NOT NULL CHECK (length(trim(texto)) > 0),
    columna      TEXT NOT NULL DEFAULT 'hacer' CHECK (columna IN ('hacer', 'curso', 'hecho')),
    orden        INTEGER NOT NULL DEFAULT 0,
    creada       TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE TABLE proyecto_archivos (          -- diagramas y esquemas
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    proyecto_id  TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE ON UPDATE CASCADE,
    fichero      TEXT NOT NULL UNIQUE,       -- en data/fotos
    nombre       TEXT NOT NULL,              -- el que le puso el usuario
    tipo         TEXT NOT NULL,              -- image/jpeg, application/pdf…
    bytes        INTEGER NOT NULL,
    fecha        TEXT NOT NULL DEFAULT (datetime('now'))
  );
CREATE INDEX tipos_categoria ON tipos(categoria_id);
CREATE INDEX tipo_pines_funcion ON tipo_pines(funcion_id);
CREATE INDEX componentes_tipo ON componentes(tipo_id);
CREATE INDEX componentes_ubicacion ON componentes(ubicacion_id);
CREATE INDEX material_opciones_tipo ON material_opciones(tipo_id);
CREATE INDEX historial_componente ON historial(componente_id);
CREATE INDEX ia_tareas_estado ON ia_tareas(estado);
CREATE INDEX auditoria_objeto ON auditoria(objeto, objeto_id);
CREATE INDEX proyecto_notas_proyecto ON proyecto_notas(proyecto_id);
CREATE INDEX proyecto_tareas_proyecto ON proyecto_tareas(proyecto_id);
CREATE INDEX proyecto_archivos_proyecto ON proyecto_archivos(proyecto_id);
CREATE TRIGGER componentes_actualizado AFTER UPDATE ON componentes
    WHEN NEW.actualizado IS OLD.actualizado
    BEGIN UPDATE componentes SET actualizado = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER historial_alta AFTER INSERT ON componentes
    BEGIN INSERT INTO historial (componente_id, componente_nombre, accion, despues)
      VALUES (NEW.id, NEW.nombre, 'alta', CASE WHEN NEW.varios THEN 'muchos' ELSE NEW.cantidad END); END;
CREATE TRIGGER historial_stock AFTER UPDATE OF cantidad, varios ON componentes
    WHEN NEW.cantidad IS NOT OLD.cantidad OR NEW.varios IS NOT OLD.varios
    BEGIN INSERT INTO historial (componente_id, componente_nombre, accion, antes, despues)
      VALUES (NEW.id, NEW.nombre, 'stock',
              CASE WHEN OLD.varios THEN 'muchos' ELSE OLD.cantidad END,
              CASE WHEN NEW.varios THEN 'muchos' ELSE NEW.cantidad END); END;
CREATE TRIGGER historial_baja AFTER DELETE ON componentes
    BEGIN INSERT INTO historial (componente_id, componente_nombre, accion, antes)
      VALUES (NULL, OLD.nombre, 'baja', CASE WHEN OLD.varios THEN 'muchos' ELSE OLD.cantidad END); END;
CREATE TRIGGER ia_tareas_actualizada AFTER UPDATE ON ia_tareas
    WHEN NEW.actualizada IS OLD.actualizada
    BEGIN UPDATE ia_tareas SET actualizada = datetime('now') WHERE id = NEW.id; END;
COMMIT;
PRAGMA user_version = 9;
