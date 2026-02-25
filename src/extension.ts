import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { ArduinoContext, BoardDetails } from 'vscode-arduino-api';
import { platform } from 'node:os';
import { spawn } from 'child_process';

const writeEmitter = new vscode.EventEmitter<string>();
let writerReady: boolean = false;

function makeTerminal(title: string) {
    // If it exists, move it to the front
    let w = vscode.window.terminals.find((w) => ((w.name === title) && (w.exitStatus === undefined)));
    if (w !== undefined) {
        w.show(false);
        return;
    }
    // Not found, make a new terminal
    const pty = {
        onDidWrite: writeEmitter.event,
        open: () => { writerReady = true; },
        close: () => { writerReady = false; },
        handleInput: () => { }
    };
    const terminal = (<any>vscode.window).createTerminal({ name: title, pty });
    terminal.show();
}

async function waitForTerminal(title: string) {
    makeTerminal(title);

    // Wait for the terminal to become active.
    let cnt = 0;
    while (!writerReady) {
        if (cnt++ >= 50) { // Give it 5 seconds and then give up
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return true;
}

function findTool(ctx: ArduinoContext, match: string): string | undefined {
    let found = false;
    let ret = undefined;
    if (ctx.boardDetails !== undefined) {
        Object.keys(ctx.boardDetails.buildProperties).forEach((elem) => {
            if (elem.startsWith(match) && !found && (ctx.boardDetails?.buildProperties[elem] !== undefined)) {
                ret = ctx.boardDetails.buildProperties[elem];
                found = true;
            }
        });
    }
    return ret;
}

// ANSI styling helpers (from dankeboy36's esp-exception decoder)
const clear = '\x1b[2J\x1b[3J\x1b[;H';
const resetStyle = '\x1b[0m';
enum ANSIStyle {
    'bold' = 1,
    'red' = 31,
    'green' = 32,
    'blue' = 34,
    'yellow' = 33,
}

function red(text: string): string {
    return color(text, ANSIStyle.red);
}

function green(text: string, isBold = false): string {
    return color(text, ANSIStyle.green, isBold);
}

function blue(text: string, isBold = false): string {
    return color(text, ANSIStyle.blue, isBold);
}

function yellow(text: string, isBold = false): string {
    return color(text, ANSIStyle.yellow, isBold);
}

function bold(text: string): string {
    return `\x1b[${ANSIStyle.bold}m${text}${resetStyle}`;
}

function color(
    text: string,
    foregroundColor: ANSIStyle,
    isBold = false
): string {
    return `\x1b[${foregroundColor}${isBold ? `;${ANSIStyle.bold}` : ''
        }m${text}${resetStyle}`;
}

function fancyParseInt(str: string): number {
    var up = str.toUpperCase().trim();
    if (up === "") {
        return 0;
    }
    if (up.indexOf('0X') >= 0) {
        return parseInt(str, 16);
    } else if (up.indexOf('K') >= 0) {
        return 1024 * parseInt(up.substring(0, up.indexOf('K')));
    } else if (up.indexOf('M') >= 0) {
        return 1024 * 1024 * parseInt(up.substring(0, up.indexOf('M')));
    } else {
        return parseInt(str);
    }
}

// Execute a command and display its output in the terminal
async function runCommand(exe: string, opts: any[]) {
    const cmd = spawn(exe, opts);
    cmd.stdout.on('data', function (chunk) {
        writeEmitter.fire(String(chunk).replace(/\n/g, "\r\n"));
    });
    cmd.stderr.on('data', function (chunk) {
        writeEmitter.fire("\x1b[31m" + String(chunk).replace(/\n/g, "\r\n") + "\x1b[0m");
    });
    // Wait until the executable finishes
    let exitCode = await new Promise((resolve, reject) => {
        cmd.on('close', resolve);
    });
    return exitCode;
}

function getSelectedPartitionScheme(boardDetails: BoardDetails): string | undefined {
    const partitionSchemeOptions = boardDetails.configOptions.find(option => option.option === "PartitionScheme");
    if (partitionSchemeOptions === undefined) {
        writeEmitter.fire(red("\r\n\r\nERROR: Failed to read partition scheme options\r\n"));
        return;
    }

    const selectedOption = partitionSchemeOptions.values.find(value => value.selected === true);
    if (selectedOption === undefined) {
        writeEmitter.fire(red("\r\n\r\nERROR: No partition scheme selected\r\n"));
        return;
    }

    return boardDetails.buildProperties["menu.PartitionScheme." + selectedOption.value + ".build.partitions"];
}

function getDefaultPartitionScheme(boardDetails: BoardDetails): string | undefined {
    let partitions = boardDetails.buildProperties["build.partitions"];
    if (!partitions) {
        writeEmitter.fire(red("\r\n\r\nERROR: Partitions not defined for this ESP32 board\r\n"));
    }
    return partitions;
}

function getPartitionSchemeFile(arduinoContext: ArduinoContext) {
    // Check for local partitions.csv in sketch folder
    if (arduinoContext.sketchPath !== undefined) {
        let localPartitionsFile = arduinoContext.sketchPath + path.sep + "partitions.csv";
        if (fs.existsSync(localPartitionsFile)) {
            writeEmitter.fire(blue("Using partition: ") + green("partitions.csv in sketch folder") + "\r\n");
            return localPartitionsFile;
        }
    }

    if (arduinoContext.boardDetails === undefined) {
        writeEmitter.fire(red("\r\n\r\nERROR: Board details is undefined\r\n"));
        return;
    }

    let selectedScheme = getSelectedPartitionScheme(arduinoContext.boardDetails);
    if (selectedScheme === undefined) {
        selectedScheme = getDefaultPartitionScheme(arduinoContext.boardDetails);
        if (selectedScheme === undefined) {
            writeEmitter.fire(red("\r\n\r\nERROR: No board partition scheme found\r\n"));
            return;
        }
    }

    writeEmitter.fire(blue("Using partition: ") + green(selectedScheme) + "\r\n");

    let platformPath = arduinoContext.boardDetails.buildProperties["runtime.platform.path"];
    return platformPath + path.sep + "tools" + path.sep + "partitions" + path.sep + selectedScheme + ".csv";
}

export function activate(context: vscode.ExtensionContext) {
    // Get the Arduino info extension loaded
    const arduinoContext: ArduinoContext = vscode.extensions.getExtension('dankeboy36.vscode-arduino-api')?.exports;
    if (!arduinoContext) {
        vscode.window.showErrorMessage("Unable to load the Arduino IDE Context extension.");
        return;
    }

    // Register the upload command
    const disposable = vscode.commands.registerCommand('arduino-ffat-upload.uploadFFAT', async () => {
        doOperation(context, arduinoContext, true);
    });
    context.subscriptions.push(disposable);

    // Register the build command
    const disposable2 = vscode.commands.registerCommand('arduino-ffat-upload.buildFFAT', async () => {
        doOperation(context, arduinoContext, false);
    });
    context.subscriptions.push(disposable2);
}

async function doOperation(context: vscode.ExtensionContext, arduinoContext: ArduinoContext, doUpload: boolean) {
    if ((arduinoContext.boardDetails === undefined) || (arduinoContext.fqbn === undefined)) {
        vscode.window.showErrorMessage("Board details not available. Compile the sketch once.");
        return;
    }

    if (!await waitForTerminal("FFAT Upload")) {
        vscode.window.showErrorMessage("Unable to open upload terminal");
    }

    // Clear the terminal
    writeEmitter.fire(clear + resetStyle);

    writeEmitter.fire(bold("FFAT Filesystem " + (doUpload ? "Uploader" : "Builder") + " v" + String(context.extension.packageJSON.version) + " -- Arduino FFAT Upload\r\n\r\n"));

    writeEmitter.fire(blue(" Sketch Path: ") + green("" + arduinoContext.sketchPath) + "\r\n");

    // Need to have a data folder present
    let dataFolder = arduinoContext.sketchPath + path.sep + "data";
    writeEmitter.fire(blue("   Data Path: ") + green(dataFolder) + "\r\n");
    if (!fs.existsSync(dataFolder)) {
        writeEmitter.fire(red("\r\n\r\nERROR: No data folder found at " + dataFolder) + "\r\n");
        return;
    }

    // FFAT is only supported on ESP32
    let esp32 = false;
    let esp32variant = "";
    switch (arduinoContext.fqbn.split(':')[1]) {
        case "esp32": {
            esp32 = true;
            esp32variant = arduinoContext.boardDetails.buildProperties['build.mcu'];
            writeEmitter.fire(blue("      Device: ") + green("ESP32 series, model " + esp32variant) + "\r\n");
            break;
        }
        default: {
            writeEmitter.fire(red("\r\n\r\nERROR: FFAT is only supported on ESP32 boards.\r\n"));
            return;
        }
    }

    // Parse partitions to find the FAT partition
    let fsStart = 0;
    let fsEnd = 0;
    let uploadSpeed = 115200;

    const partitionFile = getPartitionSchemeFile(arduinoContext);
    if (partitionFile === undefined) {
        writeEmitter.fire(red("\r\n\r\nERROR: Partitions not defined for this ESP32 board\r\n"));
        return;
    }
    writeEmitter.fire(blue("  Partitions: ") + green(partitionFile) + "\r\n");
    if (!fs.existsSync(partitionFile)) {
        writeEmitter.fire(red("\r\n\r\nERROR: Partition file not found!\r\n"));
        return;
    }

    let partitionData = fs.readFileSync(partitionFile, 'utf8');
    let partitionDataArray = partitionData.split("\n");
    var lastend = 0x8000 + 0xc00;
    for (var i = 0; i < partitionDataArray.length; i++) {
        var line = partitionDataArray[i];
        if (line.indexOf('#') >= 0) {
            line = line.substring(0, line.indexOf('#'));
        }
        var partitionEntry = line.split(",");
        if (partitionEntry.length > 4) {
            var offset = fancyParseInt(partitionEntry[3]);
            var length = fancyParseInt(partitionEntry[4]);

            if (offset === 0) {
                offset = lastend;
            }
            lastend = offset + length;
            var partsubtype = partitionEntry[2].toUpperCase().trim();
            // Look for FAT partition subtype
            if (partsubtype === "FAT") {
                fsStart = offset;
                fsEnd = fsStart + length;
            }
        }
    }

    if (!fsStart || !fsEnd) {
        writeEmitter.fire(red("\r\n\r\nERROR: FAT partition entry not found in csv file!\r\n"));
        writeEmitter.fire(yellow("Make sure your partition scheme includes a FAT partition (subtype 'fat').\r\n"));
        writeEmitter.fire(yellow("Common partition schemes with FAT: 'Default with ffat', 'Minimal SPIFFS with ffat', etc.\r\n"));
        return;
    }

    writeEmitter.fire(blue("       Start: ") + green("0x" + fsStart.toString(16)) + "\r\n");
    writeEmitter.fire(blue("         End: ") + green("0x" + fsEnd.toString(16)) + "\r\n");
    writeEmitter.fire(blue("        Size: ") + green(((fsEnd - fsStart) / 1024) + " KB") + "\r\n");

    uploadSpeed = Number(arduinoContext.boardDetails.buildProperties["upload.speed"]);

    // Also check if user has selected a custom upload speed
    arduinoContext.boardDetails.configOptions.forEach((opt) => {
        if ((String(opt.option) === "baud") || (String(opt.option) === "UploadSpeed")) {
            opt.values.forEach((itm) => {
                if (itm.selected) {
                    uploadSpeed = Number(itm.value);
                }
            });
        }
    });

    // Windows exes need ".exe" suffix
    let ext = (platform() === 'win32') ? ".exe" : "";
    let extEspTool = (platform() === 'win32') ? ".exe" : ((platform() === 'darwin') ? "" : ".py");

    // Find mkfatfs tool
    let mkfatfs = "mkfatfs" + ext;
    let tool = findTool(arduinoContext, "runtime.tools.mkfatfs");
    if (!tool) {
        // Try alternate tool path names
        tool = findTool(arduinoContext, "runtime.tools.mkfatfs.path");
    }
    if (!tool) {
        // Fallback: search common Arduino packages directories for mkfatfs
        const searchPaths = [];
        if (platform() === 'win32') {
            searchPaths.push(path.join(process.env.LOCALAPPDATA || '', 'Arduino15', 'packages', 'esp32', 'tools', 'mkfatfs'));
        } else if (platform() === 'darwin') {
            searchPaths.push(path.join(os.homedir(), 'Library', 'Arduino15', 'packages', 'esp32', 'tools', 'mkfatfs'));
        } else {
            searchPaths.push(path.join(os.homedir(), '.arduino15', 'packages', 'esp32', 'tools', 'mkfatfs'));
        }
        for (const searchPath of searchPaths) {
            if (fs.existsSync(searchPath)) {
                // Search recursively for mkfatfs executable
                const findMkfatfs = (dir: string): string | undefined => {
                    const mkfatfsPath = path.join(dir, mkfatfs);
                    if (fs.existsSync(mkfatfsPath)) { return dir; }
                    try {
                        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                            if (entry.isDirectory()) {
                                const found = findMkfatfs(path.join(dir, entry.name));
                                if (found) { return found; }
                            }
                        }
                    } catch { }
                    return undefined;
                };
                tool = findMkfatfs(searchPath);
                if (tool) { break; }
            }
        }
    }
    if (tool) {
        mkfatfs = tool + path.sep + mkfatfs;
        writeEmitter.fire(blue(" mkfatfs Tool: ") + green(mkfatfs) + "\r\n");
    } else {
        writeEmitter.fire(yellow("WARNING: mkfatfs tool not found in build properties or Arduino packages, trying system path.\r\n"));
    }

    // Check port for upload
    let network = false;
    let networkPort = 0;
    let serialPort = "";



    if (arduinoContext.port?.address === undefined) {
        if (doUpload) {
            // Fallback: let user manually enter a port
            const manualPort = await vscode.window.showInputBox({
                prompt: "No port detected from Arduino IDE. Enter COM port manually (e.g. COM11)",
                placeHolder: "COM11",
                ignoreFocusOut: true
            });
            if (!manualPort) {
                writeEmitter.fire(red("\r\n\r\nERROR: No port specified and manual entry cancelled.\r\n"));
                return;
            }
            serialPort = manualPort.trim();
            writeEmitter.fire(blue(" Serial Port: ") + green(serialPort) + yellow(" (manual)") + "\r\n");
        }
    } else {
        serialPort = arduinoContext.port?.address;
    }

    if (arduinoContext.port?.protocol === "network") {
        if (!arduinoContext.port?.properties.port) {
            writeEmitter.fire(red("\r\n\r\nERROR: Network upload but port not specified, check IDE menus.\r\n"));
            return;
        }
        networkPort = Number(arduinoContext.port?.properties.port);
        network = true;
        writeEmitter.fire(blue("Network Info: ") + green(serialPort + ":" + String(networkPort)) + "\r\n");
    } else if (arduinoContext.port?.protocol === "serial") {
        writeEmitter.fire(blue(" Serial Port: ") + green(serialPort) + "\r\n");
    } else {
        // If we already have a manual port, treat as serial
        if (!serialPort && doUpload) {
            writeEmitter.fire(red("\r\n\r\nERROR: Unknown upload method specified, check IDE menus.\r\n"));
            return;
        }
    }

    // Find python3 for esptool
    let python3 = "python3" + ext;
    let python3Path = findTool(arduinoContext, "runtime.tools.python3.path");
    if (python3Path) {
        python3 = python3Path + path.sep + python3;
    }

    // Create temp file or output to sketch directory
    let imageFile = "";
    if (doUpload) {
        imageFile = path.join(os.tmpdir(), 'ffat-' + crypto.randomBytes(8).toString('hex') + '.ffat.bin');
    } else {
        imageFile = arduinoContext.sketchPath + path.sep + "mkfatfs.bin";
        writeEmitter.fire(blue("Output File:  ") + green(imageFile) + "\r\n");
    }

    // FAT filesystem parameters
    let fsSize = fsEnd - fsStart;

    // Build the FAT image using mkfatfs
    // mkfatfs options: -c <data_dir> -s <size> [-S <sector_size>] <image_file>
    let buildOpts = ["-c", dataFolder, "-s", String(fsSize), imageFile];

    writeEmitter.fire(bold("\r\nBuilding FFAT filesystem\r\n"));
    writeEmitter.fire(blue("Command Line: ") + green(mkfatfs + " " + buildOpts.join(" ")) + "\r\n\r\n");

    let exitCode = await runCommand(mkfatfs, buildOpts);
    if (exitCode) {
        writeEmitter.fire(red("\r\n\r\nERROR: mkfatfs failed, error code: " + String(exitCode) + "\r\n\r\n"));
        return;
    }

    if (!doUpload) {
        writeEmitter.fire(bold("\r\nCompleted build.\r\n\r\n"));
        vscode.window.showInformationMessage("FFAT build completed!");
        return;
    }

    // Upload stage
    let uploadOpts: any[] = [];
    let cmdApp = python3;

    if (network) {
        // OTA upload
        let espota = "tools" + path.sep + "espota";
        let espotaPath = findTool(arduinoContext, "runtime.platform.path");
        if (espotaPath) {
            espota = espotaPath + path.sep + espota;
        }
        uploadOpts = ["-r", "-i", serialPort, "-p", String(networkPort), "-f", imageFile, "-s"];

        if (platform() === 'win32') {
            cmdApp = espota; // Binary EXE on Windows
        } else {
            cmdApp = "python3"; // Not shipped, assumed installed on Linux and MacOS
            uploadOpts.unshift(espota + ".py"); // Need to call Python3
        }
    } else {
        // Serial upload using esptool
        let flashMode = arduinoContext.boardDetails.buildProperties["build.flash_mode"];
        let flashFreq = arduinoContext.boardDetails.buildProperties["build.flash_freq"];
        let espTool = "esptool";
        let espToolPath = findTool(arduinoContext, "runtime.tools.esptool_py.path");
        if (espToolPath) {
            espTool = espToolPath + path.sep + espTool;
        }
        uploadOpts = [
            "--chip", esp32variant,
            "--port", serialPort,
            "--baud", String(uploadSpeed),
            "--before", "default-reset",
            "--after", "hard-reset",
            "write-flash", "-z",
            "--flash-mode", flashMode,
            "--flash-freq", flashFreq,
            "--flash-size", "detect",
            String(fsStart), imageFile
        ];
        if ((platform() === 'win32') || (platform() === 'darwin')) {
            cmdApp = espTool + extEspTool; // Binary EXE on Mac/Windows
        } else {
            // Sometimes they give a .py, sometimes they give a precompiled binary
            if (fs.existsSync(espTool + extEspTool)) {
                cmdApp = "python3";
                uploadOpts.unshift(espTool + extEspTool);
            } else {
                cmdApp = espTool; // Binary without extension
            }
        }
    }

    writeEmitter.fire(bold("\r\nUploading FFAT filesystem\r\n"));
    writeEmitter.fire(blue("Command Line: ") + green(cmdApp + " " + uploadOpts.join(" ") + "\r\n\r\n"));

    exitCode = await runCommand(cmdApp, uploadOpts);
    if (exitCode) {
        writeEmitter.fire(red("\r\n\r\nERROR: Upload failed, error code: " + String(exitCode) + "\r\n\r\n"));
        return;
    }

    writeEmitter.fire(bold("\r\nCompleted upload.\r\n\r\n"));
    vscode.window.showInformationMessage("FFAT upload completed!");
}

export function deactivate() { }
