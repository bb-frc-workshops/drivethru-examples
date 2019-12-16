import { EventEmitter } from "events";
import fs from "fs";
import HID from "node-hid";
import path from "path";

interface IGamepadOptions {
    vendorID?: number;
    productID?: number;
}

interface IStickConfig {
    name: string;
    x: { pin: number };
    y: { pin: number };
}

interface IButtonConfig {
    value: number;
    pin: number;
    name: string;
}

interface IStatusState {
    value: number;
    state: string;
}
interface IStatusConfig {
    pin: number;
    name: string;
    states: IStatusState[];
}

interface IGamepadDefinition {
    vendorID: number;
    productID: number;
    joysticks?: IStickConfig[];
    buttons?: IButtonConfig[];
    status?: IStatusConfig[];
}

interface IStickState {
    x: number;
    y: number;
}

interface IGamepadState {
    [key: string]: IStickState | boolean | string;
}

export class Gamepad extends EventEmitter {
    private _usb: HID.HID;
    private _type: string;
    private _config: IGamepadDefinition;
    private _states: IGamepadState;
    private _options: IGamepadOptions;

    constructor(type: string, options?: IGamepadOptions) {
        super();

        this._usb = null;
        this._type = type;
        this._config = null;
        this._states = {};
        this._options = options || {};

        this.setMaxListeners(100);
        process.on("exit", this.disconnect.bind(this));
    }

    public connect() {
        if (!this.detectControllerConfiguration()) {
            const errMsg = `A product for the vendor "${this._type}" could not be detected`;
            throw new Error(errMsg);
        }

        this.emit("connecting");
        this.loadConfiguration();

        this._usb = new HID.HID(this._config.vendorID, this._config.productID);
        this._usb.on("data", this.onControllerFrame.bind(this));
        this.emit("connected");

        return this;
    }

    public disconnect() {
        if (this._usb) {
            this._usb.close();
        }
    }

    private hasProductId(type: string): boolean {
        return type.indexOf("/") > -1;
    }

    private detectControllerConfiguration(): boolean {
        if (this.hasProductId(this._type)) {
            return true;
        }

        // Check to see if the vendor exists
        const platformPath = path.resolve(__dirname, "../controllers/" + this._type + "/");
        if (!fs.existsSync(platformPath)) {
            const errMsg = `The vendor "${this._type}" does not exist`;
            throw new Error(errMsg);
        }

        // We know that the vendor exists, so loop through HID devices and the
        // configurations for this particular vendor while checking to see if any
        // of them match each other (indicating that we have a configuration something
        // that is currently plugged in)
        const devices = HID.devices();
        const files = fs.readdirSync(platformPath);
        for (const file of files) {
            const tmpConfigPath = path.join(platformPath, file);
            const tmpConfig = require(tmpConfigPath) as IGamepadDefinition;

            for (let j = 0, length = devices.length; j < length; j++) {
                const tmpDevice = devices[j];
                if (tmpConfig.vendorID === tmpDevice.vendorId && tmpConfig.productID === tmpDevice.productId) {
                    this._type = this._type + "/" + file.replace(".json", "");
                    return true;
                }
            }
        }
        return false;
    }

    private loadConfiguration() {
        const configPath = path.resolve(__dirname, "../controllers/" + this._type + ".json");
        if (!fs.existsSync(configPath)) {
            const errMsg = `The controller configuration for "${this._type}" does not exist`;
            throw new Error(errMsg);
        }

        this._config = (require(configPath) as IGamepadDefinition);

        if (this._options.vendorID) {
            this._config.vendorID = this._options.vendorID;
        }
        if (this._options.productID) {
            this._config.productID = this._options.productID;
        }
    }

    private onControllerFrame(data: Buffer) {
        this.processJoysticks(data);
        this.processButtons(data);
        this.processStatus(data);
    }

    private processJoysticks(data: Buffer) {
        if (!this._config.joysticks) {
            return;
        }

        const sticks = this._config.joysticks;
        sticks.forEach((stick) => {
            if (!this._states[stick.name]) {
                this._states[stick.name] = {
                    x: data[stick.x.pin],
                    y: data[stick.y.pin]
                };
                return;
            }

            let currentState = this._states[stick.name] as IStickState;
            if (currentState.x !== data[stick.x.pin] || currentState.y !== data[stick.y.pin]) {
                currentState = {
                    x: data[stick.x.pin],
                    y: data[stick.y.pin]
                };
                this._states[stick.name] = currentState;
                this.emit(stick.name + ":move", currentState);
            }
        });
    }

    private processButtons(data: Buffer) {
        if (!this._config.buttons) {
            return;
        }

        const buttons = this._config.buttons;
        buttons.forEach((button) => {
            const isPressed = (data[button.pin] & 0xFF) === button.value;
            if (this._states[button.name] === undefined) {
                this._states[button.name] = isPressed;

                if (isPressed) {
                    this.emit(button.name + ":press");
                }

                return;
            }

            const currentState = this._states[button.name] as boolean;
            if (isPressed && currentState !== isPressed) {
                this.emit(button.name + ":press");
            } else if (!isPressed && currentState !== isPressed) {
                this.emit(button.name + ":release");
            }

            this._states[button.name] = isPressed;
        });
    }

    private processStatus(data: Buffer) {
        if (!this._config.status) {
            return;
        }

        const statuses = this._config.status;
        statuses.forEach((status) => {
            const state = data[status.pin] & 0xFF;
            const states = status.states;
            let updatedState: string;

            for (let i = 0, length = states.length; i < length; i++) {
                if (states[i].value === state) {
                    updatedState = states[i].state;
                    break;
                }
            }

            const currentState = this._states[status.name] as string;
            if (currentState !== updatedState) {
                this.emit(status.name + ":change", updatedState);
            }

            this._states[status.name] = updatedState;
        });
    }
}
