# arduino-ffat-upload

FFAT (FAT Filesystem) uploader dan builder untuk ESP32 pada **Arduino IDE 2.2.1** atau lebih tinggi (termasuk **Arduino IDE 2.3.7**).

Digunakan bersama [ESP32 Arduino core](https://github.com/espressif/arduino-esp32).

MIT Licensed, lihat [LICENSE.md](LICENSE.md).

---

## Fitur

- **Upload FFAT** — Build dan upload FFAT filesystem image ke ESP32 via serial atau OTA (network)
- **Build FFAT** — Build FFAT filesystem image (`mkfatfs.bin`) di folder sketch tanpa upload
- Otomatis membaca partition scheme dari board yang dipilih
- Support custom `partitions.csv` di folder sketch
- Support semua varian ESP32 (ESP32, ESP32-S2, ESP32-S3, ESP32-C3, dll.)

---

## Persyaratan

- **Arduino IDE 2.2.1+** (direkomendasikan **2.3.7**)
- **ESP32 Arduino Core** terinstall melalui Board Manager
- Board harus menggunakan **partition scheme yang memiliki partisi FAT** (misalnya: `Default with ffat`, `Minimal SPIFFS with ffat`, dll.)
- Tool `mkfatfs` harus tersedia (biasanya sudah terinstall bersama ESP32 core)

---

## Instalasi

### Cara 1: Install dari file VSIX (Recommended)

1. Download file `.vsix` dari halaman [Releases](https://github.com/r-iki/arduino-ffat-upload/releases)
2. Salin file `.vsix` ke folder plugin Arduino IDE:
   - **Windows:** `C:\Users\<username>\.arduinoIDE\plugins\`
   - **macOS:** `~/.arduinoIDE/plugins/`
   - **Linux:** `~/.arduinoIDE/plugins/`
3. Buat folder `plugins` jika belum ada
4. **Restart Arduino IDE**

### Cara 2: Build dari source

```bash
git clone https://github.com/r-iki/arduino-ffat-upload.git
cd arduino-ffat-upload
npm install
npm run compile
npm run package
```

File `.vsix` akan dibuat di root folder. Salin ke folder `plugins` seperti Cara 1.

---

## Penggunaan di Arduino IDE 2.3.7

### Persiapan Sketch

1. Buat sketch Arduino seperti biasa atau buka sketch yang sudah ada
2. Buat folder **`data`** di dalam folder sketch:

```
MySketch/
├── MySketch.ino
└── data/
    ├── index.html
    ├── style.css
    ├── script.js
    └── config.json
```

3. Letakkan semua file yang ingin di-upload ke FFAT di dalam folder `data/`

### Pilih Board dan Partition Scheme

1. Di Arduino IDE, pilih board ESP32 dari menu **Tools > Board**
2. Pilih **partition scheme yang memiliki partisi FAT**:
   - Buka **Tools > Partition Scheme**
   - Pilih salah satu yang mengandung "ffat", contoh:
     - `Default with ffat (...)` 
     - `Minimal SPIFFS with ffat (...)`
     - Atau gunakan custom `partitions.csv`

> **Penting:** Jika partition scheme yang dipilih tidak memiliki partisi bertipe `fat`, upload akan gagal.

### Upload FFAT ke ESP32

1. Pastikan board ESP32 sudah terhubung via USB
2. Pilih port yang benar di **Tools > Port**
3. **Tutup Serial Monitor** jika sedang terbuka
4. Buka Command Palette:
   - **Windows/Linux:** `Ctrl` + `Shift` + `P`
   - **macOS:** `⌘` + `Shift` + `P`
5. Ketik dan pilih: **`Upload FFAT to ESP32`**
6. Tunggu proses build dan upload selesai di terminal

### Build FFAT Image (Tanpa Upload)

Berguna jika ingin membuat file image untuk distribusi tanpa perlu upload langsung.

1. Buka Command Palette (`Ctrl` + `Shift` + `P`)
2. Ketik dan pilih: **`Build FFAT image in sketch directory`**
3. File `mkfatfs.bin` akan dibuat di folder sketch

---

## Contoh Penggunaan dengan Arduino Code

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <FFat.h>

const char* ssid = "NamaWiFi";
const char* password = "PasswordWiFi";

WebServer server(80);

void setup() {
  Serial.begin(115200);

  // Mount FFAT filesystem
  if (!FFat.begin(true)) {
    Serial.println("FFAT Mount Failed!");
    return;
  }
  Serial.println("FFAT Mounted Successfully");

  // Tampilkan info filesystem
  Serial.printf("Total space: %u bytes\n", FFat.totalBytes());
  Serial.printf("Used space:  %u bytes\n", FFat.usedBytes());

  // List semua file
  File root = FFat.open("/");
  File file = root.openNextFile();
  while (file) {
    Serial.printf("  FILE: %s  SIZE: %u\n", file.name(), file.size());
    file = root.openNextFile();
  }

  // Connect WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());

  // Serve file dari FFAT
  server.serveStatic("/", FFat, "/index.html");
  server.serveStatic("/style.css", FFat, "/style.css");
  server.serveStatic("/script.js", FFat, "/script.js");

  server.begin();
}

void loop() {
  server.handleClient();
}
```

---

## Custom Partition Table

Jika ingin menggunakan partisi FAT custom, buat file `partitions.csv` di folder sketch:

```csv
# Name,   Type, SubType, Offset,  Size,     Flags
nvs,      data, nvs,     0x9000,  0x5000,
otadata,  data, ota,     0xe000,  0x2000,
app0,     app,  ota_0,   0x10000, 0x140000,
app1,     app,  ota_1,   0x150000,0x140000,
ffat,     data, fat,     0x290000,0x170000,
```

Extension akan otomatis mendeteksi `partitions.csv` di folder sketch dan menggunakannya.

---

## Upload via OTA (Network)

Extension mendukung upload via network/OTA:

1. Pilih port network di **Tools > Port** (akan muncul jika ESP32 sudah terhubung ke jaringan)
2. Jalankan **Upload FFAT to ESP32** seperti biasa

---

## Troubleshooting

### Error: "No data folder found"
Pastikan ada folder `data/` di dalam folder sketch.

### Error: "FAT partition entry not found in csv file"
Partition scheme yang dipilih tidak memiliki partisi bertipe `fat`. Ubah partition scheme di **Tools > Partition Scheme** ke salah satu yang mengandung "ffat".

### Error: "Could not open \<serial port\>"
Tutup **Serial Monitor** sebelum upload. Serial port tidak bisa diakses oleh dua proses bersamaan.

### Error: "mkfatfs failed"
- Pastikan ESP32 Arduino core terinstall dengan benar
- Coba install ulang board melalui Board Manager
- Pastikan tool `mkfatfs` ada di folder tools ESP32 core

### Error: "Board details not available"
Compile sketch minimal satu kali agar Arduino IDE mengisi informasi board. Klik **Verify/Compile** terlebih dahulu.

### Sketch pertama yang dibuka error
Jika sketch yang auto-open oleh IDE bermasalah, ubah board sekali (ke board apa saja) lalu kembalikan ke board semula. Atau buka sketch lain, tutup yang bermasalah, lalu buka ulang.

---

## Struktur Proyek

```
arduino-ffat-upload/
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript configuration
├── src/
│   └── extension.ts      # Source code utama
├── out/
│   └── extension.js      # Compiled JavaScript
├── LICENSE.md
└── README.md
```

---

## Perbedaan FFAT vs LittleFS vs SPIFFS

| Fitur             | FFAT                  | LittleFS        | SPIFFS            |
| ----------------- | --------------------- | --------------- | ----------------- |
| Wear leveling     | ✅                     | ✅               | ✅                 |
| Directories       | ✅                     | ✅               | ❌                 |
| Kecepatan baca    | Cepat                 | Sedang          | Lambat            |
| Kecepatan tulis   | Cepat                 | Sedang          | Lambat            |
| Overhead per file | Lebih besar           | Kecil           | Kecil             |
| Cocok untuk       | File besar, webserver | General purpose | Legacy/deprecated |

---

## Lisensi

MIT License — lihat [LICENSE.md](LICENSE.md)

FFAT (FAT filesystem) uploader and builder compatible with Arduino IDE 2.2.1 or higher. For use with the [ESP32 Arduino core](https://github.com/espressif/arduino-esp32).

## Features

- **Upload FFAT** to ESP32 via serial or OTA (network)
- **Build FFAT image** in sketch directory without uploading
- Automatic partition scheme detection from board configuration
- Support for custom `partitions.csv` in sketch folder
- Colored terminal output with progress information

## Prerequisites

- [Arduino IDE 2.2.1+](https://www.arduino.cc/en/software)
- [ESP32 Arduino core](https://github.com/espressif/arduino-esp32) installed
- [Arduino IDE Context extension](https://github.com/dankeboy36/vscode-arduino-api) (automatically included with Arduino IDE 2.x)
- A partition scheme that includes a FAT partition (e.g., "Default with ffat", "Minimal SPIFFS with ffat")

## Installation

Copy the [VSIX file](https://github.com/user/arduino-ffat-upload/releases) to `~/.arduinoIDE/plugins/` on Mac and Linux or `C:\Users\<username>\.arduinoIDE\plugins\` on Windows (you may need to create this directory beforehand). Restart the IDE.

## Usage

### Uploading a FAT filesystem to the device

1. Create a `data` folder inside your sketch directory
2. Place files you want on the FFAT filesystem into the `data` folder
3. Make sure you have selected a partition scheme that includes a FAT partition
4. Open the Command Palette: `[Ctrl]` + `[Shift]` + `[P]`
5. Type: **"Upload FFAT to ESP32"**

On macOS, press `[⌘]` + `[Shift]` + `[P]` to open the Command Palette.

### Building (but not uploading) a FAT filesystem image

This is useful for distributing filesystem images without needing the IDE.

1. Open the Command Palette: `[Ctrl]` + `[Shift]` + `[P]`
2. Type: **"Build FFAT image in sketch directory"**

The created filesystem image will be stored in the sketch directory as `mkfatfs.bin`.

## Partition Schemes

FFAT requires a partition scheme with a FAT partition. Common ESP32 partition schemes with FAT support:

| Scheme                   | Description                                 |
| ------------------------ | ------------------------------------------- |
| Default with ffat        | Standard layout with FFat instead of SPIFFS |
| Minimal SPIFFS with ffat | Larger app space with small FFat            |
| 16MB Flash with FAT      | For boards with 16MB flash                  |

You can also use a custom `partitions.csv` file placed in your sketch directory. Example:

```csv
# Name,   Type, SubType, Offset,  Size, Flags
nvs,      data, nvs,     0x9000,  0x5000,
otadata,  data, ota,     0xe000,  0x2000,
app0,     app,  ota_0,   0x10000, 0x140000,
app1,     app,  ota_1,   0x150000,0x140000,
ffat,     data, fat,     0x290000,0x170000,
```

## Troubleshooting

### "FAT partition entry not found"
Make sure your board is configured with a partition scheme that includes a FAT partition. Go to **Tools > Partition Scheme** in Arduino IDE and select one with "ffat" or "fat" in the name.

### "Could not open serial port"
Make sure you close any open Serial Monitor windows before uploading.

### "mkfatfs not found"
The `mkfatfs` tool should be included with the ESP32 Arduino core. Make sure you have the latest version of the ESP32 core installed.

### "Board details not available"
Compile the sketch at least once before uploading the filesystem. This ensures the board configuration is loaded.

## How It Works

1. Reads the partition table (CSV) to find the FAT partition offset and size
2. Uses `mkfatfs` tool (bundled with ESP32 core) to create a FAT filesystem image from the `data` folder
3. Uses `esptool` to flash the image to the correct offset on the ESP32

## License

MIT License - see [LICENSE.md](LICENSE.md)
